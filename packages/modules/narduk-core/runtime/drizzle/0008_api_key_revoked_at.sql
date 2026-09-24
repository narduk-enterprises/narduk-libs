-- Revoke an API key by stamping api_keys.revoked_at instead of deleting the row.
--
-- authenticateApiKey (runtime/server/utils/auth.ts) and authenticateD1ApiKey
-- (runtime/server/utils/authApiKeyD1.ts) could only withdraw a key when the row
-- was deleted, and the delete also destroyed last_used_at, key_prefix and
-- scopes_json: the audit trail that matters most when a leak is suspected
-- (narduk-libs#806). Both now refuse a key whose revoked_at is set, and
-- revokeApiKey (auth.ts) sets it and keeps the row.
--
-- revoked_at is ISO-8601 text, like last_used_at and created_at, the other
-- event times on the table. It is nullable with no default, so every existing
-- key stays live. SQLite's ADD COLUMN has no IF NOT EXISTS; the migration
-- ledger applies the file once.

ALTER TABLE `api_keys` ADD COLUMN `revoked_at` text;
