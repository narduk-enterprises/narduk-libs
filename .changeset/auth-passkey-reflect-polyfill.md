---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Load a Reflect metadata polyfill on the Workers path so narduk-auth passkey
routes no longer 500 when tsyringe evaluates without `Reflect.getMetadata`
(narduk-libs#786). `create-narduk-app` is a companion patch so the generator
pin moves with auth.
