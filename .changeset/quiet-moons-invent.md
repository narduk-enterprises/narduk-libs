---
'@narduk-enterprises/narduk-devices': minor
---

Close the four claim-completion gaps the first device-side consumer hit.

- `getCredentialBySecret(secret, { remote })` resolves an active credential from
  a bare bearer secret by digest, backed by a new UNIQUE
  `devices_credentials.secret_hash` index. An edge that presents only the
  secret, with no credential id, had no lookup at all. Completion-issued secrets
  never expire, so this is a long-lived bearer: pass `remote` and a failed
  resolution counts against the lockout and is refused when locked.
- `completeClaimWithRecordedApproval(input)` completes a claim from the device
  side using the `approval_*` columns already on the claim session, so a
  consumer no longer has to persist a raw approval bearer between the approve
  and collect legs. Pass `deviceProof` and the library verifies the device's
  Ed25519 signature against the key the claim session recorded, binds it to
  every field of the request, and burns its nonce.
- A completion replayed with the same `idempotencyKey`, inside the claim
  session's lifetime, from a caller that satisfies the binding checks **and
  proves it holds the claim session key**, is served with a fresh equivalent
  credential set instead of `already_completed` and an empty array. This is
  **opt-in on both paths** (`reissueOnIdempotentReplay`, default `false`):
  serving a replay rotates the device's live credentials and revokes its
  sessions, so an unauthenticated caller who could trigger one would take the
  device over, not merely deny it service. On
  `completeClaimWithRecordedApproval` the option throws without `deviceProof`; a
  refused replay records a failed attempt and counts against the lockout; and
  `MAX_REISSUES_PER_CLAIM_SESSION` bounds churn on top of those controls without
  being what makes the path safe. Two racing replays yield one winner and one
  retryable `rate_limited`, never a terminal status.
- `assertTimestampSkew` / `isWithinTimestampSkew` are exported and are now the
  single implementation `openSession` and the `deviceProof` check both call, and
  `consumeNonce({ scope, nonce, expiresAt })` gives a generic single-use nonce
  over the new `devices_scoped_nonces` table, for a signed exchange that happens
  before any device session exists.

`drizzle/0002_claim_completion.sql` is additive and re-runnable; `pruneExpired`
now also reports `scopedNonces`. `DEVICES_LOCKOUT_POLICY` is unchanged.

Two additive type changes can break a consumer that enumerates them
exhaustively, which is why this is a minor rather than a patch:
`DevicesAuditAction` gains `'claim.reissue'` (an exhaustive `switch` or
`Record<DevicesAuditAction, …>` no longer compiles until the new member is
handled), and `PruneExpiredResult` gains a required `scopedNonces` (an
exhaustive `toEqual` on a prune result must add it).
