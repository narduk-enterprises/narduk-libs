---
'@narduk-enterprises/narduk-core': patch
---

Deprecate `AppConfirmModal`; removed in the next major.

Superseded by `NeConfirmDialog` / `useConfirm()` in
`@narduk-enterprises/narduk-shell` (components-library backlog item 16,
narduk-libs#263; decision D4, 2026-09-11: deprecate now, remove in the next
narduk-core major).

No behaviour change and no removal. The component gains an `@deprecated` JSDoc
block and a one-time, dev-only `console.warn` pointing at `NeConfirmDialog` /
`useConfirm()`. The call-site migration mapping — `v-model` → `v-model:open`,
`confirmColor="error"` → `tone="danger"`, `loading` → `pending`, the default
slot → `#body`, and the `icon` prop dropped — is in this package's README
under "Deprecations".
