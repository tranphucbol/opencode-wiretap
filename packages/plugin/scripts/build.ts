// Build the publishable plugin artifact.
//
//   dist/index.js   — the plugin + @wiretap/shared bundled into one ESM file.
//                     `@opencode-ai/plugin` stays external: OpenCode provides
//                     it at load time and it is a peer dependency, not ours.
//   dist/index.d.ts — emitted by `tsc --emitDeclarationOnly`.
//
// Bundling exists so the plugin can import `@wiretap/shared` (the response
// assemblers) without shipping a workspace-only dependency. `shared` is
// source-only by design, so the only way to consume it from a published
// package is to inline it — see docs/decisions/001-plugin-bundles-shared.md.

import { rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
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

// 1. Bundle to a single ESM file.
const result = await Bun.build({
  entrypoints: [path.join(pkgRoot, "src/index.ts")],
  outdir: dist,
  naming: "index.js",
  target: "node",
  format: "esm",
  sourcemap: "linked",
  external: ["@opencode-ai/plugin"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("plugin bundle failed");
}

// 2. Types for the one entry point.
await run(["bunx", "tsc", "-p", "tsconfig.build.json"], pkgRoot);

// 3. tsc emits a .d.ts per source file, but the bundle collapsed them all into
//    index.js. Anything else would be a type declaration describing a module
//    that does not exist in the package — drop it.
for (const name of await readdir(dist)) {
  if (name.endsWith(".d.ts") && name !== "index.d.ts") {
    await rm(path.join(dist, name));
  }
}

console.log(`[wiretap] plugin built → ${dist}`);
