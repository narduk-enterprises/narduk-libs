# @narduk-enterprises/narduk-devices

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
