-- Index the user_id foreign-key columns of api_keys and sessions.
--
-- api_keys.user_id is the only predicate of GET /api/auth/api-keys
-- (narduk-auth server/api/auth/api-keys.get.ts), which today scans the whole
-- table for every listing. EXPLAIN QUERY PLAN goes from "SCAN api_keys" to
-- "SEARCH api_keys USING INDEX api_keys_user_id_idx (user_id=?)".
--
-- sessions.user_id is not a query predicate (session lookups use sessions.id,
-- see narduk-core runtime/server/utils/auth.ts getSessionUser). It is the
-- child column of users ON DELETE CASCADE, so every user delete scans sessions
-- to find the rows to cascade. SQLite recommends indexing foreign-key child
-- columns for exactly this reason (sqlite.org/foreignkeys.html, section 3).
--
-- CREATE INDEX holds D1 writes for as long as it runs. Both tables are small
-- in every current app, so the build is brief. IF NOT EXISTS keeps the file
-- idempotent for databases that already created either index by hand.

CREATE INDEX IF NOT EXISTS `api_keys_user_id_idx` ON `api_keys` (`user_id`);
CREATE INDEX IF NOT EXISTS `sessions_user_id_idx` ON `sessions` (`user_id`);
