---
'@narduk-enterprises/create-narduk-app': patch
---

Emit an explicit public npm registry default alongside the estate scope so Dependabot avoids probing the mirror for public packages. Limit npm version updates to one open grouped PR while preserving the safe and majors groups.
