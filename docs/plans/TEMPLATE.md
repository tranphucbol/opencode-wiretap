# Plan template

Copy this file to `docs/plans/NNN-<feature>.md` and replace every _italic
guidance line_. Delete sections that genuinely do not apply; an empty heading
is worse than no heading.

Rules the existing plans follow, and this one should too:

- **Point at code.** Every claim about current behaviour cites `file.ts:line`.
- **Decide, don't survey.** The Decisions table holds rulings, not options. If
  a choice is still open, the plan is not ready.
- **Name the consequences.** Anything that changes existing behaviour,
  weakens a guarantee, or was chosen without asking gets called out before the
  phases start.
- **Phases land green.** Each phase is independently shippable with `bun run
check` clean. Changes to `packages/server` also require `bun run build &&
bun run smoke`.
- **Write the test names.** Listing the cases up front is the cheapest scope
  check there is.
- **Keep it honest after the fact.** Update `Status:` and append deviations
  when the work lands. The plan is a record, not a pitch.

---

# Plan: _short imperative title_

Status: _`not started` / `in progress` / `done`. When done, state briefly how
reality differed from the sketch. Details go in "Deviations taken while
implementing"._

## The issue

_What does the tool do today, what does it fail to do, and how does that
failure present to the user? Prefer an observable symptom over an abstract
gap._

## Decisions

| #   | Decision                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | _One ruling per row. Present tense, stated as the new behaviour, with the reason attached when it is not obvious._ |

### Consequences worth naming

**_This is a behaviour change._** _What used to happen, what will happen, who
it affects, and the escape hatch if there is one._

**_This constrains the implementation._** _A decision that rules out a
library, requires a lower-level API, or changes a cross-package contract._

---

## Phase 0 - _the smallest change that unblocks the rest_

_Per file, describe what changes. New modules get their exported signature
inline._

| File                           | Responsibility                                 |
| ------------------------------ | ---------------------------------------------- |
| `packages/example/src/file.ts` | _One sentence, plus the failure mode it owns._ |

_Where resolution has cases, tabulate them. This is also the test matrix._

| Situation | Result |
| --------- | ------ |
| _..._     | _..._  |

## Phase 1 - _..._

## Phase _n_ - Tests and docs

_Always the last phase._

New cases:

- _Describe the scenario and expected result._

_Name the affected README or docs section, not just the file. Add an ADR under
`docs/decisions/` when this implementation makes an architectural decision._

Every phase ends with `bun run check` green. Changes to `packages/server` also
end with `bun run build && bun run smoke` green.

---

## Deviations taken while implementing

_Added as the work lands, numbered, each with a bolded one-line claim then the
reasoning. A deviation is the reason the next reader should not "fix" the code
back to what the plan said._

**1. _What actually happened._** _Why the plan's version was wrong or
unshippable._

---

## Out of scope

- _Adjacent thing a reader will assume is included, and the one-line reason it
  is not._
