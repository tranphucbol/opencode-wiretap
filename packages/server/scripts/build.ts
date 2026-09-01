// Build the publishable viewer artifact.
//
//   dist/server.js  — the Express API + @wiretap/shared bundled into one ESM
//                     file. `express` stays external (a real dependency);
//                     `bun:sqlite` / `node:sqlite` are loaded through a
//                     computed specifier so no bundler can touch them.
//   dist/web/       — the Vite build, copied from packages/web. The server
//                     serves it as static files with an SPA fallback.
//
// This is the one place `server` reaches across into `web`: the published
// package is a single process that serves both halves, so it has to carry the
// web build with it.

import { rm, mkdir, cp, chmod, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = path.join(pkgRoot, "..", "web");
const dist = path.join(pkgRoot, "dist");

/** Run a command, inheriting stdio, and fail the build on a non-zero exit. */
async function run(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${code}`);
  }
}

await rm(dist, { recursive: true, force: true });

// 1. Web build — always rebuilt so the shipped UI matches this commit.
await run(["bun", "run", "build"], webRoot);
const webDist = path.join(webRoot, "dist");
await access(path.join(webDist, "index.html")).catch(() => {
  throw new Error(`web build produced no index.html in ${webDist}`);
});

// 2. Bundle the server.
const result = await Bun.build({
  entrypoints: [path.join(pkgRoot, "src/index.ts")],
  outdir: dist,
  naming: "server.js",
  target: "node",
  format: "esm",
  sourcemap: "linked",
  // `npx` picks node via the shebang; `bunx` runs JS with Bun regardless.
  banner: "#!/usr/bin/env node",
  external: ["express"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("server bundle failed");
}

// 3. Ship the web build inside the package.
await mkdir(path.join(dist, "web"), { recursive: true });
await cp(webDist, path.join(dist, "web"), { recursive: true });

await chmod(path.join(dist, "server.js"), 0o755);

console.log(`[wiretap] viewer built → ${dist}`);
