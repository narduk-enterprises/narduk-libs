-- Index api_keys.key_hash, the lookup of every API-key authentication.
--
-- authenticateApiKey (runtime/server/utils/auth.ts) and authenticateD1ApiKey
-- (runtime/server/utils/authApiKeyD1.ts) find the presented key by
-- `key_hash = ?`, and nothing indexed the column, so every authentication
-- scanned api_keys. Once an API key became a boundary credential
-- (operator-portal#284), a well-formed but fabricated `Bearer nk_...` header
-- bought an anonymous caller that scan (narduk-libs#168). EXPLAIN QUERY PLAN
-- goes from "SCAN api_keys" to
-- "SEARCH api_keys USING INDEX api_keys_key_hash_idx (key_hash=?)".
--
-- UNIQUE states a fact rather than adding a rule: key_hash is the SHA-256 of a
-- 32-byte random token. CREATE INDEX holds D1 writes while it builds; api_keys
-- is small in every current app. IF NOT EXISTS keeps the file idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);
