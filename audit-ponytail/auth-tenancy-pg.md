# Ponytail audit: narduk-auth, narduk-tenancy, narduk-postgres

Audit spec: ponytail-audit v5.3.2, estate-adapted. Read-only. Base `212392aa` (`main`).

What this repo does: `narduk-libs` publishes shared libraries for Narduk Nuxt apps on Cloudflare. These three packages are the auth layer (sessions, passwords, Apple, passkeys, API keys, native PKCE, MCP OAuth), the D1 organization layer (members, invites, overrides, support grants, audit), and the Postgres helper layer (Hyperdrive and Node connections, health, migrations, roles). Apps call them on each request or at deploy time.

Load I assumed: a Worker handles many concurrent requests, with human login and invite rates far below that. Auth sessions last 30 days in D1. API keys and MCP tokens are presented on server routes. Native refresh can race; the server must allow only one winner. Tenancy orgs hold hundreds to a few thousand members, and `resolveRole` runs on many requests. Postgres Workers open at most a handful of Hyperdrive sockets per invocation. Migrations run on one Node connection during deploy. Health checks run on a timer. I did not assume a public internet brute-force of invite tokens (they are 256-bit) or orgs with tens of thousands of members.

## Must fix

### 1. A local account with no password can be deleted by any live session

`packages/modules/narduk-auth/server/utils/accountDeletionBridge.ts:106-126`

What this is: Account deletion asks for the current password when the user row has a `password_hash`. Supabase accounts that have no password must have signed in during the last 10 minutes (`profile.ts:169-204`).

Problem: A local Sign in with Apple user is stored with `passwordHash: null` (`apple-local.ts:259-264`). `usesSupabaseCredentials` is false for `authBackend: 'local'`. The `else if (dbUser.passwordHash)` branch is skipped. `POST /api/auth/account/delete` with `{}` then deletes the user. The session row lives 30 days (`session.ts:47-54`) and refresh does not rewrite `createdAt`. A cookie stolen on day one still deletes the account on day 29. The local test only covers a row that already has a hash (`tests/account-deletion-reauth.test.ts` "keeps the local backend on the local hash check").

Fix: When the local hash is missing, require the same recent `auth_sessions.createdAt` check before delete. Add a test whose user has `passwordHash: null`, `authBackend: 'local'`, and `createdAt` older than 10 minutes, and expect `403` `reauthentication_required`.

If we skip it: A stolen or borrowed browser session can destroy an Apple-only account with no second check.

## Should fix

### 2. Password reset saves the new hash before it kills other sessions

`packages/modules/narduk-auth/server/lib/app-auth/local-email-flow.ts:137-200`

What this is: Completing a local reset or setup link consumes the token, writes `password_hash`, revokes native sessions, then deletes `auth_sessions`.

Problem: Those writes are separate autocommits. The token update at lines 137-149 succeeds, then the password update at lines 168-187 succeeds, then `revokeUserAuthSessions` throws (D1 error, or the isolate stops). The one-time token is already consumed, so the same link cannot be retried. Old session cookies still pass `loadAuthSessionRow` until they expire, up to 30 days, and they now belong to the account whose password just changed.

Fix: After the token is consumed, delete the session rows (and native rows) before updating `password_hash`. A failure then logs everyone out and leaves the old password; the user asks for a new link. Do not update the hash first.

If we skip it: A reset that dies on the revoke step looks failed to the user and leaves every old browser signed in.

### 3. The MCP bearer guard misses the slash Nitro still routes

`packages/modules/narduk-auth/server/mcp-oauth/resource-guard.ts:15-24`

What this is: For a non-GET to the MCP resource path, a missing `Authorization: Bearer` gets a 401 before the app handler can use the session cookie. This package already says Nitro treats `/api/_auth/session/` as the same route as `/api/_auth/session` (`server/middleware/auth-session-refresh.ts:17-19`).

Problem: The guard compares `getRequestURL(event).pathname` to `resourcePath` with no slash trim. `POST /mcp/` does not equal `/mcp`, so the guard returns and the handler runs. A same-site request carries the `SameSite=Lax` session cookie. A cross-site POST does not. Concrete case: the signed-in app (or any same-origin page) `POST`s `/mcp/` with the cookie and no `Authorization` header. The guard does not 401. A handler that falls back to the session, which is the case this middleware exists to stop, treats the cookie as the MCP caller.

Fix: Normalize the path the same way as the session middleware: drop the query and a trailing slash, then compare. Add a test that `POST /mcp/` with a cookie and no bearer is 401.

If we skip it: The "cookie can never call MCP" rule is only true for the exact path string.

### 4. Removing a member can leave a narrowing override behind

`packages/modules/narduk-tenancy/server/utils/tenancy.ts:946-968`

What this is: `removeMember` deletes the membership, then deletes that user's resource overrides, then writes the audit row. Overrides reference the org, not the membership, so deleting the membership does not cascade them (`drizzle/0001_tenancy.sql:45-54`).

Problem: The two deletes are separate D1 autocommits. Membership delete succeeds. Override delete throws. The function throws. A retry hits `requireMembership` and returns `not_found`, so the overrides stay. Later `addMember` of the same user as `admin` succeeds. `resolveRole` for that resource returns `narrowerRole('admin', 'viewer')`, which is `viewer`. The user is back, and the old narrowing still applies. `createOrg` was moved into one batch for this class of partial write. `removeMember` was not.

Fix: In one `runTenancyBatch`, delete the membership under the existing rank and last-owner predicate, and delete overrides only when that membership row is gone (`NOT EXISTS` on the member). If the membership delete matches nothing, the override delete matches nothing too.

If we skip it: A failed remove followed by a re-add silently restores a restriction the remove was supposed to clear.

### 5. A role change can succeed and then lose its audit row

`packages/modules/narduk-tenancy/server/utils/tenancy.ts:603-631` and `917-926`

What this is: The package says every mutation writes one `tenancy_audit_events` row. `setMemberRole`, `addMember`, `removeMember`, invites, and support grants write that row in a later autocommit. `createOrg` and invite accept already batch the audit with the change.

Problem: `setMemberRole` updates the role, then the audit insert throws. The caller retries. Line 925 sees the role already equals the requested role and returns the row. No audit insert runs. The promotion is permanent and absent from `listAuditEvents`. The same gap exists anywhere the audit insert is the second statement, but the retry no-op makes `setMemberRole` drop it for good.

Fix: Put the membership update and the audit insert in one `runTenancyBatch`, with the audit insert conditional on the update matching a row. Do the same for the other mutations that still audit after the commit.

If we skip it: An incident review of a role change that hit a D1 error on the audit write shows no trail, and a retry will not recreate it.

### 6. `redactSecrets` keeps a password when the DSN has no username

`packages/modules/narduk-postgres/src/redact.ts:44-51`

What this is: Driver errors often contain a connection URL. `redactSecrets` is what `checkHealth` copies into the report (`health.ts:51-59`). `redactConnectionString` already redacts this URL shape.

Problem: The username group in the regex is required (`+`). This input is unchanged: `connection to postgres://:hunter2@10.70.0.4:5432/db failed`. The health report's `error.message` still contains `hunter2`. A normal `postgres://ingest:hunter2@host/db` is redacted.

Fix: Allow an empty username in that regex, the same way `new URL` does. Add this string to `tests/redact.test.ts`.

If we skip it: A health route or log line can publish the password from a no-username DSN.

### 7. A Node application name is pasted into a libpq command line

`packages/modules/narduk-postgres/src/tuning.ts:161-171`

What this is: `toNodePostgresOptions` builds `options` as `-c key=value` joined by spaces. `application_name` is the caller-supplied `applicationName`. The Worker path passes the same value as its own startup parameter, so this is the Node path only. `role` is otherwise limited to `ingest_writer`, `history_reader`, and `ops`.

Problem: libpq splits that string on spaces. `nodeDriverOptions({ applicationName: 'Narduk Postgres' })` produces `-c application_name=Narduk Postgres -c statement_timeout=300000`. The server sees a stray argument `Postgres` and can drop or reject the rest, including the statement timeout this package says is always set. `nodeDriverOptions({ applicationName: 'x -c role=postgres' })` produces a startup `role=postgres`. Nothing later overrides it when `tuning.role` is unset. The session role is no longer one of the three allowed names.

Fix: Reject an `applicationName` that is not a single token (`/^[A-Za-z0-9_.-]{1,63}$/`) in `resolveTuning`, or escape spaces for libpq before joining. Add a test that a space or ` -c ` cannot appear as a second `-c` flag.

If we skip it: A normal name with a space breaks the Node timeout, and a name containing ` -c ` can set a role the allowlist would refuse.

### 8. A no-transaction migration is re-run after it already succeeded

`packages/modules/narduk-postgres/src/migrate.ts:718-728`

What this is: A file whose first line is `-- narduk:no-transaction` runs one statement per round trip, then inserts the ledger row. That is outside a transaction on purpose (`CREATE INDEX CONCURRENTLY` and continuous aggregates cannot run inside one).

Problem: File `0002_history_ts_idx.sql` contains the directive and `CREATE INDEX CONCURRENTLY history_ts_idx ON history (ts)`. The index is created. The process dies before the `INSERT` into `schema_migrations`. The next deploy still sees the file as pending and sends `CREATE INDEX CONCURRENTLY` again. Postgres answers that the relation already exists. The deploy cannot finish, and the ledger still has no row.

Fix: Before running a no-transaction file, insert a ledger row that marks it started (same name, a distinct in-progress checksum or column). On the next run, if that marker is present and the checksum row is not final, fail with `MIGRATION_PARTIAL` and the file name, and do not execute the file again. The operator repairs that one file, then records the real checksum.

If we skip it: One crash after concurrent DDL sticks every later deploy on that file.

## Nice to have

### 9. A non-integer list limit crashes instead of using the clamp

`packages/modules/narduk-tenancy/server/utils/tenancy.ts:1341-1342` and `1370-1374`

What this is: `listAuditEvents` documents a default of 50 and a max of 200. `listActiveSupportGrants` clamps to 1..200.

Problem: `NaN ?? 50` is `NaN`, and `Math.min(NaN, 200)` is `NaN`. `listAuditEvents({ orgId, limit: Number('nope') })` sends `LIMIT NULL`. SQLite raises `datatype mismatch`. The same happens for `1.5`. The caller gets a driver error instead of the default page. `limit: 0` and negatives do clamp.

Fix: If `limit` is not an integer, throw `TenancyError` `invalid`, or ignore it and use the default. Use one helper for both lists.

If we skip it: A bad query param 500s the audit or support-grant list.

### 10. A down database is reported as a missing connection string

`packages/modules/narduk-postgres/src/node.ts:83-89`

What this is: `withNodeConnection` checks that the string is non-empty, then connects. `createSupabaseBackend` uses `SUPABASE_CONNECTION_INVALID` when the driver throws.

Problem: The string `postgres://ops:secret@10.70.0.4:5432/db` is present. The server refuses the connection. The thrown code is `CONNECTION_STRING_MISSING`, the same code as an empty string (lines 68-72). A caller that treats that code as "no DSN configured" skips a real outage.

Fix: Add a code such as `CONNECTION_FAILED` for the driver `catch`, and keep `CONNECTION_STRING_MISSING` for the empty string. The Worker path should stop using `HYPERDRIVE_BINDING_INVALID` for the same driver failure (`worker.ts:92-98`).

If we skip it: Deploy and health tooling mis-label "Postgres is down" as "the DSN was not set".

## Left out

Eight smaller items did not make the list. `sslmode=Disable` is not in the refusal set, and the driver options still set `ssl: 'require'`. Three loopback host lists are copied (`redirect-uri.ts`, `mcp-oauth/config.ts`, `local-email-core.ts`) and the issuer one also treats any `127.x.x.x` string as loopback. The expired-session sweep cap of 50 and the support-grant scan cap of 100 are named fail-closed limits. Login lockout is checked, then incremented, so a parallel burst can pass the threshold by a few tries. `placeholderTuplesWithCasts` splices the cast into the SQL; callers in this repo pass fixed type names (`uuid`, `text`). The Apple sign-in cookie is not re-checked on read; writing it already requires the browser that holds the `HttpOnly` cookie. `withSessionSearchPath`'s `finally` can replace the original migration error if restoring `search_path` throws.

Verdict: The rank re-checks, invite claim, PKCE exchange, and API-key mint ceiling are in good shape and are tested with races. Fix the local account-deletion hole before the next auth release. The other items are partial writes and edge cases that show up when a second statement fails or a path or DSN is slightly off.

Not checked: `narduk-core` password hashing, API-key lookup, `requireAuth`, rate limits, and the `X-Requested-With` middleware (other lanes). The inside of `@cloudflare/workers-oauth-provider` and `@simplewebauthn/server`. Most Vue pages, design cards, and the Swift Keychain client beyond the native refresh and sign-in flow. Live D1 and live Postgres (no installs or builds). Fleet apps outside this repo. I read the security paths, schemas, and the race and deletion tests; I did not read every auth UI test.
