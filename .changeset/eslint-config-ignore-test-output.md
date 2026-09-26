---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

The shared `narduk/ignores` baseline now also ignores generated test output at the lint root (`coverage/`, `playwright-report/`, `test-results/`), so `narduk-lint` no longer lints `vitest --coverage` output and a second `quality` run no longer fails on unbudgeted warnings (#902).
