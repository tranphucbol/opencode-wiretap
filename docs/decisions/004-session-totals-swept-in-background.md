# 004: Session cost totals come from a background sweep

Status: Accepted

## Decision

`GET /api/sessions` never computes cost. It reports whatever totals a
background sweep has already cached, and `null` for sessions the sweep has not
reached. The sweep memoises each file's cost against its `(mtime, size)` and
persists that map to `~/.cache/opencode-wiretap/costs.json` (override:
`WIRETAP_COST_CACHE`). `GET /api/cost/status` exposes its progress.

## Rationale

Totalling a session means reading and parsing every capture in it, and the
sessions route is deliberately a shallow scan that parses nothing. Measured
against a real corpus of 32,645 files across 1,186 sessions totalling 10 GB:

| pass over every file | cold   | warm   |
| -------------------- | ------ | ------ |
| `stat` only          | 0.35 s | 0.35 s |
| read + `JSON.parse`  | ~309 s | 13 s   |

Costing inline would have turned a sub-second route into a five-minute one. The
cost is dominated by disk, not CPU, so it cannot be optimised away — but it
only has to be paid once per file, because a capture is rewritten exactly once,
when its response lands, and that moves both mtime and size. Memoising on that
pair reduces every subsequent pass to the 0.35 s stat sweep.

That leaves the first pass. Blocking on it would mean a five-minute spinner on
first launch; doing it inline per request would mean paying it repeatedly. So
the sweep runs off the request path, starting at boot and re-arming whenever
the sessions route is hit, and the UI polls its progress so a long first pass
is legible rather than silent.

Two further points made this shape clearly correct. Most captures have no
response and therefore no cost, so the sweep skips `JSON.parse` entirely for
any file that does not contain the literal `"response"` — a conservative filter
that can produce false positives (costing a wasted parse) but never false
negatives. And `null` had to mean _not costed yet_, distinct from `0`, or a
sweep still in flight would be indistinguishable from a genuinely free session.

## Consequences

- The sessions route keeps its original cost profile; totals arrive
  asynchronously and fill in on refresh.
- Steady state after the first sweep is a stat sweep. Measured warm: 53 ms for
  202 files, extrapolating to roughly 8.5 s for the full 32.6k-file corpus.
- A new on-disk artifact outside the log directory, keyed by absolute path. It
  is a pure cache: deleting it costs one rebuild and nothing else. It is
  written atomically, temp file then rename, like the captures themselves.
- If the price table cannot be loaded the sweep records no totals at all rather
  than zeroes, so a missing `models.json` reads as "unknown" rather than
  claiming every session was free.
- The sweep holds one entry per capture file in memory for the process
  lifetime — tuples, not objects, for that reason. At the measured corpus size
  this is a few megabytes.
