# 007: Blocks render, with the wire text one click away

Status: Accepted

## Decision

Two content block types in the structured view get a rendered presentation
instead of a `<pre>`:

- **Assistant `text`** is parsed as GitHub-flavoured markdown
  (`packages/web/src/components/Markdown.tsx`).
- **`tool_use.input`, `tool_result.content`, and unknown block types** are
  walked as a JSON tree with `react-json-view-lite` whenever the value is
  object-shaped (`packages/web/src/lib/json.ts`).

Every rendered block carries a two-way switch in its header — `markdown/raw`,
`tree/raw` — and the raw side is the same `<pre>` the viewer showed before.
Nothing else changed: user text, `thinking`, system prompts, and the whole
`raw` mode are untouched.

## Rationale

A wiretap's job is to show what went over the wire, and for two years the
answer to "how should this be displayed" was "verbatim, in a monospace block."
That is right for fidelity and wrong for reading. A 3,000-character assistant
turn full of `##` headings and bullet lists is legible in a chat client and a
wall in a `<pre>`; tool arguments arrive as `JSON.stringify(input, null, 2)`
and cannot be collapsed, so a `Write` call's `content` field buries the
`filePath` above it.

The tension is real, so the answer is not to pick a side. Rendering is the
default because it is what you want ninety-nine reads out of a hundred, and
the toggle is there because the hundredth read is the one the tool exists for.
The raw view stays a byte-faithful `<pre>` — it is not a "prettier raw," it is
the old behaviour, unmoved.

Rendering is scoped to assistant text on purpose. User turns are typed by a
human and are as often shell fragments and pasted logs as prose; markdown
would reflow them into something the user did not write. The model, by
contrast, is demonstrably emitting markdown — it is trained to.

Three things pushed on the markdown choice:

- **Raw HTML is not rendered, and not dropped either.** react-markdown ignores
  `html` mdast nodes unless `rehype-raw` is in the pipeline. Ignoring them
  would silently delete `<system-reminder>`, `<available_skills>`, and every
  other angle-bracket tag the harness injects — a wiretap that hides content is
  worse than one that is ugly. `rehype-raw` would go the other way and execute
  page-authored markup. A four-line remark plugin re-types `html` nodes as
  `text`, so tag-shaped source renders as the literal characters that were
  sent. That also keeps the surface XSS-free without a sanitiser: the only
  markup in the DOM is markup react-markdown built.
- **Truncation had to change shape.** `CollapsibleText` cuts at 600
  characters, which severs a markdown document mid-fence and a JSON tree
  mid-object. Rendered blocks clamp by height instead (`CollapsibleBody`),
  with a fade and a `show all`. The character count still decides _whether_ to
  clamp, so the threshold stays one constant.
- **A JSON tree is only offered when there is a tree.** Providers hand tool
  arguments over as an already-parsed object _or_ as a string, and a stream cut
  mid-call leaves a fragment that parses as neither. `asJsonTree` returns
  `undefined` for the fragment and the block stays text — the broken payload is
  precisely the thing worth seeing, so it is shown, not swallowed.

`react-markdown` + `remark-gfm` costs about 110 kB raw / 35 kB gzipped in the
published viewer bundle. That is a real number and it was weighed: a
hand-rolled subset would have to cover fences, nested lists, tables, and
inline code correctly, and the failure mode of a homegrown parser is silent
mangling of the very content the tool is meant to report faithfully. For a
tool served over localhost, the dependency is the cheaper mistake.

## Consequences

- The published viewer bundle grows to ~415 kB (125 kB gzipped). It is served
  from localhost, so this is a build-time number, not a user-facing one.
- `packages/web/tsconfig.json` now includes the `bun` type package, for
  `bun:test` in `src/lib/json.test.ts` only — the same carve-out
  `packages/shared` already documents.
- Toggle state is per block and resets when the detail pane remounts. That is
  deliberate: the rendered view is the default worth returning to, and a
  sticky preference would be a setting nobody asked for.
- Markdown styling lives in a single `.md` block in `index.css`, driven by the
  same `--color-*` tokens as everything else, so it follows light/dark without
  a second theme. Anything scoped outside `.md` would leak into the raw view.
- `.jv-string` now wraps instead of scrolling sideways, because tool arguments
  routinely carry a whole file in one string. This also affects the pre-existing
  `raw` JSON mode, which had the same problem and no reason to keep it.
- If a future provider ships a block type worth rendering — a citation list, an
  image — it goes through the same shape: render by default, `raw` in the
  header, never one without the other.
