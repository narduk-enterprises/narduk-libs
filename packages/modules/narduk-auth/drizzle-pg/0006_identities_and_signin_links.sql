-- Google sign-in identities and passwordless sign-in links (PostgreSQL mirror
-- of ../drizzle/0006_identities_and_signin_links.sql; narduk-libs#1951, #1952).
-- Re-running it is a no-op.

CREATE TABLE IF NOT EXISTS auth_identities (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google')),
  subject text NOT NULL,
  user_id text NOT NULL,
  email text,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  last_sign_in_at text,
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, subject),
  CONSTRAINT auth_identities_user_id_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT auth_identities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- auth_email_links.purpose gains 'signin'. 0002 declared the CHECK inline, so
-- PostgreSQL named it auth_email_links_purpose_check.
ALTER TABLE auth_email_links DROP CONSTRAINT IF EXISTS auth_email_links_purpose_check;
ALTER TABLE auth_email_links
  ADD CONSTRAINT auth_email_links_purpose_check CHECK (purpose IN ('setup', 'reset', 'signin'));
