---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Assert D1 foreign-key cascade on passkey and session tables, and run the
registration/authentication ceremony functions against a real D1 so the
duplicate-credential 409, challenge-consume race, and conditional counter
update are executable coverage (narduk-libs#165). `create-narduk-app` is a
companion patch so the generator pin moves with auth.
