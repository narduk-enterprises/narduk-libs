---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk/no-shadowed-shared-component` lists `NeSearchInput` with the other narduk-shell names so the export-list drift test matches the registry (#815). The narduk-app-tools copy of the list is updated to match so item 13 `no-local-copy` does not split.
