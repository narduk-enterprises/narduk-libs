---
'@narduk-enterprises/narduk-core': patch
---

Amend the `AppEmptyState` and `AppConfirmModal` deprecation warnings to say
their `@narduk-enterprises/narduk-shell` replacements (`NeStatePanel`,
`NeConfirmDialog` / `useConfirm()`) are currently pre-1.0, so a consumer can
weigh the migration honestly against a hard "removed in the next narduk-core
major" commitment (narduk-libs#282 review). Behaviour, the once-per-process
warning guard, and the dev-only production silencing are unchanged.

Also consolidates the package README's two separate deprecation sections
("Deprecated components" near the top, "Deprecations" near the bottom) into one
"Deprecated components" section at the end of the document, so both
`AppEmptyState` and `AppConfirmModal` migration guidance is discoverable in one
place instead of split around unrelated Media security policy, Database alias
contract, and List routes sections.
