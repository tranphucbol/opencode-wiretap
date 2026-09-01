# 001: The plugin bundles `@wiretap/shared`

Status: Accepted

## Decision

`packages/plugin` is built with `Bun.build` into a single `dist/index.js`
instead of a file-per-module `tsc` emit, and it imports `@wiretap/shared`.
`shared` is inlined into that bundle; it stays a devDependency and is never
resolved at install time.

Types are produced separately by `tsc -p tsconfig.build.json`
(`--emitDeclarationOnly`), and the build script deletes every emitted `.d.ts`
except `index.d.ts` — the bundle collapsed the other modules, so their
declarations would describe files that do not exist in the package.

## Rationale

Capturing responses requires reassembling a provider stream into a message.
That has to happen in the plugin: the plugin is the only place holding the
complete stream, because the raw copy written to disk may be truncated at
`WIRETAP_RAW_MAX_BYTES` before a reader ever sees it.

The assemblers therefore have to run on the writer side, while the viewer
needs the same block vocabulary to render the result. That leaves three
options:

1. **Duplicate the assemblers** into the plugin. Rejected: two copies of
   provider-grammar code that must agree exactly, drifting silently, with the
   failure mode being a viewer that renders responses subtly wrong.
2. **Publish `@wiretap/shared`.** Rejected: a third published package, on the
   npm release cadence, for code with no external audience — and it breaks the
   "shared is source-only" rule that keeps it editable without a build step.
3. **Bundle it.** Chosen. The coupling is build-time only; the published
   artifact contains no reference to `@wiretap/shared`.

`shared` was already bundled into the viewer for exactly this reason, so this
extends an existing pattern rather than inventing one.

## Consequences

- `packages/plugin/README.md` could previously say the plugin and the viewer
  "share no code — only a file contract". That is now false at the source
  level. The file contract is still the only _runtime_ coupling, and remains
  the thing to keep in sync when either side changes.
- The published output changed shape: one bundled `dist/index.js` where there
  used to be one file per source file. `main`, `types` and `exports` point at
  the same paths and `dist/index.d.ts` is still emitted, so consumers see no
  difference.
- The plugin now has three tsconfigs: `tsconfig.json` (typecheck, covers
  `src` and `scripts`), `tsconfig.build.json` (declaration emit, excludes
  tests) and the shared base. The split exists because declaration emit needs
  a `rootDir` that `scripts/` would violate.
- Plugin type-checking is pinned to `types: ["bun"]` rather than
  `["node", "bun"]`. Listing both puts two incompatible declarations of
  `Response` in scope and cross-package code that touches `fetch` stops
  compiling. `@types/bun` already brings `@types/node` with it.
