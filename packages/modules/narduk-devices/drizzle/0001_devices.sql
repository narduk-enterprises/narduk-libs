-- Generic device identity: devices, claim tokens, claim sessions, class-separated
-- credentials, signed sessions, session-open challenges, a replay cache, auth
-- attempts for lockouts, and an audit trail (narduk-libs#171, mybo-at-v2 A1).
--
-- D1/SQLite dialect only. This package publishes no Postgres schema; a
-- Postgres-backed consumer gets a clear absence rather than a type-checked
-- non-functional path (same stance as narduk-tenancy and narduk-libs#94).
--
-- Every statement is additive `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
-- NOT EXISTS`, so a Worker rolled back to a version without devices simply
-- ignores these tables and re-running the migration is safe. There is
-- deliberately no down-migration.
--
-- `org_id` and `*_user_id` columns are opaque text with no REFERENCES clause:
-- orgs and users belong to narduk-tenancy and the consuming app.
--
-- Timestamps are millisecond epoch INTEGERs so the service's injectable clock
-- is the only time source. No secret is stored in the clear: claim tokens,
-- approval tokens and credential secrets are SHA-256 digests.

CREATE TABLE IF NOT EXISTS devices_devices (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  hardware_fingerprint TEXT NOT NULL,
  fingerprint_algorithm TEXT NOT NULL,
  public_key TEXT NOT NULL,
  software_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'revoked')),
  revocation_generation INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_devices_org_resource_idx
  ON devices_devices(org_id, resource_kind, resource_id);
CREATE INDEX IF NOT EXISTS devices_devices_fingerprint_idx
  ON devices_devices(hardware_fingerprint);

-- Digest-only claim tokens: `token_hash` is the SHA-256 of a >=128-bit random
-- token the service returns exactly once, at creation.
CREATE TABLE IF NOT EXISTS devices_claim_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_claim_tokens_token_hash_idx
  ON devices_claim_tokens(token_hash);

-- One row per claim start. The approval_* columns bind the owner/admin
-- approval token (digest only) to actor, org, resource, session, fingerprint
-- and expiry.
CREATE TABLE IF NOT EXISTS devices_claim_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  claim_token_id TEXT NOT NULL REFERENCES devices_claim_tokens(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  hardware_fingerprint TEXT NOT NULL,
  fingerprint_algorithm TEXT NOT NULL,
  public_key TEXT NOT NULL,
  software_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_user_approval', 'claimed', 'expired', 'revoked')),
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  completion_idempotency_key TEXT,
  device_id TEXT REFERENCES devices_devices(id),
  approval_token_hash TEXT,
  approval_user_id TEXT,
  approval_org_id TEXT,
  approval_resource_kind TEXT,
  approval_resource_id TEXT,
  approval_expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_claim_sessions_idempotency_idx
  ON devices_claim_sessions(idempotency_key);
CREATE INDEX IF NOT EXISTS devices_claim_sessions_token_idx
  ON devices_claim_sessions(claim_token_id);

-- Class-separated credentials. `secret_hash` is the SHA-256 of a shown-once
-- secret; `fingerprint` is a domain-separated digest safe to display.
CREATE TABLE IF NOT EXISTS devices_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices_devices(id) ON DELETE CASCADE,
  credential_class TEXT NOT NULL CHECK (credential_class IN ('ingest', 'command')),
  secret_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS devices_credentials_device_class_idx
  ON devices_credentials(device_id, credential_class);

CREATE TABLE IF NOT EXISTS devices_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices_devices(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES devices_credentials(id) ON DELETE CASCADE,
  credential_class TEXT NOT NULL CHECK (credential_class IN ('ingest', 'command')),
  challenge_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revocation_generation INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_sessions_device_idx ON devices_sessions(device_id);

-- Cloud-issued session-open challenges. A client nonce is accepted only when
-- paired with one of these ids.
CREATE TABLE IF NOT EXISTS devices_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices_devices(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_challenges_device_idx ON devices_challenges(device_id);

-- Replay cache: the UNIQUE index over the five-part key is the replay check.
CREATE TABLE IF NOT EXISTS devices_replay_entries (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  challenge_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_replay_entries_key_idx
  ON devices_replay_entries(device_id, credential_version, challenge_id, nonce, request_hash);
CREATE INDEX IF NOT EXISTS devices_replay_entries_expires_at_idx
  ON devices_replay_entries(expires_at);

-- Every authentication attempt, the input to the lockout policy.
CREATE TABLE IF NOT EXISTS devices_auth_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('token', 'device', 'account', 'ip')),
  subject TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_auth_attempts_subject_at_idx
  ON devices_auth_attempts(subject_kind, subject, at);

-- One row per mutation. `org_id` is nullable and carries no REFERENCES clause:
-- an IP lockout or a start against an unknown token belongs to no org, and
-- the trail must outlive anything it describes.
CREATE TABLE IF NOT EXISTS devices_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_audit_events_org_created_at_idx
  ON devices_audit_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS devices_audit_events_subject_idx
  ON devices_audit_events(subject_kind, subject_id);
