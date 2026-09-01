# Plan: Capture LLM responses alongside requests

Status: `done`

## The issue

The plugin captures what OpenCode **sends** and nothing of what comes **back**.
`tryLog` (`packages/plugin/src/index.ts:62`) writes the envelope before the call
and the wrappers then return the provider's response untouched
(`packages/plugin/src/index.ts:87`, `:108`).

How that presents: you open a capture in the viewer, see a well-formed request
with the right tools and system prompt, and have no way to tell what the model
replied — or whether it replied at all. The cases you most want a wiretap for
are exactly the ones with no evidence in the log:

- The provider returned `429`/`500` and OpenCode retried. Nothing on disk
  distinguishes that from a successful call.
- The model emitted a malformed `tool_use` argument. You see the tool
  definition that was sent, never the call that came back.
- A stream died mid-message. The request file looks perfectly normal.

Every capture is half a conversation, and the missing half is the half that
went wrong.

## Decisions

| #   | Decision                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A response is stored in the **same file** as its request, under a new optional `response` key. The request is still written before the call; the file is rewritten once the stream ends.                                                             |
| 2   | Both writes are **atomic** — write `<name>.tmp`, then `renameSync`. The detail route streams files off disk (`packages/server/src/index.ts:175`) and would otherwise serve a half-written file.                                                      |
| 3   | We persist **both** an assembled message and the raw stream text, with raw capped at `WIRETAP_RAW_MAX_BYTES` (default 1 MiB). Assembly always runs over the _full_ stream, never the capped copy.                                                    |
| 4   | Assembly runs **in the plugin**, at stream end. It is the only place with the complete stream, since raw may be truncated before it reaches disk.                                                                                                    |
| 5   | The assembled message reuses the existing `ContentBlock` type (`packages/shared/src/types.ts:4`) so the viewer renders responses through the same `BlockView` it already uses for requests.                                                          |
| 6   | The plugin build becomes a **bundle** (`Bun.build` + `tsc --emitDeclarationOnly`). Follows from decision 4: a `tsc`-emit plugin cannot import shared code.                                                                                           |
| 7   | Assemblers ship for **Anthropic Messages**, **OpenAI Chat Completions**, and **OpenAI Responses**. Google/Gemini and anything unrecognised store raw only, with no `message`.                                                                        |
| 8   | `state` describes **stream completion only** (`complete` / `aborted` / `error`). Whether raw hit the cap is a separate `raw.truncated` flag. Conflating them would make a fully-assembled message look damaged just because its raw copy was elided. |
| 9   | Response headers are stored through an **allowlist**, never wholesale, so nothing credential-shaped is written to disk.                                                                                                                              |
| 10  | Capture is **fire-and-forget**. The response is returned to OpenCode immediately; draining happens on a detached promise and every error inside it is swallowed.                                                                                     |

### Consequences worth naming

**The plugin and the viewer stop being code-independent.**
`packages/plugin/README.md:45` currently states they "share no code — only a
file contract". Decision 4 makes the plugin import `@wiretap/shared`, so that
sentence becomes false and the README must change. The file contract remains
the real coupling; the shared import is a build-time convenience that gets
inlined and never appears in the published artifact. `AGENTS.md` also says
shared "is bundled into the viewer instead" — that becomes "into the viewer and
the plugin".

**The plugin's published output changes shape.** Today `tsc` emits one file per
source file; after decision 6 it emits a single bundled `dist/index.js`.
`main`, `types` and `exports` (`packages/plugin/package.json:22-29`) keep
pointing at the same paths, and `dist/index.d.ts` is still produced, so
consumers see no difference. But it is a real change to a published package and
is why it lands alone in Phase 0.

**Capture files are now mutated after creation.** Anything that assumed a
finished file — a directory watcher, an editor open on a capture — can observe
the request-only version first and the complete version a few seconds later.
The atomic rename in decision 2 guarantees readers see one or the other, never
a torn file.

**We tee a stream OpenCode depends on.** `res.clone()` buffers for whichever
branch reads slower. We drain eagerly so we are never that branch, but if
OpenCode abandons a response without reading it, the tee holds those chunks
until collection. The byte cap bounds the damage. This is the one change that
could, if wrong, be visible to the user as a stall — which is why draining is
detached and capped rather than awaited.

**Anthropic and OpenAI only, chosen deliberately.** Gemini traffic will show a
response with raw text and no assembled message. The viewer must render that
state rather than assume `message` exists.

---

## Phase 0 - Bundle the plugin

The smallest change that unblocks decision 4. No behaviour change; purely how
`dist/` is produced.

| File                               | Responsibility                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin/scripts/build.ts` | New. `Bun.build` with `target: "node"`, `format: "esm"`, `sourcemap: "linked"`, `external: ["@opencode-ai/plugin"]`. Mirrors the server's build script. |
| `packages/plugin/package.json`     | `build` becomes `clean && bun run scripts/build.ts && tsc -p tsconfig.json --emitDeclarationOnly`. Add `@wiretap/shared` as a dependency.               |
| `packages/plugin/tsconfig.json`    | Relax `rootDir` (`:7`) so a shared import outside `src/` type-checks. `declaration` (`:9`) stays on.                                                    |

Phase gate: `bun run check` green, `dist/index.js` and `dist/index.d.ts` both
present, and the built plugin still loads in OpenCode and writes a capture.

## Phase 1 - Response types and assemblers

Pure functions, no I/O. Independently testable and shippable.

| File                              | Responsibility                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`    | Add `CapturedResponse`, `AssembledMessage`, `Usage`. Add optional `response` to `CapturedRequest` (`:63`) — optional, so every existing capture stays valid and no migration is needed.             |
| `packages/shared/src/sse.ts`      | New. `parseSseEvents(text: string): SseEvent[]` — splits on blank lines, handles multi-line `data:`, tolerates a truncated trailing event. Provider-agnostic.                                       |
| `packages/shared/src/assemble.ts` | New. `assembleResponse(url: string, contentType: string, text: string): AssembledMessage \| undefined`. Dispatches on provider, owns the failure mode "unknown grammar → `undefined`, never throw". |
| `packages/shared/src/index.ts`    | Re-export the above.                                                                                                                                                                                |

```ts
interface CapturedResponse {
  status: number;
  headers: Record<string, string>; // allowlisted
  startedAt: string; // response headers arrived
  completedAt: string; // stream ended
  ttfbMs: number; // request sent -> headers
  durationMs: number; // headers -> stream end
  state: "complete" | "aborted" | "error";
  error?: string;
  message?: AssembledMessage; // absent for unknown grammars
  raw?: {
    encoding: "sse" | "json" | "text";
    text: string;
    bytes: number;
    truncated: boolean;
  };
}

interface AssembledMessage {
  model?: string;
  role?: string;
  content: ContentBlock[]; // reuses the request-side block type
  stop_reason?: string | null;
  usage?: Usage;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
}
```

Grammar dispatch, which is also the assembler test matrix:

| Body shape                                                   | Assembler          | Produces                                            |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------------- |
| SSE with `message_start` / `content_block_delta`             | Anthropic stream   | text, thinking, tool_use blocks; usage; stop_reason |
| SSE with `choices[].delta`                                   | OpenAI Chat        | text blocks; tool_calls merged by index; usage      |
| SSE with `response.output_text.delta` / `response.completed` | OpenAI Responses   | text, reasoning, function_call blocks; usage        |
| JSON with top-level `content[]` and `stop_reason`            | Anthropic single   | same as its stream form                             |
| JSON with `choices[].message`                                | OpenAI Chat single | same as its stream form                             |
| Anything else (Gemini, HTML error pages, provider outages)   | none               | `undefined`                                         |

## Phase 2 - Capture the response in the plugin

| File                             | Responsibility                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin/src/write.ts`   | New. Extract `writeLog` (`packages/plugin/src/index.ts:45`) and add `rewriteWithResponse`. Owns atomic temp+rename and the "never throw" guarantee. |
| `packages/plugin/src/capture.ts` | New. `beginCapture(init, input): Capture \| null` and `Capture.attach(res: Response): Response`. Owns the tee, the cap, and state resolution.       |
| `packages/plugin/src/index.ts`   | `tryLog` becomes `beginCapture`; both wrappers (`:85`, `:103`) call `attach` only when they hold a handle.                                          |

Ownership falls out of the existing dedupe rather than needing new state. The
`WeakSet` (`packages/plugin/src/index.ts:22`) already ensures exactly one layer
logs a given request: layer 2 calls `beginCapture` first and wins, so layer 1
receives `null` and passes the response straight through. One tee, always by
the layer that wrote the file.

```ts
const capture = beginCapture(init, input);
const res = await originalFetch(input, init);
return capture ? capture.attach(res) : res;
```

`attach` clones, starts a detached drain, and returns the **original** response
synchronously. It never awaits.

State resolution, which is also the capture test matrix:

| Situation                               | state                               | message                | raw                       |
| --------------------------------------- | ----------------------------------- | ---------------------- | ------------------------- |
| 2xx SSE, reader reaches `done`          | `complete`                          | assembled              | capped SSE text           |
| 2xx non-SSE JSON                        | `complete`                          | assembled if known     | full JSON, capped         |
| non-2xx (`429`, `500`, HTML error page) | `error`                             | absent                 | full body, capped         |
| reader throws / aborted mid-stream      | `aborted`                           | assembled from partial | partial text, capped      |
| stream exceeds cap                      | unaffected                          | assembled from full    | prefix, `truncated: true` |
| `204` or `res.body === null`            | `complete`                          | absent                 | absent                    |
| `clone()` throws                        | none — no `response` key is written | absent                 | absent                    |

The last row matters: a capture failure must leave the request file exactly as
Phase 0 left it, never a partial `response`.

## Phase 3 - Surface it in the viewer

| File                                           | Responsibility                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`                 | `RequestSummary` (`:80`) gains `status: number \| null` and `outputTokens: number \| null`.                                     |
| `packages/server/src/index.ts`                 | Populate the new fields in the summary route (`:131-153`). Existing `try/catch` (`:148`) already covers request-only files.     |
| `packages/web/src/components/RequestsPane.tsx` | Show status and output tokens per row; make non-2xx visually distinct.                                                          |
| `packages/web/src/components/DetailPane.tsx`   | New Response section below the request: status, timings, usage, assembled blocks via existing `BlockView`, raw behind a toggle. |

Three empty states the UI must handle rather than assume away: no `response`
yet (in flight, or pre-upgrade capture), `response` with no `message` (Gemini or
an error), and `raw.truncated`.

Phase gate: `packages/server` changed, so `bun run build && bun run smoke` as
well as `bun run check`.

## Phase 4 - Tests and docs

New cases:

**SSE parsing** (`packages/shared/src/sse.test.ts`)

- Multi-line `data:` fields concatenate into one event.
- `event:` lines and comment lines (`:`) are handled.
- A stream cut mid-event yields the complete events and drops the partial without throwing.
- `[DONE]` sentinel terminates without producing a bogus event.

**Anthropic assembly** (`packages/shared/src/assemble.test.ts`)

- Text-only stream produces a single text block with deltas concatenated in order.
- Interleaved thinking and text produce two blocks in emission order.
- `tool_use` with `input_json_delta` fragments reassembles into valid parsed JSON.
- `usage` merges `message_start` input tokens with `message_delta` output tokens.
- Truncated mid-`tool_use` yields the blocks so far and does not throw.
- Non-stream JSON message produces the same blocks as the equivalent stream.

**OpenAI assembly**

- Chat Completions text stream concatenates `choices[0].delta.content`.
- Chat Completions `tool_calls` merge by `index` across chunks.
- Responses API `output_text.delta` concatenates and `response.completed` supplies usage.
- Responses API reasoning items surface as thinking blocks.

**Grammar dispatch**

- A Gemini body returns `undefined` rather than throwing.
- An HTML error page returns `undefined` rather than throwing.

**Capture behaviour** (`packages/plugin/src/capture.test.ts`, fake `fetch` + `ReadableStream`)

- `attach` returns a response whose body is byte-identical to the upstream one.
- The returned response is usable before the drain finishes — capture never blocks the caller.
- Each row of the Phase 2 state table.
- A throwing `writeFileSync` does not propagate to the caller.
- Only one file is written when both wrapper layers see the same request.

**End to end** (`scripts/smoke.ts`)

- Seed a capture carrying a full `response`; assert the detail route returns it and the summary route reports its status.
- Keep one request-only capture in the fixture set to prove old files still load.

Docs:

- `packages/plugin/README.md` — the envelope block (`:24-30`), the file contract (`:48-53`), and the "share no code" claim (`:45`).
- `AGENTS.md` — the envelope in the coupling rule, and the shared-is-bundled-into-the-viewer line.
- `docs/decisions/001-plugin-bundles-shared.md` — why the plugin gained a build step and a shared import, with "duplicate the assemblers into the plugin" recorded as the rejected alternative.
- `docs/decisions/002-response-in-request-file.md` — same file with rewrite, versus a sidecar file. Both records added to the table in `docs/decisions/README.md`.

Every phase ends with `bun run check` green. Phase 3 also ends with `bun run
build && bun run smoke` green.

---

## Deviations taken while implementing

**Clone before touching `res.body`, or you lock OpenCode out of its own
response.** The largest finding, caught by the Phase 4 test asserting the
returned response is usable. In Bun, reading `res.body` _before_ `res.clone()`
leaves the caller holding the pre-tee stream, which the tee then locks —
OpenCode's own read throws `TypeError: ReadableStream is locked`. The plan's
sketch checks `res.body === null` before cloning, which triggers exactly this.
`attach` now clones first and inspects the clone. `capture.test.ts` carries a
named regression test for it.

**`rootDir` did not need relaxing; `allowImportingTsExtensions` did.** Phase 0
predicted the shared import would break `rootDir: "./src"`. It does not — tsc
does not emit declarations for files reached through `node_modules`, so the
`rootDir` check never sees them. The actual blocker was the plugin tsconfig
overriding the base's `allowImportingTsExtensions` to `false`, which rejects
`shared`'s `./types.ts` imports.

**Three tsconfigs in the plugin, and Bun-only types.** Declaration emit needs
`rootDir: "./src"`, which `scripts/` violates, so `tsconfig.build.json` was
split out for the emit and also excludes `*.test.ts` (tsc emits a `.d.ts` per
source file, and the bundle has no matching modules for them — `scripts/build.ts`
deletes all but `index.d.ts`). Types are `["bun"]`, not `["node", "bun"]`:
listing both puts two incompatible `Response` declarations in scope.

**`@wiretap/shared` is a devDependency of the plugin, not a dependency.** The
plan said dependency. It is private and never published, so a real dependency
would make `npm install opencode-wiretap` fail on a registry lookup. It is
inlined at build time, which is what the server already does.

**OpenAI Responses non-streaming JSON is assembled too.** The Phase 1 dispatch
table lists only the two single-response grammars. Adding the third reuses the
same item-conversion the stream form uses and closes a hole for
`stream: false` against the Responses API.

**`[DONE]` is parsed as an event and discarded one level up.** The plan puts
"`[DONE]` terminates without producing a bogus event" under SSE parsing.
`parseSseEvents` stays faithful to the wire — `[DONE]` _is_ an event — and
`parseSseData` returns `undefined` for it, so no assembler ever sees it. Tested
at both levels.

**`bun run check` now runs the tests.** Phase 4 adds a test suite; leaving it
outside the gate would mean it never runs. `check` is `format:check` +
`typecheck` + `test`, and `AGENTS.md`, the root `README.md` script table and
the phase-gate wording were updated to match.

**A status chip in the detail header.** Not in the Phase 3 table. The Response
section sits below the message list, which is often thousands of lines, so a
failed call was invisible without scrolling to the bottom.

---

## Out of scope

- **Google/Gemini assembly.** Deferred to keep the first pass to two grammars; raw is still captured, so nothing is lost permanently.
- **Renaming `CapturedRequest` to `CapturedExchange`.** With responses included the unit is an exchange and the name is wrong, but the rename touches shared, server, web and the README for no functional gain. Separate change.
- **Retry correlation.** When OpenCode retries a failed call, each attempt is its own capture file with its own sequence number. Linking attempts into one logical exchange needs a correlation key the plugin does not currently have.
- **Redacting response content.** The request side already writes prompts verbatim; responses are no more sensitive. Header allowlisting (decision 9) is the exception because headers carry credential-shaped values that the body does not.
- **A wire-level `stream: false` override.** Forcing non-streaming responses would make capture trivial but changes the behaviour of the thing being observed.
