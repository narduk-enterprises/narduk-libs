---
'@narduk-enterprises/narduk-app': patch
'@narduk-enterprises/create-narduk-app': patch
---

readRawJsonBody now refuses non-JSON content types and bodies over 1 MiB; upgrade keeps the old CI pin when the caller grant cannot be widened; Dependabot npm open-pull-requests-limit is 2 again.
