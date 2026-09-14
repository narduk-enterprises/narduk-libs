CREATE TABLE IF NOT EXISTS auth_email_links (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  redirect_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS auth_email_links_email_idx ON auth_email_links(email);
CREATE INDEX IF NOT EXISTS auth_email_links_expires_at_idx ON auth_email_links(expires_at);

CREATE TABLE IF NOT EXISTS auth_local_email_attempts (
  key_hash TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS auth_local_email_attempts_locked_until_idx
  ON auth_local_email_attempts(locked_until);
