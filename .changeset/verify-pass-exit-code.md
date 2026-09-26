---
'@narduk-enterprises/narduk-app-tools': patch
---

A passing `verify --live` assertion reports `exitCode` 0. Previously a passing build-version assertion kept exit code 3, the mismatch code, while its status was `pass`. The report's top-level exit code is unchanged.
