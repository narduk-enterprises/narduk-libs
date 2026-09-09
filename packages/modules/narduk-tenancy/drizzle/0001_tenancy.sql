-- Generic tenancy: orgs, memberships, per-resource role overrides, invites,
-- time-boxed support grants, and an audit trail (narduk-libs#171, D-7).
--
-- D1/SQLite dialect only. This package publishes no Postgres schema; a
-- Postgres-backed consumer gets a clear absence rather than a type-checked
-- non-functional path (same stance as narduk-libs#94).
--
-- Every statement is additive `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
-- NOT EXISTS`, so a Worker rolled back to a version without tenancy simply
-- ignores these tables and re-running the migration is safe. There is
-- deliberately no down-migration.
--
-- `user_id` columns are opaque text with no REFERENCES clause: the users table
-- belongs to the consuming app, not to this package.
--
-- Timestamps are millisecond epoch INTEGERs so the service's injectable clock
-- is the only time source.

CREATE TABLE IF NOT EXISTS tenancy_orgs (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenancy_orgs_slug_idx ON tenancy_orgs(slug);

CREATE TABLE IF NOT EXISTS tenancy_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES tenancy_orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'crew', 'viewer')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenancy_memberships_org_user_idx
  ON tenancy_memberships(org_id, user_id);
CREATE INDEX IF NOT EXISTS tenancy_memberships_user_idx ON tenancy_memberships(user_id);

-- A per-resource role for one member. The service refuses an override more
-- privileged than the member's org role, so this table can only narrow access.
CREATE TABLE IF NOT EXISTS tenancy_resource_role_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES tenancy_orgs(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'crew', 'viewer')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenancy_resource_role_overrides_scope_idx
  ON tenancy_resource_role_overrides(org_id, resource_kind, resource_id, user_id);
CREATE INDEX IF NOT EXISTS tenancy_resource_role_overrides_user_idx
  ON tenancy_resource_role_overrides(org_id, user_id);

-- Digest-only invites: `token_hash` is the SHA-256 of a >=128-bit random token
-- the service returns exactly once, at creation.
CREATE TABLE IF NOT EXISTS tenancy_invites (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES tenancy_orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'crew', 'viewer')),
  resource_kind TEXT,
  resource_id TEXT,
  token_hash TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by_user_id TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenancy_invites_token_hash_idx
  ON tenancy_invites(token_hash);
CREATE INDEX IF NOT EXISTS tenancy_invites_org_email_idx ON tenancy_invites(org_id, email);

-- Time-boxed read-only diagnostic access (ADR-0010). Support is a grant, never
-- a role: the service caps the TTL at 86400 seconds and requires a reason.
CREATE TABLE IF NOT EXISTS tenancy_support_grants (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES tenancy_orgs(id) ON DELETE CASCADE,
  resource_kind TEXT,
  resource_id TEXT,
  grantee_user_id TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tenancy_support_grants_org_grantee_idx
  ON tenancy_support_grants(org_id, grantee_user_id);
CREATE INDEX IF NOT EXISTS tenancy_support_grants_expires_at_idx
  ON tenancy_support_grants(expires_at);

-- One row per mutation. `org_id` carries no REFERENCES clause on purpose: the
-- trail must outlive the org row it describes.
CREATE TABLE IF NOT EXISTS tenancy_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tenancy_audit_events_org_created_at_idx
  ON tenancy_audit_events(org_id, created_at);
