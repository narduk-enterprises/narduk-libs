---
'@narduk-enterprises/narduk-core': patch
---

Deprecate `AppConfirmModal`; removed in the next major.

Superseded by `NeConfirmDialog` / `useConfirm()` in
`@narduk-enterprises/narduk-shell` (components-library backlog item 16,
narduk-libs#263; decision D4, 2026-09-11: deprecate now, remove in the next
narduk-core major).

No behaviour change: the component is untouched apart from an `@deprecated`
JSDoc block pointing at the replacement. The call-site migration mapping —
`v-model` → `v-model:open`, `confirmColor="error"` → `tone="danger"`, `loading`
→ `pending`, the default slot → `#body`, and the `icon` prop dropped — is in
this package's README under "Deprecations".
