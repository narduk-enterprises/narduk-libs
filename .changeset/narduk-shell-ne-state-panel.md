---
'@narduk-enterprises/narduk-shell': minor
---

Add `NeStatePanel`, the suite's first component (components-library backlog item
7, narduk-libs#254; backlog narduk-libs#247; standing decision company-hq
D-WEBFOUND-2 and its 2026-09-11 amendment).

One panel for the five readings a data surface actually has — **empty · loading
· error · blocked · absent** — wrapping `UEmpty` (`empty`/`absent`), `USkeleton`
(`loading`) and `UAlert` (`error`/`blocked`) rather than reimplementing them.

It has five readings rather than the usual "empty or not" because of the bug
class that forecloses: a surface that cannot tell **unknown** from **zero**
renders a confident `0`, a green "queue clear" nothing can know is clear, or a
red `UNKNOWN` on a thirty-second-old feed (operator-portal#183, #162, #100, #21;
#282 asks for exactly this component). `absent` — no producer publishes this
fact at all — is therefore a distinct reading with its own wording, its own icon
and its own shape, and never looks like `empty` or `loading`.

- `state` takes one of `'empty' | 'loading' | 'error' | 'blocked' | 'absent'`,
  or bind `useAsyncData()`'s `status` straight through: `idle` and `pending`
  render `loading`, `error` renders `error`, and `success` renders the default
  slot, because success is not a state. `state` wins over `status` whenever it
  is set, so the two compose.
- `title`, `message`, `icon` and `eyebrow`, plus `gaps`, `unblocksOn`,
  `unblocksRef` and `unblocksHref` ported from operator-portal's `StatePanel`.
- Slots: `default` (the content the panel replaces) and `#action`.
- Accessibility by construction: `loading` is a polite `role="status"` live
  region with `aria-busy="true"`, `error` is `role="alert"` via `UAlert`, and
  `empty`/`absent`/`blocked` are `role="status"`. Every state renders its own
  name as text, so no reading depends on colour. `absent` and `blocked` never
  render as an empty list. Both the mount suite and the SSR suite assert this
  in the server output as well as after hydration.
- Public types `NeStateValue`, `NeAsyncDataStatus`, `NeStateGap` and
  `NeStatePanelProps` are re-exported from the package entry.

Supersedes `narduk-core`'s `AppEmptyState`, deprecated in the same release (D4).
