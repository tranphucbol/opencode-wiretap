// Stamp one version across the workspace. Used by the release workflow, which
// derives the version from the pushed `v*` tag, so package.json versions never
// need to be committed ahead of a release.
//
//   bun run scripts/set-version.ts 0.2.0
//
// Every package moves in lockstep — see AGENTS.md, "Releasing".

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error(`usage: bun run scripts/set-version.ts <semver>
got: ${version ?? "(nothing)"}`);
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const manifests = [
  "package.json",
  "packages/plugin/package.json",
  "packages/shared/package.json",
  "packages/server/package.json",
  "packages/web/package.json",
];

for (const rel of manifests) {
  const file = path.join(root, rel);
  const raw = await readFile(file, "utf8");
  // Rewrite only the top-level "version" key so dependency ranges, formatting
  // and key order all survive untouched.
  const versionField = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!versionField.test(raw)) {
    throw new Error(`no version field found in ${rel}`);
  }
  const next = raw.replace(versionField, `$1"${version}"`);
  await writeFile(file, next);
  console.log(`  ${rel} → ${version}`);
}
