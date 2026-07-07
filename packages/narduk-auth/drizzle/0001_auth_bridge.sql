CREATE TABLE IF NOT EXISTS auth_user_links (
  local_user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL UNIQUE,
  primary_email TEXT NOT NULL UNIQUE,
  last_provider TEXT,
  providers_json TEXT NOT NULL DEFAULT '[]',
  email_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  local_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL,
  session_identifier TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  aal TEXT,
  current_provider TEXT,
  providers_json TEXT NOT NULL DEFAULT '[]',
  recovery_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS auth_sessions_local_user_id_idx ON auth_sessions(local_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_auth_user_id_idx ON auth_sessions(auth_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);
