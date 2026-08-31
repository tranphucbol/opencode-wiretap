# opencode-wiretap

A Bun workspace for capturing and inspecting the raw LLM request bodies that
[OpenCode](https://opencode.ai) sends to providers.

```
packages/
├─ plugin/   opencode-wiretap    OpenCode plugin — writes captured requests to disk
├─ shared/   @wiretap/shared     Wire types + provider-shape normalizers
├─ server/   @wiretap/server     Express API — reads the log dir + OpenCode's SQLite
└─ web/      @wiretap/web        React + Vite three-pane viewer
```

Data flows one way: **plugin writes JSON files → server reads them → web renders them.**
The plugin is deliberately decoupled from the other three; the only thing binding
it to the server is the on-disk file contract documented in
[`packages/plugin/README.md`](packages/plugin/README.md).

## The viewer

Three panes: sessions on the left (nested by parent, filterable, sortable),
that session's captured requests in the middle, and the decoded payload on the
right.

![Three-pane viewer](docs/screenshots/three-pane.png)

The system prompt is split into its constituent parts — prose, `<env>`, agent
instruction files, MCP blocks, skill catalogs — each collapsible, so you can see
what actually got shipped without scrolling through 40 KB of text.

![System prompt breakdown](docs/screenshots/system-prompt.png)

Tool definitions are listed separately with their full descriptions, which is
usually where the token budget quietly goes.

![Tool definitions](docs/screenshots/tools.png)

Anything the structured view normalizes away is one click from the original
envelope — `{ timestamp, url, body }` exactly as it went over the wire.

![Raw JSON](docs/screenshots/raw-json.png)

## Getting started

```bash
bun install
bun run dev          # Express API on :3001 + Vite on :5173
```

Then build and install the plugin so there is something to look at — see
[`packages/plugin/README.md`](packages/plugin/README.md).

## Scripts

| Command                | Effect                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `bun run dev`          | Runs the API (watched) and Vite together, prefixed output, one Ctrl-C |
| `bun run dev:server`   | API only                                                              |
| `bun run dev:web`      | Vite only                                                             |
| `bun run server`       | API without watch                                                     |
| `bun run build`        | Builds every package (web bundle + plugin `dist/`)                    |
| `bun run typecheck`    | `tsc --noEmit` across the root scripts and all four packages          |
| `bun run format`       | Prettier `--write` over the whole workspace                           |
| `bun run format:check` | Prettier `--check`, non-mutating — use in CI                          |
| `bun run check`        | `format:check` + `typecheck`                                          |
| `bun run clean`        | Removes build output and `*.tsbuildinfo`                              |

Anything can also be targeted directly, e.g. `bun run --filter @wiretap/web build`.

Prettier runs from the root for every package. `prettier-plugin-tailwindcss`
sorts utility classes, and `tailwindStylesheet` in `.prettierrc` points at
`packages/web/src/index.css` so the plugin can see the v4 `@theme inline`
tokens and sort project-specific utilities like `bg-surface` correctly.

## Environment

| Variable      | Default                               | Used by                                |
| ------------- | ------------------------------------- | -------------------------------------- |
| `LOG_DIR`     | `~/.config/opencode/logs/wiretap`     | server                                 |
| `API_PORT`    | `3001`                                | server, web (Vite proxy target)        |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | server (read-only, for session titles) |

## Notes on the build

`shared` is **source-only** — its `exports` map points straight at
`./src/index.ts`. Bun executes the server's TypeScript directly and Vite
transpiles the symlinked workspace source, so there is no intermediate `dist`
to rebuild or go stale. `plugin` is the only package that emits JavaScript,
because OpenCode loads it as a compiled module.

The server requires the **Bun** runtime, not Node — `packages/server/src/db.ts`
uses `bun:sqlite` to read session titles out of OpenCode's database.
