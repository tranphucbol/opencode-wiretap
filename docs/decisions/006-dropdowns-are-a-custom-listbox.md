# 006: Dropdowns are a custom listbox, not a native `<select>`

Status: Accepted

## Decision

Every dropdown in the viewer is `Select` from
`packages/web/src/components/ui.tsx`: a `<button>` trigger plus a listbox the
component paints itself, rendered into `document.body` through a portal at
fixed coordinates. No `<select>` element remains in `packages/web`.

The three call sites are the session sort (`SessionsPane`), the model filter
(`RequestsPane`), and the auto-fetch interval (`App`).

## Rationale

A native `<select>` can be styled at rest, but its expanded option list is an
OS widget. Nothing in `index.css` reaches it — not the design tokens, not the
theme. On a dark-mode viewer the trigger was ours and the menu was the
platform's, which is exactly the seam a "DevTools-grade" inspector should not
show. That is the whole problem this record exists to close: it is a decision
about appearance, and appearance was the only thing wrong.

The alternative worth naming is a headless component library — Radix, Headless
UI, or similar. It was rejected on weight. `packages/web` builds into the
published viewer, and the requirement here is one small listbox with four to
six static options at three call sites; the accessible behaviour that matters
(roles, keyboard, dismissal) is a few dozen lines. Taking a dependency for it
would cost more than it removes.

The menu goes through a portal because every pane that holds one is
`overflow-hidden` — the panes are scroll containers by design — so an
absolutely positioned menu is clipped by its own header. Fixed coordinates
measured from the trigger avoid that without weakening the panes' clipping,
which the virtualised request list relies on. The tradeoff is that fixed
coordinates do not track a scrolling ancestor, so the menu closes on scroll
and resize instead of chasing the trigger. For a menu this short, closing is
both simpler and less jarring than a chase.

Focus stays on the trigger for the menu's whole lifetime and the highlighted
row is published with `aria-activedescendant`. This is the same shape as the
native control it replaces, and it means there is no focus to save and
restore, which is where hand-rolled menus usually break.

## Consequences

- Menus are themed by the same tokens as everything else and follow
  light/dark with no second code path.
- Keyboard support is ours to maintain: arrows, Home/End, Enter/Space, Escape,
  Tab, and type-ahead if it is ever wanted. Type-ahead is the one native
  affordance deliberately not reimplemented — no current option list is long
  enough to need it. Add it to `Select` rather than at a call site.
- Options can render arbitrary nodes, which the native control could not. The
  model filter uses this to show the same `ModelBadge` as the rows it filters,
  so the control looks like the thing it acts on.
- The trigger shows a focus ring only via `focus-visible`, so mouse users do
  not see one and keyboard users do. Losing the native ring was the one
  accessibility regression this swap could have caused.
- `Select` is generic over `string | number` values, so callers keep their own
  union types (`Sort`, `AutoFetchInterval`) without casting at the boundary.
