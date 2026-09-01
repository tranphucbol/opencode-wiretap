# opencode-wiretap

An [OpenCode](https://opencode.ai) plugin that logs raw LLM request bodies to disk for debugging and analysis.

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugin": ["opencode-wiretap"] }
```

Restart OpenCode and it starts capturing. To read the captures, run the viewer:

```bash
bunx opencode-wiretap-viewer      # or: npx opencode-wiretap-viewer
```

## What it does

Intercepts outgoing fetch calls to LLM providers (Anthropic, OpenAI, Google, Bedrock, etc.) and writes each request body as a timestamped JSON file, then fills in what came back once the response stream ends. Logs are organized by session ID.

**Log location:** `~/.config/opencode/logs/wiretap/<sessionId>/<timestamp>_<seq>.json`

Each file contains:

```json
{
  "timestamp": "2026-03-04T12:00:00.000Z",
  "url": "https://api.anthropic.com/v1/messages",
  "body": { "...raw request body..." },
  "response": {
    "status": 200,
    "headers": { "...allowlisted response headers..." },
    "startedAt": "2026-03-04T12:00:00.180Z",
    "completedAt": "2026-03-04T12:00:04.900Z",
    "ttfbMs": 180,
    "durationMs": 4720,
    "state": "complete",
    "message": { "...assembled reply, as content blocks..." },
    "raw": { "encoding": "sse", "text": "...", "bytes": 8134, "truncated": false }
  }
}
```

### Reading the response half

- **`response` is absent** while the call is in flight, if the tee could not be
  set up, and on every capture written before this feature existed.
- **`state`** describes the stream only: `complete`, `aborted` (died
  mid-message) or `error` (non-2xx). Whether the stored raw copy was capped is
  the separate `raw.truncated` flag.
- **`message`** is the reply reassembled into the same content blocks the
  request uses, so the viewer renders both halves identically. It is present
  for Anthropic Messages, OpenAI Chat Completions and OpenAI Responses. Other
  grammars — Gemini, error pages — store `raw` only.
- **`raw.text`** is capped at `WIRETAP_RAW_MAX_BYTES` bytes (default 1 MiB).
  Assembly always runs over the whole stream, never the capped copy, so a
  truncated `raw` does not mean a truncated `message`.
- **`headers`** is an allowlist: content type, request ids and rate-limit
  families. Nothing credential-shaped is written to disk.

Capture is fire-and-forget. The response is handed back to OpenCode
immediately and drained on a detached promise, so nothing here can slow down
or fail a real request.

## Retention

Captures are deleted after **15 days**. Once per OpenCode start the plugin
sweeps the log root and removes every session directory that has not been
written to inside the window.

```bash
WIRETAP_RETENTION_DAYS=30   # keep a month instead
WIRETAP_RETENTION_DAYS=0    # keep everything, forever
```

Sessions expire whole. A conversation missing its opening turns is worse than
no conversation at all, so a long-running session is kept in full until its
_last_ capture falls outside the window, then dropped in one go. See
`docs/decisions/005-captures-pruned-by-session-age.md`.

## How it works

Two interception layers ensure coverage across all providers:

1. **`globalThis.fetch` wrapper** -- catches most providers since the AI SDK routes through fetch
2. **`chat.params` hook** -- wraps the per-request fetch passed to `streamText`, catching providers that bypass `globalThis.fetch` (e.g. AWS Bedrock)

Only requests with an AI-shaped body (containing `messages`, `input`, or `contents` arrays) are logged.

## Relationship to the rest of the workspace

This package is the **writer**.
[`opencode-wiretap-viewer`](https://www.npmjs.com/package/opencode-wiretap-viewer)
is the **reader**, and carries the web UI with it. At runtime they are coupled
only by a file contract:

- **Path:** `$XDG_CONFIG_HOME/opencode/logs/wiretap/<sessionId>/<ts>_<seq>.json`
  (falls back to `~/.config`)
- **Envelope:** `{ timestamp, url, body, response? }`

If you change either, update `packages/shared/src/types.ts` (`CapturedRequest`)
and `packages/server/src/index.ts` (`FILE_RE`, `DEFAULT_LOG_DIR`) to match.

At the source level they do share code: both bundle `@wiretap/shared`, the
plugin for the response assemblers that turn a provider stream back into
content blocks. That coupling is build-time only — `shared` is inlined and
never appears in the published artifact. See
`docs/decisions/001-plugin-bundles-shared.md`.

Files are written atomically (temp file, then rename) because the request half
lands before the call and the response half is rewritten in afterwards. A
reader always sees one complete version or the other. See
`docs/decisions/002-response-in-request-file.md`.

## Installing from source

Instead of the npm package above, to hack on it:

```bash
bun install
bun run --filter opencode-wiretap build
```

Then point your OpenCode config (`~/.config/opencode/opencode.jsonc`) at the
built package directory:

```json
{
  "plugin": ["/absolute/path/to/opencode-wiretap/packages/plugin"]
}
```
