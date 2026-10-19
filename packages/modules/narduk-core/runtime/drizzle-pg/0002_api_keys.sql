-- api_keys: bearer-token authentication (PostgreSQL mirror of
-- ../drizzle/0002_api_keys.sql). Keys are stored as SHA-256 hashes; the raw key
-- is shown once on creation. key_prefix holds the first characters for display.
-- scopes_json and revoked_at arrive in 0004 and 0008, as on D1.

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  last_used_at text,
  expires_at bigint,
  created_at text NOT NULL,
  CONSTRAINT api_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
