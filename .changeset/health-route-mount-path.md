---
'@narduk-enterprises/narduk-app-tools': patch
---

Item 9.6 flags only a file Nitro mounts at `/api/health` (`server/api/health.*` or `server/api/health/index.*`). A versioned route such as `server/api/v1/health.get.ts` mounts `/api/v1/health` and is no longer reported as a hand-rolled `/api/health`.
