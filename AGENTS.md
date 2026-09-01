# AGENTS.md

Bun workspace. Captures and inspects the raw LLM request bodies OpenCode sends
to providers.

## Layout

| Package                   | Path              | Published | Role                                              |
| ------------------------- | ----------------- | --------- | ------------------------------------------------- |
| `opencode-wiretap`        | `packages/plugin` | yes       | OpenCode plugin — writes captured requests        |
| `@wiretap/shared`         | `packages/shared` | no        | Wire types + provider-shape normalizers           |
| `opencode-wiretap-viewer` | `packages/server` | yes       | Express API + `bunx`/`npx` CLI — the whole viewer |
| `@wiretap/web`            | `packages/web`    | no        | React + Vite viewer UI                            |

Data flows one way: plugin writes JSON files → server reads them → web renders them.

## Commands

Run from the repo root.

```bash
bun install
bun run dev          # API on :3001 + Vite on :5173
bun run check        # format:check + typecheck — run before calling work done
bun run format       # prettier --write .
bun run build        # plugin dist/ + viewer dist/ (bundle + web build)
bun run smoke        # boot the built viewer under Bun and Node, hit it over HTTP
```

Target one package with `bun run --filter <pkg-name> <script>`.

## Rules

- **Always run `bun run check` before finishing.** Both halves must pass.
- **Touching `packages/server` means running `bun run build && bun run smoke`.**
  The viewer is published for both `bunx` and `npx`; the smoke test is the only
  thing proving the Node path still works.
- **The published viewer must not hard-import `bun:sqlite`.** All SQLite access
  goes through `packages/server/src/sqlite.ts`, which picks a backend at runtime
  and degrades to "no session titles" when none is available.
- **`shared` is source-only.** Its `exports` points at `./src/index.ts`; there
  is no build step. Never add one — it is bundled into the viewer instead.
- **Only the two published packages emit JavaScript.** `plugin` because OpenCode
  loads it compiled, `server` because it has to run without the workspace.
- **`packages/server/scripts/build.ts` is the only sanctioned cross-package
  reach**, copying `packages/web/dist` into the viewer's `dist/web`.
- **Import shared code as `@wiretap/shared`**, never by relative path
  across package boundaries.
- **Never edit `dist/` or `bun.lock` by hand.**
- **Never hand-edit `version` fields.** Releases are tag-driven; the workflow
  runs `scripts/set-version.ts` to stamp all manifests in lockstep.
- The plugin and the server are coupled only by an on-disk file contract (path
  - `{ timestamp, url, body }` envelope). Change one side, change the other —
    see `packages/plugin/README.md`.

## Releasing

Guide: `docs/RELEASING.md`.
