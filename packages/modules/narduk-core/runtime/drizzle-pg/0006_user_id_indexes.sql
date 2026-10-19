-- Index the user_id foreign-key columns of api_keys and sessions (PostgreSQL
-- mirror of ../drizzle/0006_user_id_indexes.sql). api_keys.user_id is the only
-- predicate of the API-key listing; sessions.user_id is the child column of the
-- users ON DELETE CASCADE.
--
-- Plain CREATE INDEX takes a write lock for the build; both tables are small.
-- Build large ones with CREATE INDEX CONCURRENTLY in a file whose first line is
-- `-- narduk:no-transaction`.

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
