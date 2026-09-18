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
| `devices_scoped_nonces`  | single-use `(scope, nonce)` for an exchange with no device row yet          |
| `devices_auth_attempts`  | every auth attempt per subject (`token`, `device`, `account`, `ip`)         |
| `devices_audit_events`   | one row per mutation                                                        |

Three uniqueness constraints carry security weight rather than tidiness:
`devices_claim_sessions(claim_token_id)` is UNIQUE, so one claim token redeems
into exactly one claim session; `devices_sessions(token_hash)` is UNIQUE, and it
is a digest — the session bearer itself is never stored; and
`devices_scoped_nonces(scope, nonce)` is UNIQUE, which _is_ the replay check —
an insert that lands is a first presentation, one that conflicts is a replay.

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
  device; the loser gets `already_completed` with an empty `credentials` array —
  secrets are returned only on first completion — and with `deviceId` **only if
  it presented a secret only the device could hold**: the raw approval token on
  `completeClaim`, or `deviceProof` on `completeClaimWithRecordedApproval`. A
  first completion on the recorded-approval path without `deviceProof` is
  authorized on four values that all travel on the wire, so it is authorized
  having proved nothing and learns no `deviceId` when it loses (narduk-libs#228
  third review LOW-4). A _later_ replay is a different caller again: same status
  and empty array, never a `deviceId`, because that branch is reachable without
  proving anything (narduk-libs#228).
- `approval_required` covers a missing, wrong or expired approval token;
  `unauthorized_user` covers a valid approval presented by a different actor or
  for a different org/resource than it was issued for.
- `issueApprovalToken` authorises before it describes: a caller naming another
  org or resource gets `forbidden` whatever state the claim session is in, and
  only the owning org hears `conflict`, `revoked` or `expired`. Reporting the
  state first told any authenticated caller that holds a claim session id
  whether another tenant's session was claimed, revoked or expired
  (narduk-libs#243). An id that does not exist is still `not_found`.
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

**Account and IP subjects are namespaced by operation.** The stored subject is
`<purpose>:<accountKey|ip>` — `claim:` for `startClaim` and both completion
paths, `credential:` for `getCredentialBySecret`, `session:` for `openSession`
(`lockoutSubjectFor`, `server/utils/devices-lockout`) — and a `security.lockout`
audit row carries that same namespaced value in `subjectId`. An account key or
an IP identifies a _caller_, not a capability, so without the namespace one
path's counter gates another's: a completion naming a `claimSessionId` that does
not exist carries no token, no approval and no proof, and so has no per-token
subject to cap it at five, and twenty of them from one address locked the
vessel's whole ingest path (narduk-libs#228 third review HIGH-4). Token and
device subjects are deliberately _not_ namespaced: a token digest is only ever
presented to the claim ceremony, a device id only to `openSession`, and
`startClaim` and completion are meant to share the token counter — that is what
bounds guessing across the two legs of one ceremony.

**An unknown `claimSessionId` has two possible answers.** A completion call
normally **throws** `DevicesError('not_found')` — unchanged, and still the
contract for an id that does not exist — but once the caller's subjects are
locked it **returns**
`{ status: 'rate_limited', credentials: [], retryAfterSeconds }` instead, the
same answer a real but locked session gets. Handle both on any route that
accepts a caller-supplied id. Call it what it is: rate-limiting on
_enumeration_, not a uniform refusal. Below the threshold the two answers still
differ, so the first twenty probes do distinguish a real id from an invented
one; what changed is that they are counted, audited and eventually refused
instead of free and untraced. Uniformity was considered and rejected — always
`rate_limited` breaks the `not_found` contract consumers branch on, always
`not_found` hands the oracle straight back (third review LOW-5).

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
const completed = await devices.completeClaimWithRecordedApproval({
  claimSessionId,
  devicePublicKey, // must equal the key the claim session recorded
  hardwareFingerprint,
  installationId, // minted by the cloud
  idempotencyKey,
  // The device's Ed25519 proof, verified in-library against the key the claim
  // session recorded, bound to every field above, and single-use.
  deviceProof: {
    canonicalRequest: {
      claimSessionId,
      devicePublicKey,
      hardwareFingerprint,
      idempotencyKey,
      installationId,
      nonce, // any unguessable value the device picks; burned on first use
      timestamp, // ms epoch, inside the skew window
    },
    signature, // base64url, over canonicalBytes(canonicalRequest)
  },
  remote: { ip },
})
// → { status: 'completed', deviceId, credentials: [ingest, command] }
```

**Authenticate the device.** `claimSessionId`, `devicePublicKey`,
`hardwareFingerprint` and `idempotencyKey` all travel on the wire, so the
binding checks alone prove only that the caller knows what the handoff carried.
Two ways to close that:

- **Pass `deviceProof`** and let the library do it. It binds every signed field
  to resolved state, verifies the signature against the key the claim session
  recorded — not the one the caller presents — and burns `nonce` in
  `devices_scoped_nonces`, so a captured request is spent rather than
  replayable. The proof is checked **last** on every path, so a caller refused
  by a cheaper check never spends the nonce it presented.
- **Or verify the signed request yourself first** (`verifyEd25519` over
  `canonicalBytes`, `assertTimestampSkew`, `consumeNonce`) and call without
  `deviceProof`, exactly as 0.1.0-era consumers do.

A binding mismatch is `hardware_mismatch`; a proof that does not verify is
`unauthorized_user`. Both count against the lockout.

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

**`reissueOnIdempotentReplay` is off by default on both completion paths**, and
that default is load-bearing rather than conservative. A served re-issue hands
the caller the device's only live credential set _and revokes the genuine
device's_, so whoever can satisfy the check owns the device. Four conditions
gate it:

1. **Opt in explicitly.** Default `false`. A consumer following the example
   above cannot get destructive replay without asking for it.
2. **Prove the device.** On `completeClaimWithRecordedApproval`,
   `reissueOnIdempotentReplay: true` without `deviceProof` throws
   `DevicesError('invalid')` — it is not silently downgraded. On
   `completeClaim`, the raw approval token is already that proof.
3. **A refusal is a failed authentication — a refusal, and nothing else.** A
   replay that fails the binding check records an attempt, counts against the
   lockout and returns no `deviceId`, so guessing at the four on-wire values is
   bounded and visible instead of unlimited and untraced. Once the binding check
   passes the caller is authenticated, and every outcome after that point —
   served, contended, capped, already-spent proof, nothing left to rotate — is
   an answer to a genuine device, so **none of them touches a lockout counter**.
   A device that retries a lost response cannot lock itself out.
4. **A per-claim-session cap** (`MAX_REISSUES_PER_CLAIM_SESSION`) bounds churn
   and audit noise. It is _not_ what makes the path safe: one re-issue is
   already a complete credential set, so a cap alone would only turn unlimited
   takeover into N takeovers. Conditions 1–3 are the control. **At the cap a
   device sees `already_completed` with an empty `credentials` array and no
   `deviceId`** — the same shape as a replay that never opted in, and not a
   failure: no attempt row, no lockout counter. The cap is terminal for the
   claim session, not for the device; recovery is a new claim ceremony, and
   until then the credentials from the last served re-issue remain the live set.

Two replays that race resolve to one winner and one `rate_limited` with
`retryAfterSeconds`, never to a terminal status: the loser is a device replaying
its own completion, and the winner has already rotated the credentials it was
holding, so telling it "already completed" would brick exactly the device this
path exists to rescue.

**The loser may resend the identical signed payload.** The proof's nonce is
burned _inside_ the winning batch, gated on the single-writer lock, so a
contended replay spends nothing: its nonce is still unspent when it returns, and
the same bytes replayed after `retryAfterSeconds` are served (narduk-libs#228
second review H2). A retry only needs a _fresh_ proof once one was actually
served: that is `proof_spent`, and the device signs a new request to recover.
`retryAfterSeconds` on contention is drawn uniformly from
`[REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN, REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX]`
(2–5 s, via the exported `reissueRetryAfterSeconds()`), so a fleet that all lost
the same race does not resynchronise into the next one. It is jitter, not a
measurement: the value is independent of how much work the request did, so it
leaks no timing.

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

Two scope rules are enforced rather than documented:

- **`narduk-devices:` is reserved** (`DEVICES_INTERNAL_NONCE_PREFIX`). The same
  table holds the library's own rows — the completion-proof nonce
  (`narduk-devices:claim-completion:<claimSessionId>`) and the re-issue
  single-writer lock (`narduk-devices:reissue:<deviceId>`) — so a caller scope
  starting with that prefix throws `DevicesError('invalid')` instead of
  pre-empting a row the claim ceremony depends on.
- **`expiresAt` is capped** at `SCOPED_NONCE_MAX_TTL_SECONDS` (7 days) past now.
  `pruneExpired` reclaims a nonce only once it expires, so an
  accidentally-decade-long TTL is a row that never leaves the table; the cap is
  refused up front rather than accumulated.

This table exists rather than nullable columns on `devices_replay_entries`
because SQLite treats every NULL inside a UNIQUE index as distinct: a nullable
five-column key would never conflict, and every replay would be silently
accepted.

### Bearer resolution

| The client presents                | Resolve with                                       |
| ---------------------------------- | -------------------------------------------------- |
| a session token from `openSession` | `getSessionByToken(sessionToken)`                  |
| a raw credential secret, no id     | `getCredentialBySecret(secret, options)`           |
| a credential id and its secret     | `verifyCredentialSecret({ credentialId, secret })` |

None accepts a revoked or expired row, and none puts the presented bearer into a
message, an error or an audit row.

What protects the two digest lookups is a 256-bit secret and an equality seek
against a UNIQUE index: at most one row can match, and it matched exactly.
Re-comparing a digest the index already equated cannot fail, so there is no
constant-time confirmation on those paths and none is needed — timing that
leaked digest-prefix bits would not help forge a preimage of a 256-bit secret.
`timingSafeEqualHex` is load-bearing in exactly one place,
`verifyCredentialSecret`, where the row is fetched **by id** and the digest is
then genuinely compared.

**A credential secret is a long-lived bearer.** Completion issues credentials
with `expiresAt: null` (the re-issue path preserves it), so
`getCredentialBySecret`'s expiry check never fires and a leaked secret — from a
device filesystem, a support bundle, a proxy log — stays live until someone
revokes it. Prefer trading it for a 30-minute session via `openSession` where
the edge can. Where it cannot, **pass `remote` from every route**: an
unresolvable secret is recorded against the presented account and IP and a
locked subject is refused, which is what makes a credential-stuffing sweep
across a fleet both bounded and visible in the `security.lockout` audit trail. A
successful resolution writes nothing — this is a per-request read path.

The second argument is **required**, and is a discriminated union rather than an
optional `remote`, because a missing `remote` is indistinguishable at runtime
from a route that forgot it:

```ts
// An HTTP route. `AttributableRemoteContext` requires at least one of
// `accountKey` / `ip`, so `{ remote: {} }` does not compile.
await devices.getCredentialBySecret(secret, {
  remote: { ip: event.context.ip },
})

// A queue consumer or a test, saying so on purpose: no subjects, no counting.
await devices.getCredentialBySecret(secret, { unattributed: true })
```

**Only an unknown digest counts — and only this path writes the counter this
path reads.** A secret that resolves to a row which is revoked, or past its
`expiresAt`, is refused — but it is a known-good credential gone stale, not a
guess, so it records no attempt and advances no counter. Credential stuffing
produces digests that match nothing; a fleet rotating or retiring credentials
produces digests that match a dead row. Sharing one counter between them meant a
single boat's stale camera credential could lock the boat's IP and take every
healthy device behind it off the air (narduk-libs#228 second review H1).

The second half of that sentence is the one the first fix left untrue. Subjects
here are namespaced `credential:` (see §Lockouts), so the claim ceremony — whose
unknown-session branch is unauthenticated and has no per-token subject capping
it — can no longer drive the counter this per-request lookup reads. Twenty
completions naming session ids that do not exist used to take every camera on
the vessel dark; now they lock only `claim:<ip>` (third review HIGH-4).

**`remote` must resolve to a subject.** `AttributableRemoteContext` is satisfied
by `{ ip: '' }` — `''` is a `string` — and an empty field yields no subject at
all, so `remote: { ip: getRequestIP(event) ?? '' }`, written to satisfy the
type, would compile straight into the blind lookup the type exists to forbid. A
call whose `remote` resolves to zero subjects now throws
`DevicesError('invalid')`: a caller that asked to attribute and supplied nothing
to attribute to is a bug, not an unattributed lookup. Where a route genuinely
has no IP, say so with `{ unattributed: true }` (third review MEDIUM-5).

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
`getCredentialBySecret(secret, { remote })` rather than `requireDeviceSession`.
Pass `remote`: see [Bearer resolution](#bearer-resolution) for why a bare secret
is the one bearer that needs it.

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
