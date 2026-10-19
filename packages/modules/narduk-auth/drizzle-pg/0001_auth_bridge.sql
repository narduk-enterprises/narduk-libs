-- Auth bridge tables (PostgreSQL mirror of ../drizzle/0001_auth_bridge.sql and
-- ../server/database/auth-bridge-pg-schema.ts).
--
-- Requires narduk-core's drizzle-pg/ files first: these tables reference
-- users(id). Run the files in name order with an immutable-file runner such as
-- @narduk-enterprises/narduk-postgres/migrate, giving this set its own ledger
-- table (`table: 'schema_migrations_auth'`) so it stays independent of core's.
--
-- Every statement is idempotent. Timestamps are ISO-8601 UTC text, the same
-- shape D1 stores; the defaults below produce it for raw-SQL inserts.
-- Epoch columns are unix seconds in bigint (no January 2038 overflow).

CREATE TABLE IF NOT EXISTS auth_user_links (
  local_user_id text PRIMARY KEY NOT NULL,
  auth_user_id text NOT NULL,
  primary_email text NOT NULL,
  last_provider text,
  providers_json text NOT NULL DEFAULT '[]',
  email_confirmed_at text,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT auth_user_links_auth_user_id_unique UNIQUE (auth_user_id),
  CONSTRAINT auth_user_links_primary_email_unique UNIQUE (primary_email),
  CONSTRAINT auth_user_links_local_user_id_users_id_fk FOREIGN KEY (local_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY NOT NULL,
  local_user_id text NOT NULL,
  auth_user_id text NOT NULL,
  session_identifier text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at bigint NOT NULL,
  aal text,
  current_provider text,
  providers_json text NOT NULL DEFAULT '[]',
  recovery_mode boolean NOT NULL DEFAULT false,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT auth_sessions_local_user_id_users_id_fk FOREIGN KEY (local_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_sessions_local_user_id_idx ON auth_sessions (local_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_auth_user_id_idx ON auth_sessions (auth_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);
