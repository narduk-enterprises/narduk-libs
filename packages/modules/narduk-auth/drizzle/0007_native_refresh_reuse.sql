-- Every native refresh token a session has rotated away, kept so that a reused
-- one is recognized and ends its session (narduk-libs#2179). Purely additive.
CREATE TABLE IF NOT EXISTS auth_native_refreshes (
  refresh_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES auth_native_sessions(id) ON DELETE CASCADE,
  rotated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_native_refreshes_session ON auth_native_refreshes(session_id);
