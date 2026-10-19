-- Local email auth: setup/reset links and the login lockout table (PostgreSQL
-- mirror of ../drizzle/0002_local_email_auth.sql). Required by the default
-- local backend: every email/password login reads and writes
-- auth_local_email_attempts.

CREATE TABLE IF NOT EXISTS auth_email_links (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('setup', 'reset')),
  token_hash text NOT NULL,
  redirect_path text NOT NULL,
  expires_at bigint NOT NULL,
  consumed_at text,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT auth_email_links_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS auth_email_links_email_idx ON auth_email_links (email);
CREATE INDEX IF NOT EXISTS auth_email_links_expires_at_idx ON auth_email_links (expires_at);

CREATE TABLE IF NOT EXISTS auth_local_email_attempts (
  key_hash text PRIMARY KEY NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  window_started_at bigint NOT NULL,
  locked_until bigint,
  updated_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS auth_local_email_attempts_locked_until_idx
  ON auth_local_email_attempts (locked_until);
