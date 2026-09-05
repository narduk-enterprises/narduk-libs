-- Passkey (WebAuthn) support for the local backend (narduk-libs#125, W7 A1).
--
-- D1/SQLite dialect only. This package publishes no Postgres schema or
-- migrations for the auth bridge tables (narduk-libs#94); a Postgres-backed
-- consumer gets a clear absence rather than a type-checked non-functional path.
--
-- Both tables are additive `CREATE TABLE IF NOT EXISTS`, so a Worker rolled
-- back to a version without passkey support simply ignores them. There is
-- deliberately no down-migration.

CREATE TABLE IF NOT EXISTS auth_webauthn_credentials (
  -- Base64URL credential ID. Globally unique because discoverable-credential
  -- authentication looks a credential up by this value alone, before any user
  -- is known.
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Base64URL COSE public key as returned by the registration ceremony.
  public_key TEXT NOT NULL,
  -- Authenticator signature counter. 0 means "this authenticator does not
  -- report a counter", which is normal for platform passkeys.
  counter INTEGER NOT NULL DEFAULT 0,
  -- JSON array of AuthenticatorTransport values, used to build allowCredentials.
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT 'singleDevice'
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0,
  -- The Relying Party ID this credential was registered against. Authentication
  -- re-checks it, so a credential minted under one RP ID cannot be replayed
  -- after the deployment's RP ID changes.
  rp_id TEXT NOT NULL,
  -- Operator-supplied label, e.g. "MacBook Touch ID".
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS auth_webauthn_credentials_user_id_idx
  ON auth_webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS auth_webauthn_credentials_rp_id_idx
  ON auth_webauthn_credentials(rp_id);

-- Server-issued ceremony challenges. Digest-only, single-use, TTL-bounded —
-- the same shape auth_email_links uses for setup/reset tokens. A challenge is
-- consumed by the verify endpoint before verification runs, so a failed
-- verification burns it and cannot be retried as an oracle.
CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  -- The user the registration ceremony was issued to. NULL for authentication,
  -- which is discoverable-credential only and therefore identifies no user up
  -- front.
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS auth_webauthn_challenges_expires_at_idx
  ON auth_webauthn_challenges(expires_at);
