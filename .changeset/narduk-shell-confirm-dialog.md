---
'@narduk-enterprises/narduk-shell': minor
---

Add `NeConfirmDialog` and `useConfirm()` — the estate's "are you sure?" dialog
(components-library backlog item 16, narduk-libs#263; backlog narduk-libs#247).

`NeConfirmDialog` wraps Nuxt UI's `UModal`, so the containment
operator-portal#134 was filed about — a declared `aria-modal` with Tab not
trapped — comes from Reka UI's `FocusScope` by construction rather than being
re-implemented per app.

- Props `open` (`v-model:open`), `title`, `message`, `confirmLabel`,
  `cancelLabel`, `tone` (`default` | `danger`), `pending`, `error`, `body` (a
  component) and `props`, plus a `#body` slot. Emits `confirm`, `cancel`,
  `close` and `after:leave`.
- `pending` is `preventClose`: the confirm button goes loading, cancel is
  disabled, and Escape and outside clicks are ignored until the work settles.
- Initial focus lands on the least destructive button — Cancel for
  `tone="danger"`, Confirm otherwise.
- `useConfirm()` is auto-imported and built on `useOverlay`:
  `await confirm({ title, message, confirmLabel, cancelLabel, tone, body, props })`
  resolves `true` on confirm and `false` on cancel, Escape or dismissal. An
  optional async `onConfirm` holds the dialog pending until it settles, closing
  on success; on rejection the dialog stays open with the failure surfaced
  through the `error` prop so the user can retry or back out.

Supersedes narduk-core's `AppConfirmModal`, deprecated in the same release.
