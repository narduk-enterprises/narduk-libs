---
'@narduk-enterprises/narduk-devices': patch
---

Add `toWireCredential(issued)` beside `IssuedCredential` so a consumer can map
claim/rotation output onto the wire field set (`credentialClass`,
`credentialId`, `fingerprint`, `secret`, optional `expiresAt`) in one place.
`version` stays on the library type. `completeClaim` and `rotateCredential`
return types are unchanged (narduk-libs#226).
