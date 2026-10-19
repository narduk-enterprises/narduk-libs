-- Google sign-in identities and passwordless sign-in links (narduk-libs#1951,
-- #1952). Required only by apps that enable Google sign-in or email-link
-- sign-in; without them the existing tables behave as before.

-- One row per linked provider account. `subject` is the provider's stable
-- account id (Google `sub`); importers write Supabase auth.identities here.
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_sign_in_at TEXT,
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, subject),
  CONSTRAINT auth_identities_user_id_provider_unique UNIQUE (user_id, provider)
);

-- auth_email_links.purpose gains 'signin'. SQLite cannot alter a CHECK, so the
-- table is rebuilt with every row copied; nothing references it. Links are
-- short-lived (5-60 minutes), and outstanding ones survive the copy.
CREATE TABLE auth_email_links_0006 (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'reset', 'signin')),
  token_hash TEXT NOT NULL UNIQUE,
  redirect_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO auth_email_links_0006
  (id, email, purpose, token_hash, redirect_path, expires_at, consumed_at, created_at)
  SELECT id, email, purpose, token_hash, redirect_path, expires_at, consumed_at, created_at
  FROM auth_email_links;

DROP TABLE auth_email_links;

ALTER TABLE auth_email_links_0006 RENAME TO auth_email_links;

CREATE INDEX IF NOT EXISTS auth_email_links_email_idx ON auth_email_links(email);
CREATE INDEX IF NOT EXISTS auth_email_links_expires_at_idx ON auth_email_links(expires_at);
