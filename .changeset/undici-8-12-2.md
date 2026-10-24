---
'@narduk-enterprises/narduk-core': patch
---

Raise the `undici` dependency to `^8.12.2`, the first release without the
unhandled-error denial of service on excessive content-encodings
(GHSA-xjj6-f33q-929c).
