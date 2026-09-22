---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor` now refuses a rate-limit `namespace_id` that is not a
positive decimal integer, such as `"abc"`, `"0x1F"`, `"0120"`, `-5` or `1.5`
(#509). Scaffold ids and ids declared twice were already refused, including
across `env.*` overlays.
