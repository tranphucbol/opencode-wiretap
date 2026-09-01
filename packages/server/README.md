# opencode-wiretap-viewer

Reads the request bodies captured by the
[`opencode-wiretap`](https://www.npmjs.com/package/opencode-wiretap) plugin and
gives you somewhere decent to read them. One process, one port, UI and API
together — no build step, no config file.

```bash
bunx opencode-wiretap-viewer      # or: npx opencode-wiretap-viewer
```

<img src="https://raw.githubusercontent.com/tranphucbol/opencode-wiretap/main/docs/screenshots/three-pane.png" alt="Three-pane viewer" width="100%">

Sessions on the left, that session's requests in the middle, the decoded payload
on the right. Subagent sessions nest under the conversation that spawned them.

## You need the plugin too

This package is only the reader. Without captures on disk it starts fine and
shows you nothing. Add the plugin to your OpenCode config first:

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugin": ["opencode-wiretap"] }
```

Restart OpenCode, send a message, then start the viewer.

## What it shows you

A system prompt is rarely one thing, so the viewer splits it back into the pieces
that built it — your AGENTS.md, the `<env>` block, MCP instructions, the skill
catalog — each independently collapsible. Tool definitions get their own tab with
full descriptions, which is normally where your token budget went. When you don't
trust the pretty version, the original `{ timestamp, url, body }` envelope is one
click away, byte for byte as it was serialized.

## Options

```
  -p, --port <n>       port to listen on            (env PORT / API_PORT, default 3001)
  -l, --log-dir <dir>  wiretap capture directory    (env LOG_DIR)
      --db <file>      OpenCode SQLite database     (env OPENCODE_DB)
  -h, --help           show this message
```

CLI flags beat environment variables, which beat the defaults.

| Variable      | Default                               | Purpose                       |
| ------------- | ------------------------------------- | ----------------------------- |
| `LOG_DIR`     | `~/.config/opencode/logs/wiretap`     | where the plugin writes       |
| `PORT`        | `3001`                                | listen port                   |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | read-only, for session titles |

Point `--log-dir` at a copied capture directory to inspect someone else's
session, or `--port` at something else when 3001 is taken.

## Runtime

Node 20+ or Bun. Session titles come from OpenCode's own SQLite database, and the
backend is chosen at runtime: `bun:sqlite` under Bun, `node:sqlite` under
Node 22.13+, and no titles at all if neither is available. Everything else works
regardless — titles are the only thing you lose, and sessions still list by ID.

The database is opened read-only. The viewer never writes to it, and never writes
to your captures either.

## API

The UI is a client of these; they're stable enough to script against.

| Route                      | Returns                                                   |
| -------------------------- | --------------------------------------------------------- |
| `GET /api/sessions`        | every session, newest first, with titles and parent IDs   |
| `GET /api/sessions/:id`    | that session's requests — model, message count, size      |
| `GET /api/sessions/:id/:f` | one captured request, streamed verbatim                   |
| `GET /api/config`          | resolved `logDir`, `dbPath`, and whether the DB was found |

Session IDs and filenames are pattern-checked and resolved inside the log
directory, so `..` gets you a 400 rather than a file. Anything else under `/api`
404s as JSON; every other path serves the SPA.

## Links

- [Repository and full documentation](https://github.com/tranphucbol/opencode-wiretap#readme)
- [Issues](https://github.com/tranphucbol/opencode-wiretap/issues)

MIT
