-- Claim-completion gaps closed for the first device-side consumer
-- (mybo-at-v2 G2; narduk-libs 0.2.0). Two additions, both purely additive:
--
--   1. `devices_scoped_nonces`: single-use nonces for signed exchanges that
--      happen *before* any device or credential exists, such as the claim
--      handoff leg and the completion proof's own replay check.
--      `devices_replay_entries` cannot serve this: its key is (device,
--      credential version, challenge, nonce, request hash) and all five
--      columns are NOT NULL. Widening them to NULL would silently defeat the
--      check, because SQLite treats every NULL as distinct inside a UNIQUE
--      index, so `ON CONFLICT DO NOTHING` would never fire and every replay
--      would be accepted. A separate two-column key is the honest fix.
--   2. A UNIQUE index on `devices_credentials.secret_hash`, so a bare bearer
--      secret can be resolved to its credential by digest — the same shape as
--      `devices_sessions_token_hash_idx`. An edge that presents only the raw
--      secret (no credential id) previously had no lookup at all.
--
-- Order matters, and this is the order: everything that cannot fail on
-- existing data comes first, and the one statement that can — the UNIQUE index
-- — comes last. `IF NOT EXISTS` suppresses "an index of that name exists", not
-- a genuine uniqueness violation over rows already in the table, and the
-- production runner appends its `_narduk_migrations` ledger INSERT to the end
-- of this file, so a throw anywhere here fails the whole run and repeats on
-- every later deploy (narduk-libs#228 review M5). Put last, a duplicate digest
-- costs this one statement instead of the table below it.
--
-- Recovering from that failure, should it ever happen: two credential rows
-- sharing a `secret_hash` mean two devices hold the same bearer secret, which
-- is a security incident, not a data-shape problem. Find them with
--   SELECT secret_hash, COUNT(*) c FROM devices_credentials
--   GROUP BY secret_hash HAVING c > 1;
-- then rotate the affected devices (`rotateCredential`, or `revokeDevice` and
-- re-claim) so the digests differ, and re-run the migration. Do not delete
-- rows to make the index build: the revoked history is the audit trail.
--
-- Same dialect and lifecycle rules as `0001_devices.sql`: D1/SQLite only, every
-- statement `IF NOT EXISTS`, no `ALTER TABLE`, no down-migration, millisecond
-- epoch INTEGER timestamps, and no secret stored in the clear.

-- A generic (scope, nonce) single-use table. `scope` is opaque to this package:
-- a consumer names the exchange it is protecting (for example
-- `claim-handoff:<claimSessionId>`), and the UNIQUE index is the replay check —
-- an insert that lands is a first presentation, one that conflicts is a replay.
-- The package itself uses `narduk-devices:`-prefixed scopes for the completion
-- proof's nonce and for the single-writer row that serialises a re-issue.
-- Rows are TTL-bounded by `expires_at` and pruned by `pruneExpired`.
CREATE TABLE IF NOT EXISTS devices_scoped_nonces (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_scoped_nonces_key_idx
  ON devices_scoped_nonces(scope, nonce);
CREATE INDEX IF NOT EXISTS devices_scoped_nonces_expires_at_idx
  ON devices_scoped_nonces(expires_at);

-- Credential secrets are 256 random bits, so a duplicate digest is not a
-- reachable state; UNIQUE makes that an invariant the database enforces and
-- turns a lookup-by-secret into an index seek that can return at most one row.
-- Last, deliberately: see the ordering note above.
CREATE UNIQUE INDEX IF NOT EXISTS devices_credentials_secret_hash_idx
  ON devices_credentials(secret_hash);
