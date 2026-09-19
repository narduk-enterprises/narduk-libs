# @narduk-enterprises/narduk-devices

## 0.5.0

### Minor Changes

- b0fbfb0: `completeClaimWithRecordedApproval` accepts a consumer-shaped device
  proof, so a device whose completion response was lost can be re-issued its
  credentials (narduk-libs#237). `deviceProof` may now be a
  `ContextBoundCompletionProof`, `{ context, canonicalRequest, signature }`, in
  mybo.at's `mybo/claim-handoff/v1` layout: an Ed25519 signature over
  `context + "\n" + canonicalRequest`, where `canonicalRequest` is the canonical
  JSON of `claimSessionId`, `devicePublicKey`, `hardwareFingerprint`,
  `idempotencyKey`, `nonce` and `signedAt`. It carries no `installationId`,
  which the cloud mints and the device cannot sign.

  The library fails closed. The accepted context is configured with the new
  `createDevices({ completionProofContext })` option; without it a context-bound
  proof throws `invalid`. A proof under any other context, a `canonicalRequest`
  that is not exactly the canonical form of the six keys, a field that does not
  match the claim session and the call, a `signedAt` outside the skew window, a
  bad signature, or a nonce already spent is refused like any other failed
  proof. The binding compares are constant-time. A served re-issue now also
  returns the device's recorded `installationId`, for a consumer that mints a
  fresh one per attempt.

  The library's own `DeviceCompletionProof` is unchanged.

### Patch Changes

- 44d26f7: Add `toWireCredential(issued)` beside `IssuedCredential` so a
  consumer can map claim/rotation output onto the wire field set
  (`credentialClass`, `credentialId`, `fingerprint`, `secret`, optional
  `expiresAt`) in one place. `version` stays on the library type.
  `completeClaim` and `rotateCredential` return types are unchanged
  (narduk-libs#226).

## 0.4.0

### Minor Changes

- 0e99614: `revokeDevice` and `rotateCredential` are all-or-nothing
  (narduk-libs#231). Each now writes its rows, the audit row included, in one D1
  batch / better-sqlite3 transaction. Written one statement at a time, a failure
  part-way left a revoked device whose credentials still resolved through
  `getCredentialBySecret` (a permanent bearer, since completion-issued
  credentials never expire), or a rotation that had revoked the old secret,
  issued the new one and left the generation unbumped. The device write, the new
  credential and the audit row are gated on the device still being `claimed`: a
  revocation that loses a race writes nothing, and a rotation racing a
  revocation issues nothing and throws `revoked`. Audit `details_json` is
  byte-for-byte what it was.

  Both now require the batch-capable database the claim path already requires,
  and refuse an adapter without one with `DevicesError('invalid')` before
  writing anything.

- 0e99614: `createLockoutGate(...).record` returns every threshold an attempt
  crossed, not only escalating ones (narduk-libs#238). A limiter built on the
  flat token/device rule was never told which attempt locked its subject out, so
  it could not audit the lockout without re-deriving the rule.
  `LockoutThreshold` gains `escalates: boolean`; filter on it to keep the
  previous set. The library's own `security.lockout` audit rows are unchanged:
  still written for escalating crossings only.

### Patch Changes

- 0e99614: `issueApprovalToken` checks the caller's org and resource before it
  reports anything about the claim session (narduk-libs#243). A caller naming
  another org or resource now gets `forbidden` whatever state the session is in;
  before, any authenticated caller holding a claim session id heard whether
  another tenant's session was claimed (`conflict`), revoked or expired. The
  owning org's answers are unchanged, and an id that does not exist is still
  `not_found`.
- 92835a1: Lint through `narduk-lint` with a checked-in `lint-budget.json`
  recording the package's current warning counts (narduk-mapkit also marks
  fire-and-forget limiter calls in its tests with `void`). No runtime change;
  the release gate requires a changeset for any changed package file.

## 0.3.1

### Patch Changes

- bb37590: Test-only: the D1-driver suite now runs on narduk-testkit's D1 query
  harness instead of its own Miniflare setup and migration splitter. No
  published file changes; the release gate requires a changeset for any change
  under the package.

## 0.3.0

### Minor Changes

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

## 0.2.0

### Minor Changes

- 2880976: Close the four claim-completion gaps the first device-side consumer
  hit.

  - `getCredentialBySecret(secret, options)` resolves an active credential from
    a bare bearer secret by digest, backed by a new UNIQUE
    `devices_credentials.secret_hash` index. An edge that presents only the
    secret, with no credential id, had no lookup at all. Completion-issued
    secrets never expire, so this is a long-lived bearer: the second argument is
    **required** and is a discriminated union — `{ remote }`, whose
    `AttributableRemoteContext` will not compile without an `accountKey` or an
    `ip`, or `{ unattributed: true }` for a queue consumer or a test that means
    to count nothing. A secret matching **no row** counts against the lockout
    and a locked subject is refused; a secret matching a **revoked or expired**
    row is refused but counts nothing, because that is a known-good credential
    gone stale rather than a guess, and sharing one counter meant one stale
    secret could take a whole vessel's shared IP off the air.
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
    `completeClaimWithRecordedApproval` the option throws without `deviceProof`;
    a refused replay records a failed attempt and counts against the lockout;
    and `MAX_REISSUES_PER_CLAIM_SESSION` bounds churn on top of those controls
    without being what makes the path safe. Two racing replays yield one winner
    and one retryable `rate_limited`, never a terminal status;
    `retryAfterSeconds` there is jittered across
    `REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN`..`_MAX` (2–5 s, also exposed as
    `reissueRetryAfterSeconds()`) so a fleet that lost the same race does not
    resynchronise into the next one. Only a **served** re-issue burns the
    proof's nonce — the burn happens inside the winning transaction — so a
    contended or refused caller may resend the identical signed bytes. Past the
    binding check no replay outcome advances a lockout counter: a device
    retrying a lost response cannot lock itself out.
  - `assertTimestampSkew` / `isWithinTimestampSkew` are exported and are now the
    single implementation `openSession` and the `deviceProof` check both call,
    and `consumeNonce({ scope, nonce, expiresAt })` gives a generic single-use
    nonce over the new `devices_scoped_nonces` table, for a signed exchange that
    happens before any device session exists.

  Lockout subjects for an account key or an IP are **namespaced by operation**:
  the stored `devices_auth_attempts.subject` is `<purpose>:<accountKey|ip>` —
  `claim:`, `credential:` or `session:` — and a `security.lockout` audit row
  carries that same value in `subjectId`. An account key or an IP identifies a
  caller, not a capability, so an unnamespaced counter let one operation gate
  another: a completion naming a `claimSessionId` that does not exist is
  unauthenticated and, alone among completion refusals, carries no per-token
  subject to cap it, so twenty of them from one address locked the shared per-IP
  counter `getCredentialBySecret` reads on a vessel's per-request ingest path.
  `lockoutSubjectFor` (`server/utils/devices-lockout`) is exported for a
  consumer that reads those subjects back out of the audit trail. Token and
  device subjects are unchanged and deliberately not namespaced.

  An unknown `claimSessionId` is counted against that `claim:` counter, which
  makes both completion methods bimodal for an id that does not exist: they
  throw `DevicesError('not_found')` as before, but answer
  `{ status: 'rate_limited', credentials: [], retryAfterSeconds }` once the
  caller's subjects are locked. Both outcomes are now documented on the service
  type and in the README, named for what they are — rate-limiting on
  enumeration, not a uniform refusal — so a route accepting a caller-supplied id
  can handle each.

  `getCredentialBySecret` now throws `DevicesError('invalid')` when
  `options.remote` resolves to no lockout subject at all. `{ ip: '' }` satisfies
  `AttributableRemoteContext` — `''` is a `string` — so
  `remote: { ip: getRequestIP(event) ?? '' }` compiled into exactly the blind
  lookup the required-argument type was added to forbid. A caller that asks to
  attribute and supplies nothing to attribute to is a bug;
  `{ unattributed: true }` remains the way to say "count nothing" on purpose.

  `consumeNonce` now reserves the `narduk-devices:` scope prefix
  (`DEVICES_INTERNAL_NONCE_PREFIX`) for the package's own completion-proof and
  re-issue-lock rows, and refuses an `expiresAt` more than
  `SCOPED_NONCE_MAX_TTL_SECONDS` (7 days) ahead, since `pruneExpired` can never
  reclaim a row past its expiry. Both throw `DevicesError('invalid')`.

  `drizzle/0002_claim_completion.sql` is additive and re-runnable;
  `pruneExpired` now also reports `scopedNonces`. `DEVICES_LOCKOUT_POLICY` is
  unchanged.

  Four changes can break a consumer, which is why this is a minor rather than a
  patch: `DevicesAuditAction` gains `'claim.reissue'` (an exhaustive `switch` or
  `Record<DevicesAuditAction, …>` no longer compiles until the new member is
  handled); `PruneExpiredResult` gains a required `scopedNonces` (an exhaustive
  `toEqual` on a prune result must add it); `getCredentialBySecret`'s second
  argument is required, so a bare `getCredentialBySecret(secret)` no longer
  compiles; and `already_completed` no longer carries `deviceId` on a _replay_
  at all, nor on a first-completion race loser that proved nothing — the raw
  approval token on `completeClaim`, or `deviceProof` on
  `completeClaimWithRecordedApproval`, is what earns it, because `deviceId`
  names the scope of the library's own re-issue lock.

## 0.1.0

### Minor Changes

- 4865f90: Add `@narduk-enterprises/narduk-devices`, the generic device identity
  package (narduk-libs#171, mybo-at-v2 Wave A lane A1): Ed25519 device identity,
  the claim ceremony (digest-only one-time claim tokens, pending claim sessions,
  owner/admin approval tokens bound to actor, org, resource, session,
  fingerprint and expiry, atomic redemption and completion issuing shown-once
  `ingest` and `command` credentials), signed device sessions over canonical
  JSON with cloud-issued challenges, ±5 minute skew and a replay cache,
  credential rotation and device revocation with a revocation generation, the
  contract's 5/15-minute and 20/hour escalating lockout policy with a security
  audit event, and an audit row per mutation. The signed canonical request binds
  the credential itself (`credentialId` and `credentialClass` alongside
  `credentialVersion`), each compared against the resolved credential row; a
  session's bearer is a shown-once random token stored only as a SHA-256 digest,
  distinct from the non-bearer session id the audit trail names; a claim token
  is consumed in the same transaction that creates its claim session; malformed
  base64url is an authentication failure rather than a decode error; and
  `openSession` / `startClaim` prune expired replay entries and stale auth
  attempts. Ships a D1/SQLite drizzle schema plus one additive hand-written
  migration, a dialect-neutral service factory over the consumer's own drizzle
  database with injectable clock, ids, tokens, secrets and verifier, and a
  `requireDeviceSession` H3 guard. Resources are generic (`resource_kind` +
  opaque `resource_id`), users and orgs are opaque text ids, and nothing imports
  narduk-auth or narduk-tenancy.
