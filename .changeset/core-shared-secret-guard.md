---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

New `@narduk-enterprises/narduk-core/server/utils/shared-secret`: `requireSharedSecret(event, { secretKey, fallback?, header?, unsetStatus?, rejectStatus?, rejectMessage? })` checks any static inbound secret in constant time, `hasSharedSecret` is its non-throwing twin for "session OR token" guards, and `timingSafeEqualText` is exported (narduk-libs#979). `requireCronAuth` is now a wrapper over it and behaves as before.
