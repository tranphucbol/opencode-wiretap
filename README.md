# opencode-wiretap

The TUI shows you a tidy conversation. The model gets something rather different:
your system prompt, every tool schema, the skill catalog, injected reminders, and
whatever the last dozen tool calls shoved into context. When an agent starts
behaving strangely, the answer is usually somewhere in that gap.

Wiretap records every request body [OpenCode](https://opencode.ai) puts on the
wire, and gives you somewhere decent to read them.

![Three-pane viewer](docs/screenshots/three-pane.png)

Sessions on the left, that session's requests in the middle, the decoded payload
on the right. Subagent sessions nest under the conversation that spawned them, so
you can follow a `@explore` run back to whoever asked for it.

## What you can actually see

A system prompt is rarely one thing. Wiretap splits it back into the pieces that
built it: your AGENTS.md, the `<env>` block, MCP instructions, the skill catalog.
Collapse whatever you're not chasing. Much nicer than scrolling 40 KB to work out
which file contributed those 300 lines.

![System prompt breakdown](docs/screenshots/system-prompt.png)

Tool definitions get their own tab, full descriptions included. This is normally
where your token budget went.

![Tool definitions](docs/screenshots/tools.png)

When you don't trust the pretty version, the original envelope is one click away,
byte for byte as it was serialized.

![Raw JSON](docs/screenshots/raw-json.png)

## Getting started

Build the plugin and point OpenCode at it, so there's something to look at:

```bash
bun install
bun run --filter opencode-wiretap build
```

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugin": ["/absolute/path/to/opencode-wiretap/packages/plugin"] }
```

Restart OpenCode, send a message, then start the viewer:

```bash
bun run dev          # Express API on :3001 + Vite on :5173
```

## How it fits together

```
packages/
├─ plugin/   opencode-wiretap    OpenCode plugin, writes captured requests to disk
├─ shared/   @wiretap/shared     Wire types + provider-shape normalizers
├─ server/   @wiretap/server     Express API, reads the log dir + OpenCode's SQLite
└─ web/      @wiretap/web        React + Vite three-pane viewer
```

Traffic moves one way: **plugin writes JSON files → server reads them → web
renders them.**

The plugin knows nothing about the other three. It hooks `globalThis.fetch` plus
OpenCode's `chat.params` (Bedrock brings its own HTTP client and skips the
global), keeps anything that looks like an LLM call, and drops it on disk. The
only thing tying it to the server is a file path and a
`{ timestamp, url, body }` envelope, both written down in
[`packages/plugin/README.md`](packages/plugin/README.md). Change one side and you
have to change the other.

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
| `bun run format:check` | Prettier `--check`, non-mutating, for CI                              |
| `bun run check`        | `format:check` + `typecheck`                                          |
| `bun run clean`        | Removes build output and `*.tsbuildinfo`                              |

Target one package directly with `bun run --filter @wiretap/web build`.

Prettier runs from the root for everything. `prettier-plugin-tailwindcss` sorts
the utility classes, and `tailwindStylesheet` in `.prettierrc` points it at
`packages/web/src/index.css` so it can read the v4 `@theme inline` tokens. Without
that line it has no idea `bg-surface` is a real utility and sorts it into the
wrong place.

## Environment

| Variable      | Default                               | Used by                                |
| ------------- | ------------------------------------- | -------------------------------------- |
| `LOG_DIR`     | `~/.config/opencode/logs/wiretap`     | server                                 |
| `API_PORT`    | `3001`                                | server, web (Vite proxy target)        |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | server (read-only, for session titles) |

## Two things that will trip you up

**`shared` has no build step, and shouldn't get one.** Its `exports` map points
straight at `./src/index.ts`. Bun runs the server's TypeScript as-is and Vite
transpiles the symlinked workspace source, so there's no intermediate `dist` sitting
around going stale. `plugin` is the only package that emits JavaScript, and only
because OpenCode loads it compiled.

**The server needs Bun, not Node.** `packages/server/src/db.ts` uses `bun:sqlite`
to read session titles out of OpenCode's own database.
