---
'@narduk-enterprises/narduk-devices': minor
---

Close the four claim-completion gaps the first device-side consumer hit.

- `getCredentialBySecret(secret)` resolves an active credential from a bare
  bearer secret by digest, backed by a new UNIQUE
  `devices_credentials.secret_hash` index. An edge that presents only the
  secret, with no credential id, had no lookup at all.
- `completeClaimWithRecordedApproval(input)` completes a claim from the device
  side using the `approval_*` columns already on the claim session, so a
  consumer no longer has to persist a raw approval bearer between the approve
  and collect legs.
- A completion replayed with the same `idempotencyKey`, inside the claim
  session's lifetime and from a caller that still satisfies the binding checks,
  is served with a fresh equivalent credential set instead of
  `already_completed` and an empty array. `completeClaim` keeps its 0.1.0
  behaviour unless `reissueOnIdempotentReplay: true` is passed.
- `assertTimestampSkew` / `isWithinTimestampSkew` are exported (and applied by
  `openSession` itself), and `consumeNonce({ scope, nonce, expiresAt })` gives a
  generic single-use nonce over the new `devices_scoped_nonces` table, for a
  signed exchange that happens before any device session exists.

`drizzle/0002_claim_completion.sql` is additive and re-runnable; `pruneExpired`
now also reports `scopedNonces`. `DEVICES_LOCKOUT_POLICY` is unchanged.
