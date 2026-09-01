# Decisions

Architecture decision records (ADRs). One file per decision, numbered, never
renumbered. A decision that is later reversed keeps its file and gains a
status, so the reasoning behind the reversal has something to point at.

| #   | Decision                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ |
| 001 | [The plugin bundles `@wiretap/shared`](001-plugin-bundles-shared.md)                             |
| 002 | [A response is stored in its request's file](002-response-in-request-file.md)                    |
| 003 | [Cost is computed at read time, from OpenCode's price table](003-cost-computed-at-read-time.md)  |
| 004 | [Session cost totals come from a background sweep](004-session-totals-swept-in-background.md)    |
| 005 | [Captures are pruned a session at a time](005-captures-pruned-by-session-age.md)                 |
| 006 | [Dropdowns are a custom listbox, not a native `<select>`](006-dropdowns-are-a-custom-listbox.md) |

`TEMPLATE.md` is the shape of a new record. Add each decision to the table
when it is created.
