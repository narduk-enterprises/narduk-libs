---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

Name `NeAppShell` as a narduk-shell shared component, so the no-local-copy lint
rule and foundation item 13 recognise an app-local copy of it, and the drift
and item-13 tests match narduk-shell's registry (narduk-libs#265). The libs
explorer gains the `ne-app-shell` example its coverage check requires.
