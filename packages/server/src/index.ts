import express from "express";
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SessionSummary,
  RequestSummary,
  CapturedRequest,
  CostBreakdown,
} from "@wiretap/shared";
import { getRequestMessages, computeCost } from "@wiretap/shared";
import { getSessionMeta, dbAvailable, dbPath } from "./db.ts";
import {
  catalogue,
  resolvePricing,
  pricingAvailable,
  modelsPath,
} from "./pricing.ts";
import {
  sessionCost,
  sweepInBackground,
  costStatus,
  cachePath,
} from "./costcache.ts";
import { parseArgs, USAGE, type Options } from "./config.ts";

/** Parse CLI options, printing usage and exiting on `--help` or bad input. */
function resolveOptions(): Options {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed !== "help") return parsed;
    process.stdout.write(USAGE);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(1);
  }
  process.exit(0);
}

const { logDir: LOG_DIR, port: PORT } = resolveOptions();

/**
 * Static web build, shipped next to the bundled entry as `dist/web`. Absent
 * when running from source in dev — Vite serves the UI and proxies /api.
 */
const WEB_DIR = fileURLToPath(new URL("./web", import.meta.url));

// Filenames look like: 2026-07-03T06-09-01-148Z_0001.json
const FILE_RE = /^([0-9TZ:.\-]+)_(\d+)\.json$/;
// Session dirs look like: ses_0d967bbabffeTij3Ph7fLBAuCf
const SESSION_RE = /^[A-Za-z0-9_\-]+$/;

const app = express();

/**
 * Resolve a path *inside* LOG_DIR, rejecting traversal. Returns null if the
 * resolved path escapes the root.
 */
function safeJoin(...parts: string[]): string | null {
  const resolved = path.resolve(LOG_DIR, ...parts);
  const rel = path.relative(LOG_DIR, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Extract the ISO-ish timestamp prefix from a captured filename. */
function parseFileName(name: string): { seq: number; tsPrefix: string } | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return { tsPrefix: m[1], seq: Number(m[2]) };
}

// GET /api/sessions — shallow scan, cheap. No file parsing.
app.get("/api/sessions", async (_req, res) => {
  try {
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const sessions: SessionSummary[] = await Promise.all(
      dirs.map(async (dir) => {
        const full = path.join(LOG_DIR, dir.name);
        const files = await fs.readdir(full);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        // Filenames are timestamp-prefixed → lexical max === most recent.
        let lastModified = "";
        if (jsonFiles.length > 0) {
          const latest = jsonFiles.reduce((a, b) => (a > b ? a : b));
          const parsed = parseFileName(latest);
          lastModified = parsed
            ? parsed.tsPrefix.replace(
                /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
                "T$1:$2:$3.$4Z",
              )
            : "";
        }
        if (!lastModified) {
          const st = await fs.stat(full);
          lastModified = st.mtime.toISOString();
        }
        return {
          id: dir.name,
          fileCount: jsonFiles.length,
          lastModified,
          title: null,
          parentId: null,
          directory: null,
          cost: sessionCost(dir.name),
        };
      }),
    );

    // Totals come from the background sweep's cache, never from work done
    // here — this route must stay a shallow scan. Re-arm the sweep so edits
    // since the last pass get picked up; it no-ops if one is already running,
    // and with a warm cache it is only a stat sweep.
    sweepInBackground(LOG_DIR);

    // Enrich with titles from OpenCode's DB (single batched, indexed lookup).
    const meta = await getSessionMeta(sessions.map((s) => s.id));
    for (const s of sessions) {
      const m = meta.get(s.id);
      if (m) {
        s.title = m.title;
        s.parentId = m.parentId;
        s.directory = m.directory;
      }
    }

    sessions.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id — list requests in one session, with light metadata.
app.get("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  if (!SESSION_RE.test(id)) {
    res.status(400).json({ error: "invalid session id" });
    return;
  }
  const dir = safeJoin(id);
  if (!dir) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    // This route already reads and parses every file, so costing here is
    // nearly free — unlike the sessions route, which must not.
    const cat = await catalogue();
    const rows: RequestSummary[] = await Promise.all(
      files.map(async (file) => {
        const full = path.join(dir, file);
        const parsed = parseFileName(file);
        const seq = parsed?.seq ?? 0;
        let model: string | null = null;
        let messageCount = 0;
        let timestamp = "";
        let size = 0;
        // Null rather than 0: a request still in flight, and one written
        // before responses were captured, genuinely have no status.
        let status: number | null = null;
        let outputTokens: number | null = null;
        let cost: CostBreakdown | null = null;
        try {
          const st = await fs.stat(full);
          size = st.size;
          const raw = await fs.readFile(full, "utf8");
          const json = JSON.parse(raw) as CapturedRequest;
          model = json.body?.model ?? null;
          messageCount = getRequestMessages(json.body).length;
          timestamp = json.timestamp ?? "";
          status = json.response?.status ?? null;
          const usage = json.response?.message?.usage;
          outputTokens = usage?.output_tokens ?? null;
          if (cat && usage) {
            const priced = resolvePricing(cat, json.url ?? "", model);
            if (priced) {
              cost = computeCost(usage, priced.pricing, priced.convention);
            }
          }
        } catch {
          // Corrupt/partial file — still list it with what we have.
        }
        return {
          file,
          seq,
          timestamp,
          model,
          messageCount,
          size,
          status,
          outputTokens,
          cost,
        };
      }),
    );

    rows.sort((a, b) => a.seq - b.seq);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id/:file — stream one raw captured request.
app.get("/api/sessions/:id/:file", (req, res) => {
  const { id, file } = req.params;
  if (!SESSION_RE.test(id) || !FILE_RE.test(file)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const full = safeJoin(id, file);
  if (!full) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const stream = createReadStream(full);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ error: "not found" });
  });
  stream.pipe(res);
});

app.get("/api/config", async (_req, res) => {
  res.json({
    logDir: LOG_DIR,
    dbPath: dbPath(),
    dbFound: await dbAvailable(),
    modelsPath: modelsPath(),
    pricingFound: await pricingAvailable(),
    costCachePath: cachePath(),
  });
});

// Progress of the background cost sweep. Polled by the UI while it runs so a
// multi-minute first pass over a large corpus is legible rather than silent.
app.get("/api/cost/status", (_req, res) => {
  res.json(costStatus());
});

// Unmatched API routes must 404 as JSON, never fall through to the SPA.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not found" });
});

// Serve the bundled web build, with SPA fallback. Skipped in dev.
const webBundled = existsSync(path.join(WEB_DIR, "index.html"));
if (webBundled) {
  app.use(express.static(WEB_DIR, { index: false }));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(WEB_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[wiretap] ${webBundled ? "viewer" : "API"} on ${url}`);
  console.log(`[wiretap] LOG_DIR = ${LOG_DIR}`);
  // Start costing immediately rather than waiting for the first request, so
  // a cold cache is already filling by the time the UI asks for sessions.
  sweepInBackground(LOG_DIR);
});
