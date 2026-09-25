---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Passkey routes now answer 503 "Passkeys unavailable: server misconfiguration"
and log the cause when `@simplewebauthn/server` fails to load, instead of an
opaque 500 (narduk-libs#892). The library, including its `helpers` entry, is now
imported lazily on the first ceremony rather than at module load, so a load
failure such as #786's missing Reflect polyfill rejects where it can be
answered. The error and its `cause` chain are logged under `AppAuth`; the cause
never reaches the response. `readPresentedChallenge` decodes base64url with the
platform `atob`, so the pure ceremony checks no longer import the library at
all. Successful ceremonies behave as before.
