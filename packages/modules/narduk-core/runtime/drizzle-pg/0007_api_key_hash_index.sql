-- Unique index on api_keys.key_hash, the lookup of every API-key authentication
-- (PostgreSQL mirror of ../drizzle/0007_api_key_hash_index.sql). UNIQUE states a
-- fact rather than adding a rule: key_hash is the SHA-256 of a random 32-byte token.

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);
