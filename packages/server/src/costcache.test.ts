import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Both the price table and the cache file are resolved from the environment
// when their modules are first evaluated, so this has to precede the import.
const root = mkdtempSync(join(tmpdir(), "wiretap-costcache-"));
const LOG_DIR = join(root, "logs");
const CACHE = join(root, "costs.json");
const MODELS = join(root, "models.json");

writeFileSync(
  MODELS,
  JSON.stringify({
    anthropic: {
      models: { "claude-opus-5": { cost: { input: 5, output: 25 } } },
    },
  }),
);
process.env.OPENCODE_MODELS = MODELS;
process.env.WIRETAP_COST_CACHE = CACHE;

const { sweep, sessionCost, cachePath } = await import("./costcache.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A capture with a priced response, so it lands in the cache with a cost. */
function capture(session: string, name: string) {
  const dir = join(LOG_DIR, session);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      url: "https://api.anthropic.com/v1/messages",
      body: { model: "claude-opus-5", messages: [] },
      response: {
        status: 200,
        headers: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ttfbMs: 1,
        durationMs: 2,
        state: "complete",
        message: {
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        },
      },
    }),
  );
}

async function cachedKeys(): Promise<string[]> {
  const parsed = JSON.parse(await fs.readFile(cachePath(), "utf8"));
  return Object.keys(parsed.files).sort();
}

test("a swept session is costed and cached per file", async () => {
  capture("ses_keep", "a.json");
  capture("ses_drop", "a.json");
  capture("ses_drop", "b.json");

  await sweep(LOG_DIR);

  expect(await cachedKeys()).toEqual([
    "ses_drop/a.json",
    "ses_drop/b.json",
    "ses_keep/a.json",
  ]);
  expect(sessionCost("ses_keep")).toBeGreaterThan(0);
  expect(sessionCost("ses_drop")).toBeGreaterThan(0);
});

test("entries for pruned sessions and deleted files are evicted", async () => {
  // What the plugin's retention sweep does: a whole session directory goes.
  rmSync(join(LOG_DIR, "ses_drop"), { recursive: true, force: true });
  // And, separately, one file removed from a session that survives.
  capture("ses_keep", "b.json");
  await sweep(LOG_DIR);
  expect(await cachedKeys()).toEqual(["ses_keep/a.json", "ses_keep/b.json"]);

  rmSync(join(LOG_DIR, "ses_keep", "b.json"));
  await sweep(LOG_DIR);

  expect(await cachedKeys()).toEqual(["ses_keep/a.json"]);
  expect(sessionCost("ses_drop")).toBeNull();
  expect(sessionCost("ses_keep")).toBeGreaterThan(0);
});
