# 003: Cost is computed at read time, from OpenCode's price table

Status: Accepted

## Decision

The viewer computes the USD cost of a captured request when it reads the file,
using rates loaded from OpenCode's own models.dev snapshot at
`~/.cache/opencode/models.json` (override: `OPENCODE_MODELS`). No cost is
written into the capture file, and the plugin is not involved.

## Rationale

Two questions had to be answered: where the prices come from, and when the
multiplication happens.

**Where.** OpenCode already caches the entire models.dev catalogue on disk and
bills against it. Reading that file gives the viewer exactly the rates OpenCode
itself used, with no network call, no second source of truth to drift out of
sync, and no hand-maintained table to go stale. This mirrors `db.ts`, which
reads OpenCode's SQLite database for session titles. When the file is missing
the viewer degrades to "no costs", the same way a missing database degrades to
"no titles".

**When.** Costing in the plugin would freeze the number at capture time, add a
4.4 MB file read to the request hot path, and grow the on-disk envelope. It
would also lose the cost permanently for any request captured while the table
was unavailable. Costing at read time instead means every capture already on
disk gains a cost the moment the feature ships, and refreshing the price table
retroactively corrects history. The capture file stays a faithful record of
what the provider actually said; the price is an interpretation layered on top,
so it belongs on the reading side.

A consequence worth stating plainly: reported usage is _not_ normalized across
providers, and the arithmetic depends on knowing which convention produced it.
Anthropic's `input_tokens` is disjoint from its cache counters, while OpenAI's
includes `cached_tokens` as a subset. Multiplying both the same way
double-charges every cached OpenAI token. `UsageConvention` in
`packages/shared/src/cost.ts` makes this explicit rather than implicit, and it
is derived from the request host, alongside the provider id.

## Consequences

- Costs appear for historical captures without a migration, and a stale price
  table is fixed by refreshing one file rather than rewriting captures.
- The number is an estimate reconstructed from published rates. It does not
  account for negotiated pricing, credits, or provider-side rounding, and it
  will disagree with a provider invoice at the margin.
- Host resolution is an explicit allowlist in `pricing.ts`. An unlisted host
  yields no price at all. This is deliberate: guessing a provider id from an
  unknown host would silently invent numbers, and of the ~3.5k model ids in the
  catalogue, 835 have providers that disagree on price — `claude-opus-5` alone
  spans $0 to $6 per million input tokens. A bare model-id lookup is therefore
  only consulted when every provider defining that id agrees.
- Adding a provider means one line in the `HOSTS` table, including an explicit
  statement of its usage convention.
- Unknown is always `null`, never `0`, end to end — so "this was free" stays
  distinguishable from "we could not price this".
