# @narduk-enterprises/narduk-devices

Generic device identity for Narduk Nuxt apps on Cloudflare D1: Ed25519 device
identity, the claim ceremony (one-time token → pending session → owner/admin
approval → shown-once credentials), class-separated `ingest` / `command`
credentials, signed device sessions with challenge/nonce replay protection,
lockouts, revocation generations, and an audit trail.

The package is deliberately generic (narduk-libs#171, second of the mybo-at-v2
packages after narduk-tenancy). It knows nothing about vessels, boats, or edge
appliances: a resource is a `resource_kind` plus an opaque `resource_id`, and
the first consumer maps `resource_kind: 'vessel'`. It knows nothing about
identity either: users are opaque `user_id` text owned by the consuming app
(narduk-core / narduk-auth `users.id`), orgs are opaque `org_id` text owned by
narduk-tenancy, there is no foreign key across either boundary, and this package
imports nothing from narduk-auth or narduk-tenancy. Who may mint a claim token
or approve a claim is a tenancy question the consumer answers with
`requireOrgRole` before calling in.

## Non-goals

- No authentication, user session, or org table. The consumer resolves callers.
- No HTTP routes. The consumer maps its wire contract (below) onto the service.
- No Postgres schema. D1/SQLite only — a Postgres-backed consumer gets a clear
  absence rather than a type-checked non-functional path (narduk-libs#94).
- No pages, components, or runtime config. The Nuxt module wires server code.

## Install

```bash
pnpm add @narduk-enterprises/narduk-devices
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-devices/nuxt'],
})
```

The module registers `server/` for Nitro auto-imports and inlines the package
for the Nitro build. Pass `{ server: false }` to import everything explicitly
instead.

## Migrations

The package ships its own additive D1 migration. Register the directory in the
app's `migrations.sources.json`:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "@narduk-enterprises/narduk-core",
      "dir": "node_modules/@narduk-enterprises/narduk-core/runtime/drizzle"
    },
    {
      "id": "@narduk-enterprises/narduk-devices",
      "dir": "node_modules/@narduk-enterprises/narduk-devices/drizzle"
    },
    { "id": "app", "dir": "drizzle" }
  ]
}
```

Both migration files are `CREATE ... IF NOT EXISTS` throughout, with no
`ALTER TABLE` and no down-migration, so a Worker rolled back to a version
without devices simply ignores the tables and re-running is safe.
`0002_claim_completion.sql` adds the UNIQUE `devices_credentials.secret_hash`
index and the `devices_scoped_nonces` table.

## Schema

Ten tables, all prefixed `devices_`. Timestamps are millisecond epoch integers.
No secret is stored in the clear: claim tokens, approval tokens and credential
secrets are SHA-256 digests.

| Table                    | Holds                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `devices_devices`        | a claimed device: org, resource, installation, fingerprint, Ed25519 key     |
| `devices_claim_tokens`   | digest-only, single-use, ≤15-minute claim tokens (QR / short-code material) |
| `devices_claim_sessions` | one row per claim start, plus the owner/admin approval binding              |
| `devices_credentials`    | versioned `ingest` / `command` credentials (`secret_hash`, `fingerprint`)   |
| `devices_sessions`       | opened device sessions: bearer digest, revocation generation, last seen     |
| `devices_challenges`     | cloud-issued session-open challenges                                        |
| `devices_replay_entries` | replay cache keyed by (device, credential version, challenge, nonce, hash)  |
| `devices_auth_attempts`  | every auth attempt per subject (`token`, `device`, `account`, `ip`)         |
| `devices_audit_events`   | one row per mutation                                                        |

Two uniqueness constraints carry security weight rather than tidiness:
`devices_claim_sessions(claim_token_id)` is UNIQUE, so one claim token redeems
into exactly one claim session; `devices_sessions(token_hash)` is UNIQUE, and it
is a digest — the session bearer itself is never stored.

The drizzle schema is exported from
`@narduk-enterprises/narduk-devices/server/database/devices-schema`, and
`tests/schema-migration-parity.test.ts` keeps every CHECK enum in step with the
TypeScript vocabularies in `shared/types/devices`.

## Service

```ts
import { createDevices } from '@narduk-enterprises/narduk-devices/server/utils/devices'

const devices = createDevices(db) // db: the app's D1-shaped drizzle database
```

`createDevices(db, options)` accepts
`{ now, idGenerator, tokenGenerator, secretGenerator, verifySignature }` so
tests own time, ids, tokens, secrets and the verifier, plus `approvalTtlSeconds`
(300), `challengeTtlSeconds` (300), `sessionTtlSeconds` (1800) and
`timestampSkewSeconds` (300).

### Claim ceremony

```ts
// 1. An owner/admin (checked by the consumer with narduk-tenancy) mints a token
//    for one resource. The raw token is returned once; it goes into the QR code.
const { token, tokenId, expiresAt } = await devices.createClaimToken({
  orgId,
  resource: { kind: 'vessel', id: vesselId },
  createdByUserId: userId,
})

// 2. The unclaimed device presents the token, its hardware fingerprint and its
//    Ed25519 public key (raw, base64url).
const started = await devices.startClaim({
  claimToken,
  hardwareFingerprint,
  hardwareFingerprintAlgorithm: 'sha256-v1',
  devicePublicKey,
  softwareVersion,
  idempotencyKey,
  remote: { ip },
})
// → { claimSessionId, status: 'pending_user_approval', expiresAt }

// 3. The owner/admin, from a fresh authenticated session, approves the exact
//    device they are looking at. The approval token binds actor, org,
//    resource, claim session, hardware fingerprint and expiry.
const approval = await devices.issueApprovalToken({
  claimSessionId,
  orgId,
  resource,
  hardwareFingerprint,
  approvedByUserId: userId,
})

// 3b. Redemption already consumed the token: `startClaim` marks `consumed_at`
//     and `consumed_by_claim_session_id` in the same transaction that creates
//     the claim session, so a token cannot be redeemed twice even by two
//     concurrent starts.

// 4. Completion issues both credential classes exactly once.
const completed = await devices.completeClaim({
  claimSessionId,
  orgId,
  resource,
  installationId,
  hardwareFingerprint,
  userApprovalToken: approval.token,
  approvedByUserId: userId,
  idempotencyKey,
})
// → { status: 'completed', deviceId, credentials: [{ credentialClass: 'ingest', credentialId,
//      fingerprint, secret, version: 1 }, { credentialClass: 'command', … }] }
```

`startClaim` statuses are exactly
`pending_user_approval | claimed | expired | revoked | rate_limited | hardware_mismatch | invalid_token`;
`completeClaim` statuses are exactly
`completed | already_completed | expired | revoked | hardware_mismatch | approval_required | unauthorized_user | rate_limited`.
Outcomes are returned, never thrown; a `DevicesError` means the call itself
could not be honoured
(`not_found | forbidden | conflict | invalid | expired | revoked | unauthorized | rate_limited`).

- A claim token binds to the first hardware fingerprint that presents it; a
  different fingerprint gets `hardware_mismatch`, as does a public key already
  bound to a live device on other hardware (docs/09 G2 "device key reuse").
- `startClaim` is idempotent on `idempotencyKey`: the same key with the same
  material returns the original session state; with different material it throws
  `conflict`.
- `startClaim` is atomic: the claim session is inserted _from_ the claim-token
  row, gated in that statement on the token still being unconsumed, unrevoked
  and unexpired, and the same transaction stamps the consumption. Two concurrent
  starts on one token produce one session (the loser is told the state of the
  session that won, or `hardware_mismatch` if it presented other hardware), and
  a token whose consumption names a different session is `revoked` at
  completion.
- `completeClaim` is atomic (device, session, both credentials, audit row in one
  D1 batch / better-sqlite3 transaction). Two concurrent completions produce one
  device; the loser and every later replay get `already_completed` with
  `deviceId` and an empty `credentials` array — secrets are returned only on
  first completion.
- `approval_required` covers a missing, wrong or expired approval token;
  `unauthorized_user` covers a valid approval presented by a different actor or
  for a different org/resource than it was issued for.
- `revokeClaimToken` revokes the token and any pending session on it.

### Lockouts

`DEVICES_LOCKOUT_POLICY` (`shared/utils/lockout-policy`) is value-for-value the
consumer contract's `CLAIM_LOCKOUT_POLICY`, and `tests/lockout-policy.test.ts`
pins the numbers:

- 5 failed claim or session-auth attempts per claim token or device within 15
  minutes → 15-minute cooldown (`rate_limited` with `retryAfterSeconds`; the
  sixth attempt is refused);
- 20 failures per account or IP within one hour → cooldown that doubles per
  further twenty (15 min, 30 min, 1 h, … capped at a day) plus a
  `security.lockout` audit event.

A lockout starts at the failure that crosses a threshold and a `rate_limited`
refusal is not itself a failure. Subjects: `startClaim` counts the **presented**
token's digest plus `remote.accountKey` / `remote.ip`; `completeClaim` counts
the token, `approvedByUserId` as the account, and `remote.ip`; `openSession`
counts the device plus `remote.*`. The attempt row is written and the window
counted in one transaction, so no concurrent failure goes uncounted.

**Every HTTP route must pass `remote`.** `remote` is optional only so a non-HTTP
caller (a queue consumer, a test) can omit it. Without it the presented token's
own window still applies — guessing one token is bounded — but nothing bounds
enumeration _across_ different tokens, which is precisely what the per-IP rule
exists for. A malformed device public key is counted as a failure too, so a
malformed key is not a free attempt.

### Device-side completion

`completeClaim` takes the **raw** approval token, which suits a ceremony where
the approving browser also completes. It does not suit one where the _device_
collects its own credentials: the app would have to keep an approval bearer in
the clear between the two legs. `completeClaimWithRecordedApproval` completes on
the `approval_*` columns `issueApprovalToken` already wrote, so no raw approval
token ever leaves the library:

```ts
// The device presents a signed request; the consumer verifies the signature,
// bounds the timestamp, consumes the nonce, and only then completes.
const completed = await devices.completeClaimWithRecordedApproval({
  claimSessionId,
  devicePublicKey, // must equal the key the claim session recorded
  hardwareFingerprint,
  installationId, // minted by the cloud
  idempotencyKey,
  remote: { ip },
})
// → { status: 'completed', deviceId, credentials: [ingest, command] }
```

**Authenticating the device is the consumer's job.** This call binds the caller
to the claim session's recorded public key and hardware fingerprint; it does not
verify a signature. Verify the signed request first (`verifyEd25519` over
`canonicalBytes`), then call. A mismatch is `hardware_mismatch` and counts
against the lockout.

`approval_required` covers "not approved yet" and "the approval expired";
`unauthorized_user` covers an approval recorded for a different org or resource
than the claim token names.

#### A lost completion response

`completion_idempotency_key` is read, not merely written. A replay carrying the
**same** `idempotencyKey`, from a caller that still satisfies the binding
checks, inside the claim session's remaining lifetime, is served — otherwise a
device whose response was lost could never obtain its credentials, and a client
that treats any non-`completed` status as terminal is bricked by a dropped
packet.

The replay is served with a **fresh equivalent** set at the next version, not
with the original secrets. Only their digests were ever stored, and retaining a
reversible copy would mean a live bearer sitting in D1 in the clear for the rest
of the claim session. Re-issuing rotates every active credential and revokes any
session opened with a superseded secret, in one transaction, so a device that
did receive the first response and replays anyway is handed a working
replacement rather than a broken one. Past the claim session's lifetime the
answer returns to `already_completed` with an empty array.

`completeClaim` keeps 0.1.0's behaviour by default; pass
`reissueOnIdempotentReplay: true` to opt that path in as well.

### Replay primitives for a pre-device exchange

A signed exchange that happens _before_ any device or credential row exists —
the claim handoff leg, for instance — cannot use `devices_replay_entries`, whose
key is (device, credential version, challenge, nonce, request hash). Two
primitives cover it:

```ts
import { assertTimestampSkew } from '@narduk-enterprises/narduk-devices/server/utils/devices'

// Same rule openSession applies internally; default window is +/-5 minutes.
assertTimestampSkew(body.signedAt, Date.now()) // throws DevicesError('unauthorized')

// Single-use nonce, scoped by the consumer. `true` is a first presentation.
const fresh = await devices.consumeNonce({
  scope: `claim-handoff:${claimSessionId}`,
  nonce: body.nonce,
  expiresAt: claimSession.expiresAt + 24 * 60 * 60 * 1000,
})
if (!fresh) return refuse()
```

`isWithinTimestampSkew` is the same check as a boolean. `consumeNonce` is backed
by `devices_scoped_nonces` and its UNIQUE `(scope, nonce)` index; a spent nonce
keeps being refused until `pruneExpired` removes it, which is the safe
direction. Namespace the scope so two exchanges cannot collide.

This table exists rather than nullable columns on `devices_replay_entries`
because SQLite treats every NULL inside a UNIQUE index as distinct: a nullable
five-column key would never conflict, and every replay would be silently
accepted.

### Bearer resolution

| The client presents                | Resolve with                                       |
| ---------------------------------- | -------------------------------------------------- |
| a session token from `openSession` | `getSessionByToken(sessionToken)`                  |
| a raw credential secret, no id     | `getCredentialBySecret(secret)`                    |
| a credential id and its secret     | `verifyCredentialSecret({ credentialId, secret })` |

All three resolve by SHA-256 digest against a UNIQUE index and confirm in
constant time; none accepts a revoked or expired row, and none puts the
presented bearer into a message, an error or an audit row.

### Pruning

`devices_replay_entries` and `devices_auth_attempts` grow with traffic, so
`openSession` and `startClaim` each run a bounded opportunistic prune first: one
`DELETE` of replay entries already past their expiry, one of auth attempts older
than the widest lockout window (an hour), both index-backed predicates rather
than a `LIMIT` (D1's SQLite is built without
`SQLITE_ENABLE_UPDATE_DELETE_LIMIT`). Nothing a live lockout check reads is ever
removed. The opportunistic call swallows its own errors — housekeeping must not
fail an authentication — so a consumer that wants the counts, or a cron sweep,
calls `pruneExpired({ before })` and gets
`{ authAttempts, replayEntries, scopedNonces }` back.

### Sessions

```ts
// The cloud issues a challenge; the device signs a canonical request with its
// Ed25519 key and names the credential (and version) it is asserting.
const { challengeId, nonce, expiresAt } = await devices.issueChallenge({
  deviceId,
})

const opened = await devices.openSession({
  // The envelope; the signed copies below are what the service trusts.
  credentialClass: 'command',
  credentialId,
  deviceId,
  signature, // base64url Ed25519 over canonicalBytes(canonicalRequest)
  canonicalRequest: {
    method: 'POST',
    route: '/api/edge/v1/session/open',
    resource: { kind: 'vessel', id: vesselId },
    installationId,
    deviceId,
    credentialClass: 'command',
    credentialId,
    credentialVersion: 1,
    challengeId,
    nonce, // the challenge nonce, or a client nonce paired with the challenge id
    timestamp: Date.now(),
    requestHash: 'sha256:…',
  },
  remote: { ip },
})
// → { sessionId, sessionToken, expiresAt, revocationGeneration }
```

Canonical JSON is object keys sorted code-point ascending at every depth, no
insignificant whitespace, UTF-8 (`canonicalJson` / `canonicalBytes` in
`server/utils/devices-signing`, which also exports base64url helpers and the
WebCrypto `verifyEd25519`). `openSession` checks, in order: lockouts, device
status, credential activity and class, request binding (device, credential
**id**, **class**, version, installation, resource), ±5 minute timestamp skew,
challenge validity, the signature, then the replay cache — the UNIQUE index over
(device, credential version, challenge, nonce, request hash) is the replay
check, kept until the challenge expires. Every refusal counts as a failure
against the device, including a signature or stored key that base64url cannot
decode (`unauthorized`, never an uncaught decode error).

#### The signed field list, for a non-TypeScript edge

The signature covers exactly these keys, in this order — canonical JSON sorts
code-point ascending, and `resource` nests as `{"id":…,"kind":…}`:

```text
challengeId, credentialClass, credentialId, credentialVersion, deviceId,
installationId, method, nonce, requestHash, resource{id,kind}, route, timestamp
```

`credentialId` and `credentialClass` are inside the signature and each is
compared against the credential row the database resolved, so a captured signed
`ingest` body cannot be resubmitted as a `command` request by rewriting the
unsigned envelope. The Go edge (`mybo-at-v2/apps/edge/internal/identity`) must
match the bytes, not just the fields:

- `encoding/json` HTML-escapes `<`, `>` and `&` by default — use an `Encoder`
  with `SetEscapeHTML(false)` (and strip the trailing newline it adds);
- `timestamp` and `credentialVersion` are integers, and Go's `float64`
  marshalling of a whole number differs from a JS integer — keep them typed as
  integers;
- Go sorts map keys bytewise over UTF-8 while JS sorts UTF-16 code units. The
  key list above is pure ASCII, so the two agree; keep it that way if a field is
  ever added.

**Class separation.** An `ingest` credential never opens a `command` session
(`forbidden` when the envelope's class does not match the credential,
`unauthorized` when the _signed_ class or id does not), and a `command` session
never passes an `ingest` guard.

**The session bearer is a secret.** `openSession` returns `sessionToken` exactly
once; only `sha256(sessionToken)` is stored, in `devices_sessions.token_hash`.
`sessionId` is a non-bearer row id — it is what the audit trail names, and it
does not authenticate anything.

- `getSessionByToken(sessionToken)` resolves a bearer by digest and is what the
  guard uses; `getSession(sessionId)` is the operator-side lookup by row id.
  Both return the active (unexpired, unrevoked) session or null.
- `heartbeat` and `revokeSession` take either `{ sessionToken }` (the device
  path, resolved by digest) or `{ sessionId }` (the operator path). `heartbeat`
  updates `lastSeenAt` and reports `stale: true` when the device's revocation
  generation has moved past the session's (no audit row, no expiry extension).
- `revokeSession`, `revokeDevice` (bumps the generation, revokes every
  credential and session) and `rotateCredential({ deviceId, credentialClass })`
  (new version, bumps the generation, ends that class's sessions, returns the
  new secret once) are idempotent where a repeat is harmless.
- `verifyCredentialSecret({ credentialId, secret })` is the bearer check for
  routes that take the `ingest` secret directly.

### Database typing

The service accepts the D1-shaped drizzle database (`LayerDatabase` in
narduk-core). Atomic claim redemption (`startClaim`) and completion
(`completeClaim`) use Drizzle's D1 `batch()`; direct better-sqlite3 consumers
use their driver's synchronous transaction. Pass the real database object,
including its batch/client capability, rather than a wrapper exposing only
query-builder methods; unsupported adapters fail with `invalid` before touching
the claim. The lockout counter prefers the same transaction and degrades to two
sequential statements on an adapter without one, so authentication never fails
for want of a batch. Tests run the shipped migration against real in-memory
SQLite and against Miniflare's D1.

## Guard

```ts
import { requireDeviceSession } from '@narduk-enterprises/narduk-devices/server/utils/guards'

export default defineEventHandler(async (event) => {
  const session = await requireDeviceSession(event, {
    devices,
    credentialClass: 'ingest',
  })
  // session.deviceId, session.credentialId, session.revocationGeneration …
})
```

Reads `Authorization: Bearer <sessionToken>` — the value `openSession` returned
once, not the session row id (override with `resolveSessionToken`) — resolves it
by digest, throws 401 `{ errorCode: 'unauthorized' }` when there is no active
session and 403 `{ errorCode: 'entitlement_denied' }` when the session's class
is not the one the route requires. `readBearerSessionToken(event)` is the header
read on its own. Never log the bearer.

## Wire mapping to the mybo-at-v2 contracts

| `@mybo/contracts`                                          | This package                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ClaimStartRequest`                                        | `startClaim(input)`; add `remote` from the request                                                             |
| `ClaimStartResponse.claimSessionId`                        | `claimSessionId` — `null` when no session exists (`invalid_token`, `expired`, `revoked`, `rate_limited`)       |
| `ClaimStartStatus` / `ClaimCompleteStatus`                 | `CLAIM_START_STATUSES` / `CLAIM_COMPLETE_STATUSES`, member for member                                          |
| `ClaimCompleteRequest.vesselId`                            | `resource: { kind: 'vessel', id: vesselId }`; `approvedByUserId` is the authenticated user                     |
| `ClaimCompleteResponse.edgeDeviceId`                       | `deviceId`                                                                                                     |
| `IssuedCredential`                                         | `credentials[]` (`credentialClass`, `credentialId`, `fingerprint`, `secret`, `expiresAt?`; `version` is extra) |
| `CLAIM_LOCKOUT_POLICY`                                     | `DEVICES_LOCKOUT_POLICY`                                                                                       |
| `CredentialClass`                                          | `CREDENTIAL_CLASSES`                                                                                           |
| `SessionRevokeMessage.revocationGeneration`                | `Device.revocationGeneration`, snapshotted into each session                                                   |
| `edgeCredential` security scheme (`Authorization: Bearer`) | `requireDeviceSession(event, { devices, credentialClass })`; the bearer is `openSession`'s `sessionToken`      |

The `userApprovalToken` the contract carries is minted by `issueApprovalToken`
from the owner/admin's fresh session, after the consumer has checked the role
with narduk-tenancy. A ceremony where the **device** collects its own
credentials never puts that token on the wire at all — see
[Device-side completion](#device-side-completion) — and an edge that presents
only a raw credential secret as its bearer resolves through
`getCredentialBySecret` rather than `requireDeviceSession`.

## Audit

Every mutation writes one `devices_audit_events` row:
`claim_token.create|revoke`, `claim.start|approve|complete|reissue`,
`challenge.issue`, `session.open|revoke`, `device.revoke`, `credential.rotate`,
and `security.lockout` when an account or IP crosses the escalating threshold.
`heartbeat` is liveness, not a mutation worth a row. Raw tokens and secrets are
never recorded — a `session.*` row names the session's non-bearer `id`, never
the `sessionToken`. `listAuditEvents` returns newest first with a clamped limit
(default 50, max 200), an optional `orgId`, an optional `subject: { kind, id }`,
and a `before` cursor.
