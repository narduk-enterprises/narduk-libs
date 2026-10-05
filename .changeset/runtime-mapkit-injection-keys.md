---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Expose the existing colour-mode and CSP nonce injection keys through the runtime-safe `./injection-keys` subpath, so apps can provide them without importing the Nuxt module.
