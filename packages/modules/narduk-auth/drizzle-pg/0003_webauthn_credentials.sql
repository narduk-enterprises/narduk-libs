-- Passkey (WebAuthn) support for the local backend (PostgreSQL mirror of
-- ../drizzle/0003_webauthn_credentials.sql). Required only by apps that enable
-- the `passkey` provider; additive, with no down-migration.

CREATE TABLE IF NOT EXISTS auth_webauthn_credentials (
  -- Base64URL credential ID. Globally unique because discoverable-credential
  -- authentication looks a credential up by this value alone.
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  -- Base64URL COSE public key as returned by the registration ceremony.
  public_key text NOT NULL,
  -- Authenticator signature counter: an unsigned 32-bit value, hence bigint.
  -- 0 means "this authenticator does not report a counter".
  counter bigint NOT NULL DEFAULT 0,
  -- JSON array of AuthenticatorTransport values, used to build allowCredentials.
  transports text NOT NULL DEFAULT '[]',
  device_type text NOT NULL DEFAULT 'singleDevice'
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL DEFAULT false,
  -- The Relying Party ID this credential was registered against.
  rp_id text NOT NULL,
  -- Operator-supplied label, e.g. "MacBook Touch ID".
  name text,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  last_used_at text,
  CONSTRAINT auth_webauthn_credentials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_webauthn_credentials_user_id_idx
  ON auth_webauthn_credentials (user_id);
CREATE INDEX IF NOT EXISTS auth_webauthn_credentials_rp_id_idx
  ON auth_webauthn_credentials (rp_id);

-- Server-issued ceremony challenges: digest-only, single-use, TTL-bounded.
CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
  challenge_hash text PRIMARY KEY NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  -- NULL for authentication, which is discoverable-credential only.
  user_id text,
  expires_at bigint NOT NULL,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT auth_webauthn_challenges_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_webauthn_challenges_expires_at_idx
  ON auth_webauthn_challenges (expires_at);
