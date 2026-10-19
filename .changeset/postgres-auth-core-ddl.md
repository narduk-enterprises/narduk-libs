---
"@narduk-enterprises/narduk-core": minor
"@narduk-enterprises/narduk-auth": minor
"@narduk-enterprises/create-narduk-app": patch
---

Ship Postgres DDL and a Postgres runtime for narduk-core and narduk-auth, so an app on `databaseBackend: 'postgres'` (Hyperdrive) can run narduk-auth's local backend. narduk-core adds `runtime/drizzle-pg/0000`–`0008` (exported as `./drizzle-pg/*`), and narduk-auth adds `drizzle-pg/0001`–`0005` plus Drizzle Postgres schemas selected through a new `#narduk-auth/schema` alias at `modules:done`; apply core's set first, in separate migration ledgers. Both sets are proven against a real PostgreSQL 17 (catalog diff against the Drizzle schemas, plus an integration test of login, lockout, sessions, email links, Apple linking, passkey storage, MCP OAuth KV, native sessions, API keys and notifications). Postgres epoch-second columns are `bigint` (`sessions`, `kv_cache` and `api_keys` `expires_at` were `integer` in `pg-schema.ts`, which overflows in 2038; no Postgres migration existed to apply), and `auth_oauth_kv.key` is `COLLATE "C"` so prefix range scans are byte-ordered under any database collation. D1 behaviour and migrations are unchanged. A bcrypt hash imported from Supabase verifies as-is and is rehashed to PBKDF2 on first login.
