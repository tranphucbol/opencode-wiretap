# opencode-wiretap

An [OpenCode](https://opencode.ai) plugin that logs raw LLM request bodies to disk for debugging and analysis.

## What it does

Intercepts outgoing fetch calls to LLM providers (Anthropic, OpenAI, Google, Bedrock, etc.) and writes each request body as a timestamped JSON file. Logs are organized by session ID.

**Log location:** `~/.config/opencode/logs/wiretap/<sessionId>/<timestamp>_<seq>.json`

Each file contains:

```json
{
  "timestamp": "2026-03-04T12:00:00.000Z",
  "url": "https://api.anthropic.com/v1/messages",
  "body": { "...raw request body..." }
}
```

## How it works

Two interception layers ensure coverage across all providers:

1. **`globalThis.fetch` wrapper** -- catches most providers since the AI SDK routes through fetch
2. **`chat.params` hook** -- wraps the per-request fetch passed to `streamText`, catching providers that bypass `globalThis.fetch` (e.g. AWS Bedrock)

Only requests with an AI-shaped body (containing `messages`, `input`, or `contents` arrays) are logged.

## Relationship to the rest of the workspace

This package is the **writer**. `@wiretap/server` is the **reader** and
`@wiretap/web` is the viewer. They share no code — only a file contract:

- **Path:** `$XDG_CONFIG_HOME/opencode/logs/wiretap/<sessionId>/<ts>_<seq>.json`
  (falls back to `~/.config`)
- **Envelope:** `{ timestamp, url, body }`

If you change either, update `packages/shared/src/types.ts` (`CapturedRequest`)
and `packages/server/src/index.ts` (`FILE_RE`, `DEFAULT_LOG_DIR`) to match.

## Installation

From the workspace root:

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
