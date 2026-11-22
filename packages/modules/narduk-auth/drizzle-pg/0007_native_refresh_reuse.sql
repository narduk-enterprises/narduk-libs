-- Rotated-away native refresh tokens (PostgreSQL mirror of
-- ../drizzle/0007_native_refresh_reuse.sql). Epoch columns are unix seconds.

CREATE TABLE IF NOT EXISTS auth_native_refreshes (
  refresh_hash text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  rotated_at bigint NOT NULL,
  CONSTRAINT auth_native_refreshes_session_id_auth_native_sessions_id_fk FOREIGN KEY (session_id) REFERENCES auth_native_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_native_refreshes_session ON auth_native_refreshes (session_id);
