---
'@narduk-enterprises/narduk-devices': minor
---

`revokeDevice` and `rotateCredential` are all-or-nothing (narduk-libs#231). Each
now writes its rows, the audit row included, in one D1 batch / better-sqlite3
transaction. Written one statement at a time, a failure part-way left a revoked
device whose credentials still resolved through `getCredentialBySecret` (a
permanent bearer, since completion-issued credentials never expire), or a
rotation that had revoked the old secret, issued the new one and left the
generation unbumped. The device write, the new credential and the audit row are
gated on the device still being `claimed`: a revocation that loses a race writes
nothing, and a rotation racing a revocation issues nothing and throws `revoked`.
Audit `details_json` is byte-for-byte what it was.

Both now require the batch-capable database the claim path already requires, and
refuse an adapter without one with `DevicesError('invalid')` before writing
anything.
