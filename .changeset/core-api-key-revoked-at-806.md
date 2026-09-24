---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

Revoke an API key by setting `revoked_at` instead of deleting its row, so
`last_used_at`, `key_prefix` and the scopes survive as the audit trail a
suspected leak needs (narduk-libs#806).

- narduk-core: migration `0008_api_key_revoked_at.sql` adds the nullable
  `api_keys.revoked_at` column (ISO text). `authenticateApiKey` refuses a
  revoked key (`null`); `authenticateD1ApiKey` answers
  `{ ok: false, reason: 'revoked' }`, a new member of
  `D1ApiKeyAuthFailureReason`. The new `revokeApiKey(db, id, { userId?, now? })`
  sets the column and keeps the row. Run the app's migrations before deploying
  this version: both authenticate functions read the new column. A Postgres
  app adds it with `ALTER TABLE api_keys ADD COLUMN revoked_at text;`.
- narduk-auth: `DELETE /api/auth/api-keys/:id` revokes through `revokeApiKey`
  (an already-revoked key answers 404), and `GET /api/auth/api-keys` no longer
  lists revoked keys.

`create-narduk-app` is a companion patch so the generator pins move with core
and auth.
