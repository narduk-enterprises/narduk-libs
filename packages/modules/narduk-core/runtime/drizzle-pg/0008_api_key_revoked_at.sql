-- api_keys.revoked_at: revoke by stamping the row instead of deleting it
-- (PostgreSQL mirror of ../drizzle/0008_api_key_revoked_at.sql). ISO-8601 text,
-- null while the key is live.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at text;
