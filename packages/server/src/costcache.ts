import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { CapturedRequest } from "@wiretap/shared";
import { computeCost } from "@wiretap/shared";
import { catalogue, resolvePricing, type Catalogue } from "./pricing.ts";

/**
 * Session cost totals, cached on disk and refreshed in the background.
 *
 * Totalling a session means reading and parsing every capture in it. On a real
 * corpus that is ~33k files and 10 GB: roughly five minutes cold, and 0.35s
 * once only `stat` is needed. So each file's cost is memoised against its
 * `(mtime, size)` — a capture is rewritten exactly once, when its response
 * lands, which moves both — and the sweep runs off the request path. The
 * sessions route answers immediately from whatever is cached and reports
 * `null` for anything the sweep has not reached yet.
 */

const DEFAULT_CACHE = path.join(
  os.homedir(),
  ".cache/opencode-wiretap/costs.json",
);

export function cachePath(): string {
  return process.env.WIRETAP_COST_CACHE
    ? path.resolve(process.env.WIRETAP_COST_CACHE)
    : DEFAULT_CACHE;
}

/** `[mtimeMs, size, usd]`. Tuples, not objects — there are tens of thousands. */
type Entry = [number, number, number];

interface Persisted {
  version: 1;
  files: Record<string, Entry>;
}

const files = new Map<string, Entry>();
const totals = new Map<string, number>();

let loaded: Promise<void> | null = null;
let sweeping = false;
let dirty = false;
let progress = { done: 0, total: 0, running: false };

export interface CostStatus {
  done: number;
  total: number;
  running: boolean;
  /** Sessions with a settled total. */
  costed: number;
}

export function costStatus(): CostStatus {
  return { ...progress, costed: totals.size };
}

/** Total USD for a session, or null if the sweep has not costed it yet. */
export function sessionCost(id: string): number | null {
  return totals.get(id) ?? null;
}

async function loadCache(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await fs.readFile(cachePath(), "utf8");
      const parsed = JSON.parse(text) as Persisted;
      if (parsed?.version !== 1 || !parsed.files) return;
      for (const [key, entry] of Object.entries(parsed.files)) {
        if (Array.isArray(entry) && entry.length === 3) files.set(key, entry);
      }
    } catch {
      // No cache yet, or it is unreadable/stale — rebuild from scratch.
    }
  })();
  return loaded;
}

async function saveCache(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const out: Persisted = { version: 1, files: Object.fromEntries(files) };
  const file = cachePath();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(out));
    await fs.rename(tmp, file);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Cheap negative filter. Parsing a 300KB capture to discover it has no
 * response is the bulk of the sweep's CPU, and a capture without the literal
 * `"response"` anywhere in it certainly has no response field. A false
 * positive (the word appears in a prompt) only costs a parse.
 */
function mightHaveResponse(text: string): boolean {
  return text.includes('"response"');
}

/** USD for one capture file. 0 covers both "no response" and "no rates". */
async function costOf(full: string, cat: Catalogue): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(full, "utf8");
  } catch {
    return 0;
  }
  if (!mightHaveResponse(text)) return 0;
  try {
    const json = JSON.parse(text) as CapturedRequest;
    const usage = json.response?.message?.usage;
    if (!usage) return 0;
    const resolved = resolvePricing(
      cat,
      json.url ?? "",
      json.body?.model ?? null,
    );
    if (!resolved) return 0;
    return computeCost(usage, resolved.pricing, resolved.convention).total;
  } catch {
    return 0;
  }
}

/** Let the event loop breathe so the API stays responsive during a sweep. */
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * Walk every session, costing files that are new or have changed. Safe to
 * call repeatedly; concurrent calls collapse into the running one.
 */
export async function sweep(logDir: string): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  progress.running = true;
  try {
    await loadCache();
    const cat = await catalogue();
    // No price table means no session can be costed. Leave every total unset
    // so the UI reads "unknown"; recording zeroes would claim these sessions
    // were free.
    if (!cat) return;

    let dirs: string[] = [];
    try {
      const entries = await fs.readdir(logDir, { withFileTypes: true });
      dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return;
    }

    progress.done = 0;
    progress.total = 0;
    let sinceSave = 0;

    for (const id of dirs) {
      const dir = path.join(logDir, id);
      let names: string[];
      try {
        names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }
      progress.total += names.length;

      let total = 0;
      for (const name of names) {
        const key = `${id}/${name}`;
        const full = path.join(dir, name);
        let usd = 0;
        try {
          const st = await fs.stat(full);
          const hit = files.get(key);
          if (hit && hit[0] === st.mtimeMs && hit[1] === st.size) {
            usd = hit[2];
          } else {
            usd = await costOf(full, cat);
            files.set(key, [st.mtimeMs, st.size, usd]);
            dirty = true;
            sinceSave++;
          }
        } catch {
          // File vanished mid-sweep; ignore it.
        }
        total += usd;
        progress.done++;
        // Yield often enough that a sweep never blocks a request for long.
        if (progress.done % 64 === 0) await yieldToLoop();
      }
      totals.set(id, total);

      if (sinceSave >= 2000) {
        sinceSave = 0;
        await saveCache();
      }
    }
    await saveCache();
  } finally {
    sweeping = false;
    progress.running = false;
  }
}

/** Kick a sweep off without awaiting it. Errors are swallowed by design. */
export function sweepInBackground(logDir: string): void {
  void sweep(logDir).catch(() => {});
}
