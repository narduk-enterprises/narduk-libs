-- Native-app auth (PKCE) sessions and verified-email proofs (PostgreSQL mirror
-- of ../drizzle/0004_native_auth.sql). Epoch columns are unix seconds.

CREATE TABLE IF NOT EXISTS auth_native_sessions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_hash text,
  code_expires_at bigint NOT NULL,
  access_hash text,
  access_expires_at bigint,
  refresh_hash text,
  expires_at bigint NOT NULL,
  revoked_at bigint,
  created_at bigint NOT NULL,
  CONSTRAINT auth_native_sessions_code_hash_unique UNIQUE (code_hash),
  CONSTRAINT auth_native_sessions_access_hash_unique UNIQUE (access_hash),
  CONSTRAINT auth_native_sessions_refresh_hash_unique UNIQUE (refresh_hash),
  CONSTRAINT auth_native_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_native_sessions_user ON auth_native_sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_verified_emails (
  user_id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  verified_at text NOT NULL,
  CONSTRAINT auth_verified_emails_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
