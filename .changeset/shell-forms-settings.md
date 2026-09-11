---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/narduk-core': patch
---

Add `NeForm`, `NeFormSection` and `NeSettingsPage` (components-library backlog
item 19, narduk-libs#266; backlog narduk-libs#247), and deprecate
`narduk-core`'s `AppSettingsProfile`.

`NeForm` wraps Nuxt UI's `UForm` with a save bar that does not lie, closing
three named bug classes by construction:

- **Double-submit (stonx#37).** A capture-phase `submit` listener on a real DOM
  ancestor of `UForm`'s `<form>` drops a second submit while the first is still
  in flight, so two rapid submits issue exactly one `onSubmit` call.
- **A save bar that lies about dirtiness (stonx#36).** `Unsaved changes` is
  driven by `UForm`'s own `dirty` state, which only clears once `onSubmit`'s
  promise resolves — a rejected save leaves it dirty, with no optimistic
  "saved" flash to walk back.
- **Errors that do not scroll into view (stonx#350).** A schema (or `validate`)
  failure blocks submission and focuses the first invalid field, scrolled into
  view.

`UButton`'s own `loading-auto` drives the save button's spinner and disabled
state for the duration of the `onSubmit` promise — no ref to wire.
`NeFormSection` is a titled group of fields (a thin wrapper around
`NeSectionHeader`); `NeSettingsPage` composes `NePageHeader` with a `NeForm`
whose save bar is sticky by default, for a full settings screen built from one
or more sections.

Supersedes `narduk-core`'s `AppSettingsProfile`, deprecated in the same release
(D4, Logan 2026-09-11: "Deprecate, remove next major"). No behaviour change and
no removal: the component gains an `@deprecated` JSDoc block and a one-time,
dev-only `console.warn` pointing at `NeSettingsPage`. The migration mapping is
in narduk-core's README under "Deprecated components".
