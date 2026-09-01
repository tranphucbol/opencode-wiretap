# 002: A response is stored in its request's file

Status: Accepted

## Decision

A captured response is written into the **same** `<ts>_<seq>.json` file as its
request, under a new optional `response` key. The request half is still
written before the call goes out; the file is rewritten once the response
stream ends.

Both writes are atomic: write `<name>.tmp`, then `renameSync` over the target.

## Rationale

The alternative was a sidecar — `<ts>_<seq>.response.json` next to the
request. One file wins on the things that matter here:

- **A capture is one exchange.** Request and response are read together,
  always. A sidecar makes the viewer's detail route do two reads and reconcile
  a missing second file with an in-flight call, an aborted call, and a
  pre-upgrade capture — three states it would otherwise get for free from
  `response === undefined`.
- **No migration.** `response` is optional, so every file written before this
  change is still a valid `CapturedRequest`. The server's existing `try/catch`
  in the summary route already covers the rest.
- **The session listing stays a directory scan.** A sidecar would double the
  file count and force `/api/sessions/:id` to filter and pair names.

The cost is that capture files are now mutated after creation, which the
sidecar would have avoided.

Rewriting re-reads the file rather than holding the envelope in memory.
Request bodies are large and many can be in flight; the read costs a syscall
on a file that is almost certainly still in page cache.

## Consequences

- **Atomicity is mandatory, not a nicety.** `packages/server/src/index.ts`
  streams captures straight off disk with `createReadStream`. Without
  temp-and-rename a reader could be served a half-written file. Any future
  writer of these files must do the same.
- **Readers can observe two versions of the same file.** A directory watcher
  or an open editor sees the request-only version first and the complete
  version seconds later. The rename guarantees one or the other, never a torn
  file.
- **`response` is optional forever.** In-flight calls, aborted captures,
  captures where the tee failed, and every file written before this change all
  legitimately lack it. The UI treats absence as a state, not an error.
- **`message` inside `response` is separately optional.** Gemini traffic and
  non-2xx bodies store raw only. `state` describes stream completion
  (`complete` / `aborted` / `error`); whether the stored raw copy was capped is
  the independent `raw.truncated` flag, so a fully assembled message never
  looks damaged just because its raw copy was elided.
- The unit of capture is now an exchange, which makes the type name
  `CapturedRequest` wrong. Renaming it touches shared, server, web and the
  README for no functional gain, so it is deliberately left alone.
