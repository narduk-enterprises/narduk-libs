---
'@narduk-enterprises/narduk-postgres': minor
---

Add the Supabase backend (#112): `createSupabaseBackend`,
`parseSupabaseConnectionString` and `SUPABASE_CAPABILITIES`. It opens the same
`SqlExecutor` through the consumer's driver, with no new dependency; it reads the
direct/session/transaction mode from the connection string, requires TLS, refuses
a role on a transaction-mode connection, and reports no DDL or role switching in
transaction mode and no TimescaleDB in any mode. New error code
`SUPABASE_CONNECTION_INVALID`; `SUPABASE_BACKEND_STATUS` is deprecated.
