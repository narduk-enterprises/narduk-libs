CREATE TABLE IF NOT EXISTS auth_native_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_hash TEXT UNIQUE,
  code_expires_at INTEGER NOT NULL,
  access_hash TEXT UNIQUE,
  access_expires_at INTEGER,
  refresh_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_native_sessions_user ON auth_native_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_verified_emails (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
