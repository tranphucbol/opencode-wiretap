# AGENTS.md

Bun workspace. Captures and inspects the raw LLM request bodies OpenCode sends
to providers.

## Layout

| Package            | Path              | Role                                          |
| ------------------ | ----------------- | --------------------------------------------- |
| `opencode-wiretap` | `packages/plugin` | OpenCode plugin — writes captured requests    |
| `@wiretap/shared`  | `packages/shared` | Wire types + provider-shape normalizers       |
| `@wiretap/server`  | `packages/server` | Express API — reads log dir + OpenCode SQLite |
| `@wiretap/web`     | `packages/web`    | React + Vite viewer                           |

Data flows one way: plugin writes JSON files → server reads them → web renders them.

## Commands

Run from the repo root.

```bash
bun install
bun run dev          # API on :3001 + Vite on :5173
bun run check        # format:check + typecheck — run before calling work done
bun run format       # prettier --write .
bun run build
```

Target one package with `bun run --filter <pkg-name> <script>`.

## Rules

- **Always run `bun run check` before finishing.** Both halves must pass.
- **The server needs the Bun runtime, not Node** — `packages/server/src/db.ts`
  uses `bun:sqlite`.
- **`shared` is source-only.** Its `exports` points at `./src/index.ts`; there
  is no build step. Never add one.
- **`plugin` is the only package that emits JavaScript**, because OpenCode
  loads it compiled. Everything else runs from TypeScript source.
- **Import shared code as `@wiretap/shared`**, never by relative path
  across package boundaries.
- **Never edit `dist/` or `bun.lock` by hand.**
- The plugin and the server are coupled only by an on-disk file contract (path
  - `{ timestamp, url, body }` envelope). Change one side, change the other —
    see `packages/plugin/README.md`.
