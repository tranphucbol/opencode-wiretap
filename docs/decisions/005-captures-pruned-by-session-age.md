# 005: Captures are pruned a session at a time

Status: Accepted

## Decision

The plugin deletes capture logs on a retention window, measured in whole
session directories. A session directory is removed when nothing in it has
been written for longer than `WIRETAP_RETENTION_DAYS` days — 15 by default,
`0` to keep everything forever. Age comes from the newest mtime in the
directory, not from the timestamps in the filenames.

The sweep runs once, deferred, when the plugin loads
(`packages/plugin/src/prune.ts`, scheduled from `src/index.ts`).

## Rationale

Captures are only ever created, never replaced, and every LLM call in every
session writes one. Left alone the log root grows without bound, and the
biggest cost lands on the viewer: `GET /api/sessions` scans every session
directory and the cost sweep in `packages/server/src/costcache.ts` walks every
file. Retention keeps both bounded.

The obvious alternative was to delete individual files older than the window.
It was rejected because a session is a conversation: pruning per file would
leave long-running sessions with their opening turns missing, and a capture
without the requests that preceded it is close to useless for the debugging
this tool exists to support. Whole sessions expire together or not at all.

Age is taken from mtime rather than the filename timestamp because the
response half is rewritten into the file after the request lands. mtime is
therefore the moment the session actually went quiet, which is the thing the
window is meant to measure. It also handles files that do not match the
viewer's `FILE_RE`, which a filename-based rule would have to guess about.

Running the sweep at plugin init, rather than on every write, keeps the
request path free of filesystem work — the same reasoning as ADR 004, where
the expensive walk is kept off the hot read path. It is deferred behind a
zero-delay unref'd timer so it cannot slow OpenCode's startup or hold a
short-lived process open.

Putting this in the plugin rather than the viewer follows the existing split:
the plugin owns the log directory (it is the only writer), and the viewer must
keep working when it is only ever pointed at a directory someone else fills.

## Consequences

- Disk usage is bounded by activity in the last 15 days instead of by install
  age. Users who want the old behaviour set `WIRETAP_RETENTION_DAYS=0`.
- Captures disappear on their own. That is data loss by design, so the sweep
  is deliberately conservative: an unreadable session directory is kept, not
  deleted blind, and every failure is swallowed and skipped.
- Retention is enforced only when OpenCode starts with the plugin loaded. A
  machine that stops using the plugin keeps whatever was on disk at the time.
- The viewer's routes need no change — a session that is not on disk is
  already simply not listed. Its cost cache did: `costcache.ts` memoises every
  capture by `sessionId/filename` and never forgot anything, so retention would
  have made `costs.json` grow forever while the corpus it describes shrank. The
  sweep now evicts entries it did not encounter, but only for directories it
  successfully listed, so a transient `readdir` failure cannot throw work away.
