// Smoke-test the built viewer under a given runtime.
//
//   bun run scripts/smoke.ts node
//   bun run scripts/smoke.ts bun
//
// Proves the published artifact actually boots: the bundle loads without the
// workspace present, the SQLite adapter degrades instead of throwing, the API
// answers, and the SPA is served from the same port.

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtime = process.argv[2] ?? "bun";
const entry = path.resolve("packages/server/dist/server.js");
const port = 4319 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;

const logDir = await mkdtemp(path.join(os.tmpdir(), "wiretap-smoke-"));
const session = path.join(logDir, "ses_smoketest");
await mkdir(session, { recursive: true });

// Request-only. Captures written before responses existed must still load.
await writeFile(
  path.join(session, "2026-01-01T00-00-00-000Z_0001.json"),
  JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    url: "https://example.invalid/v1/messages",
    body: { model: "smoke-model", messages: [{ role: "user", content: "hi" }] },
  }),
);

// A full exchange, request and response in one file. The URL has to be a host
// the price table knows, or the row would arrive uncosted and the cost checks
// below would pass for the wrong reason.
await writeFile(
  path.join(session, "2026-01-01T00-00-01-000Z_0002.json"),
  JSON.stringify({
    timestamp: "2026-01-01T00:00:01.000Z",
    url: "https://api.anthropic.com/v1/messages",
    body: { model: "smoke-model", messages: [{ role: "user", content: "yo" }] },
    response: {
      status: 429,
      headers: { "content-type": "text/event-stream" },
      startedAt: "2026-01-01T00:00:01.100Z",
      completedAt: "2026-01-01T00:00:01.400Z",
      ttfbMs: 100,
      durationMs: 300,
      state: "complete",
      message: {
        model: "smoke-model",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 11, output_tokens: 22 },
      },
      raw: {
        encoding: "sse",
        text: "data: {}\n\n",
        bytes: 10,
        truncated: false,
      },
    },
  }),
);

// A stand-in for OpenCode's models.dev cache, so costing is exercised against
// a known rate sheet instead of whatever happens to be on the build machine.
const modelsFile = path.join(logDir, "models.json");
await writeFile(
  modelsFile,
  JSON.stringify({
    anthropic: {
      models: { "smoke-model": { cost: { input: 3, output: 15 } } },
    },
  }),
);
// 11 input @ $3/Mtok + 22 output @ $15/Mtok.
const EXPECTED_COST = (11 * 3) / 1e6 + (22 * 15) / 1e6;

const proc = Bun.spawn(
  [runtime, entry, "--port", String(port), "--log-dir", logDir],
  {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      OPENCODE_MODELS: modelsFile,
      // Keep the sweep's cache inside the temp dir; never touch the real one.
      WIRETAP_COST_CACHE: path.join(logDir, "costs.json"),
    },
  },
);

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** Poll until the server answers or we give up. */
async function waitForReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`${runtime} exited early with ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) return res;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(200);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

try {
  console.log(`[smoke] ${runtime} ${entry} --port ${port}`);
  const configRes = await waitForReady();
  const config = (await configRes.json()) as {
    logDir: string;
    pricingFound: boolean;
  };
  check("GET /api/config reports the CLI log dir", config.logDir === logDir);
  check(
    "GET /api/config finds the price table",
    config.pricingFound === true,
    JSON.stringify(config),
  );

  const sessions = (await (
    await fetch(`${base}/api/sessions`)
  ).json()) as Array<{ id: string; fileCount: number }>;
  check(
    "GET /api/sessions finds the seeded session",
    sessions.length === 1 && sessions[0].id === "ses_smoketest",
    JSON.stringify(sessions),
  );

  const detail = (await (
    await fetch(`${base}/api/sessions/ses_smoketest`)
  ).json()) as Array<{
    file: string;
    model: string | null;
    messageCount: number;
    status: number | null;
    outputTokens: number | null;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    } | null;
  }>;
  check(
    "GET /api/sessions/:id parses the captures",
    detail.length === 2 &&
      detail[0].model === "smoke-model" &&
      detail[0].messageCount === 1,
    JSON.stringify(detail),
  );
  check(
    "a request-only capture reports no status",
    detail[0]?.status === null && detail[0]?.outputTokens === null,
    JSON.stringify(detail[0]),
  );
  check(
    "a captured response surfaces its status and output tokens",
    detail[1]?.status === 429 && detail[1]?.outputTokens === 22,
    JSON.stringify(detail[1]),
  );
  check(
    "a capture with no response is priced null, not zero",
    detail[0]?.cost === null,
    JSON.stringify(detail[0]),
  );
  check(
    "a captured response is priced from the local rate table",
    Math.abs((detail[1]?.cost?.total ?? -1) - EXPECTED_COST) < 1e-12 &&
      Math.abs((detail[1]?.cost?.input ?? -1) - (11 * 3) / 1e6) < 1e-12 &&
      Math.abs((detail[1]?.cost?.output ?? -1) - (22 * 15) / 1e6) < 1e-12 &&
      detail[1]?.cost?.cacheRead === 0 &&
      detail[1]?.cost?.cacheWrite === 0,
    JSON.stringify(detail[1]?.cost),
  );

  // The session total is produced by the background sweep, which is a wholly
  // separate pass over the same files — agreement between the two is the point.
  let costed: Array<{ id: string; cost: number | null }> = [];
  for (let i = 0; i < 100; i++) {
    const status = (await (await fetch(`${base}/api/cost/status`)).json()) as {
      running: boolean;
      costed: number;
    };
    if (!status.running && status.costed > 0) {
      costed = (await (
        await fetch(`${base}/api/sessions`)
      ).json()) as typeof costed;
      break;
    }
    await Bun.sleep(100);
  }
  check(
    "the background sweep totals the session to the same figure",
    Math.abs((costed[0]?.cost ?? -1) - EXPECTED_COST) < 1e-12,
    JSON.stringify(costed),
  );

  const exchange = (await (
    await fetch(`${base}/api/sessions/ses_smoketest/${detail[1]?.file}`)
  ).json()) as {
    response?: { state?: string; message?: { content?: unknown[] } };
  };
  check(
    "the detail route returns the response half",
    exchange.response?.state === "complete" &&
      exchange.response?.message?.content?.length === 1,
    JSON.stringify(exchange.response),
  );

  const missing = await fetch(`${base}/api/does-not-exist`);
  check(
    "unknown /api route 404s as JSON",
    missing.status === 404 &&
      (missing.headers.get("content-type") ?? "").includes("application/json"),
  );

  const index = await fetch(`${base}/`);
  const html = await index.text();
  check(
    "GET / serves the bundled web build",
    index.ok && html.includes("<div id=") && html.includes("<script"),
  );

  const spa = await fetch(`${base}/some/client/route`);
  check("unknown page falls back to the SPA", spa.ok);
} catch (err) {
  failures.push(String(err));
} finally {
  proc.kill();
  await proc.exited;
  await rm(logDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n[smoke] FAILED under ${runtime}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n[smoke] passed under ${runtime}`);
