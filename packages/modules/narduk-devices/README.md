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

`drizzle/0001_devices.sql` is `CREATE TABLE IF NOT EXISTS` throughout with no
down-migration, so a Worker rolled back to a version without devices simply
ignores the tables.

## Schema

Nine tables, all prefixed `devices_`. Timestamps are millisecond epoch integers.
No secret is stored in the clear: claim tokens, approval tokens and credential
secrets are SHA-256 digests.

| Table                    | Holds                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `devices_devices`        | a claimed device: org, resource, installation, fingerprint, Ed25519 key     |
| `devices_claim_tokens`   | digest-only, single-use, ≤15-minute claim tokens (QR / short-code material) |
| `devices_claim_sessions` | one row per claim start, plus the owner/admin approval binding              |
| `devices_credentials`    | versioned `ingest` / `command` credentials (`secret_hash`, `fingerprint`)   |
| `devices_sessions`       | opened device sessions with the revocation generation they were opened at   |
| `devices_challenges`     | cloud-issued session-open challenges                                        |
| `devices_replay_entries` | replay cache keyed by (device, credential version, challenge, nonce, hash)  |
| `devices_auth_attempts`  | every auth attempt per subject (`token`, `device`, `account`, `ip`)         |
| `devices_audit_events`   | one row per mutation                                                        |

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
- `completeClaim` is atomic (device, session, token consumption, both
  credentials, audit row in one D1 batch / better-sqlite3 transaction). Two
  concurrent completions produce one device; the loser and every later replay
  get `already_completed` with `deviceId` and an empty `credentials` array —
  secrets are returned only on first completion.
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
refusal is not itself a failure. Subjects: `startClaim` counts the presented
token's digest plus `remote.accountKey` / `remote.ip`; `completeClaim` counts
the token, `approvedByUserId` as the account, and `remote.ip`; `openSession`
counts the device plus `remote.*`. Pass `remote` from the route so the account
and IP rules have something to count.

### Sessions

```ts
// The cloud issues a challenge; the device signs a canonical request with its
// Ed25519 key and names the credential (and version) it is asserting.
const { challengeId, nonce, expiresAt } = await devices.issueChallenge({
  deviceId,
})

const opened = await devices.openSession({
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
    credentialVersion: 1,
    challengeId,
    nonce, // the challenge nonce, or a client nonce paired with the challenge id
    timestamp: Date.now(),
    requestHash: 'sha256:…',
  },
  remote: { ip },
})
// → { sessionId, expiresAt, revocationGeneration }
```

Canonical JSON is object keys sorted code-point ascending at every depth, no
insignificant whitespace, UTF-8 (`canonicalJson` / `canonicalBytes` in
`server/utils/devices-signing`, which also exports base64url helpers and the
WebCrypto `verifyEd25519`). `openSession` checks, in order: lockouts, device
status, credential activity and class, request binding (device, credential
version, installation, resource), ±5 minute timestamp skew, challenge validity,
the signature, then the replay cache — the UNIQUE index over (device, credential
version, challenge, nonce, request hash) is the replay check, kept until the
challenge expires. Every refusal counts as a failure against the device.

**Class separation.** An `ingest` credential never opens a `command` session
(`forbidden`), and a `command` session never passes an `ingest` guard.

- `getSession(id)` returns the active session or null;
  `heartbeat({ sessionId })` updates `lastSeenAt` and reports `stale: true` when
  the device's revocation generation has moved past the session's (no audit row,
  no expiry extension).
- `revokeSession`, `revokeDevice` (bumps the generation, revokes every
  credential and session) and `rotateCredential({ deviceId, credentialClass })`
  (new version, bumps the generation, ends that class's sessions, returns the
  new secret once) are idempotent where a repeat is harmless.
- `verifyCredentialSecret({ credentialId, secret })` is the bearer check for
  routes that take the `ingest` secret directly.

### Database typing

The service accepts the D1-shaped drizzle database (`LayerDatabase` in
narduk-core). Atomic claim completion uses Drizzle's D1 `batch()`; direct
better-sqlite3 consumers use their driver's synchronous transaction. Pass the
real database object, including its batch/client capability, rather than a
wrapper exposing only query-builder methods; unsupported adapters fail with
`invalid` before touching the claim. Tests run the shipped migration against
real in-memory SQLite and against Miniflare's D1.

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

Reads `Authorization: Bearer <sessionId>` (override with `resolveSessionId`),
throws 401 `{ errorCode: 'unauthorized' }` when there is no active session and
403 `{ errorCode: 'entitlement_denied' }` when the session's class is not the
one the route requires.

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
| `edgeCredential` security scheme (`Authorization: Bearer`) | `requireDeviceSession(event, { devices, credentialClass })`                                                    |

The `userApprovalToken` the contract carries is minted by `issueApprovalToken`
from the owner/admin's fresh session, after the consumer has checked the role
with narduk-tenancy.

## Audit

Every mutation writes one `devices_audit_events` row:
`claim_token.create|revoke`, `claim.start|approve|complete`, `challenge.issue`,
`session.open|revoke`, `device.revoke`, `credential.rotate`, and
`security.lockout` when an account or IP crosses the escalating threshold.
`heartbeat` is liveness, not a mutation worth a row. Raw tokens and secrets are
never recorded. `listAuditEvents` returns newest first with a clamped limit
(default 50, max 200), an optional `orgId`, an optional `subject: { kind, id }`,
and a `before` cursor.
