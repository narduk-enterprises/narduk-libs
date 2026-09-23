---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk/no-csrf-exempt-route-misuse` and `narduk/require-csrf-header-on-mutations`
take an `exemptPaths` option: the app's `nardukCore.csrf.exemptPaths`. A route it
covers is CSRF-exempt to both rules, so it must verify a credential header rather
than the browser CSRF header (#510).
