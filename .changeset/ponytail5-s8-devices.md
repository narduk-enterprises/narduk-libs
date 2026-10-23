---
'@narduk-enterprises/narduk-devices': patch
---

Device claim and credential races now fail closed. A completion proof is spent in the same batch that creates the device, a reissue checks the revocation generation, a rotation is gated on the credential version, an idempotency key reused with different claim material is a conflict, an approval token is only issued while the device is pending, and `prune` also deletes expired challenges.
