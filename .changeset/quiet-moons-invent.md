---
'@narduk-enterprises/narduk-devices': minor
---

Close the four claim-completion gaps the first device-side consumer hit.

- `getCredentialBySecret(secret, options)` resolves an active credential from a
  bare bearer secret by digest, backed by a new UNIQUE
  `devices_credentials.secret_hash` index. An edge that presents only the
  secret, with no credential id, had no lookup at all. Completion-issued secrets
  never expire, so this is a long-lived bearer: the second argument is
  **required** and is a discriminated union — `{ remote }`, whose
  `AttributableRemoteContext` will not compile without an `accountKey` or an
  `ip`, or `{ unattributed: true }` for a queue consumer or a test that means
  to count nothing. A secret matching **no row** counts against the lockout and
  a locked subject is refused; a secret matching a **revoked or expired** row is
  refused but counts nothing, because that is a known-good credential gone
  stale rather than a guess, and sharing one counter meant one stale secret
  could take a whole vessel's shared IP off the air.
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
  retryable `rate_limited`, never a terminal status; `retryAfterSeconds` there
  is jittered across `REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN`..`_MAX`
  (2–5 s, also exposed as `reissueRetryAfterSeconds()`) so a fleet that lost the
  same race does not resynchronise into the next one. Only a **served**
  re-issue burns the proof's nonce — the burn happens inside the winning
  transaction — so a contended or refused caller may resend the identical
  signed bytes. Past the binding check no replay outcome advances a lockout
  counter: a device retrying a lost response cannot lock itself out.
- `assertTimestampSkew` / `isWithinTimestampSkew` are exported and are now the
  single implementation `openSession` and the `deviceProof` check both call, and
  `consumeNonce({ scope, nonce, expiresAt })` gives a generic single-use nonce
  over the new `devices_scoped_nonces` table, for a signed exchange that happens
  before any device session exists.

`consumeNonce` now reserves the `narduk-devices:` scope prefix
(`DEVICES_INTERNAL_NONCE_PREFIX`) for the package's own completion-proof and
re-issue-lock rows, and refuses an `expiresAt` more than
`SCOPED_NONCE_MAX_TTL_SECONDS` (7 days) ahead, since `pruneExpired` can never
reclaim a row past its expiry. Both throw `DevicesError('invalid')`.

`drizzle/0002_claim_completion.sql` is additive and re-runnable; `pruneExpired`
now also reports `scopedNonces`. `DEVICES_LOCKOUT_POLICY` is unchanged.

Four changes can break a consumer, which is why this is a minor rather than a
patch: `DevicesAuditAction` gains `'claim.reissue'` (an exhaustive `switch` or
`Record<DevicesAuditAction, …>` no longer compiles until the new member is
handled); `PruneExpiredResult` gains a required `scopedNonces` (an exhaustive
`toEqual` on a prune result must add it); `getCredentialBySecret`'s second
argument is required, so a bare `getCredentialBySecret(secret)` no longer
compiles; and `already_completed` on a *replay* no longer carries `deviceId`
(only the first-completion race loser does), because that branch is reachable
without proving anything.
