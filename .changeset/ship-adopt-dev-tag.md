---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship --adopt` now takes over a production version whose commit tag
is not a SHA (a retired development-mode `dev-...` tag), exactly as it does an
untagged one. Without `--adopt` it still refuses, and it still never overrides a
SHA-tagged version HEAD does not contain.
