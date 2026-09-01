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
await writeFile(
  path.join(session, "2026-01-01T00-00-00-000Z_0001.json"),
  JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    url: "https://example.invalid/v1/messages",
    body: { model: "smoke-model", messages: [{ role: "user", content: "hi" }] },
  }),
);

const proc = Bun.spawn(
  [runtime, entry, "--port", String(port), "--log-dir", logDir],
  { stdout: "inherit", stderr: "inherit" },
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
  const config = (await configRes.json()) as { logDir: string };
  check("GET /api/config reports the CLI log dir", config.logDir === logDir);

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
  ).json()) as Array<{ model: string | null; messageCount: number }>;
  check(
    "GET /api/sessions/:id parses the capture",
    detail.length === 1 &&
      detail[0].model === "smoke-model" &&
      detail[0].messageCount === 1,
    JSON.stringify(detail),
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
