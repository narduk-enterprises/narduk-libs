---
'@narduk-enterprises/narduk-mapkit': patch
---

Docs only (#664). The README and SECURITY.md now say plainly that
`MAPKIT_ALLOWED_ORIGINS`, `MAPKIT_TOKEN` and `APPLE_MAPKIT_TOKEN` do nothing
since 2.1 and should not be set. The token route answers same-origin requests
only, whatever an allowlist holds. SECURITY.md previously told operators to set
`MAPKIT_ALLOWED_ORIGINS` on production endpoints, which had no effect.
