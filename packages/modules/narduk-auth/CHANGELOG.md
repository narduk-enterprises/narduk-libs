# @narduk-enterprises/narduk-auth

## 1.30.2

### Patch Changes

- 47f7131: A key minted by another API key can no longer outlive it
  (narduk-libs#920). `POST /api/auth/api-keys` from an API-key caller clamps a
  child with no `expiresInDays` to the calling key's expiry, and refuses with
  403 an explicit expiry past it, or `null` under a key that expires. A `*` key
  can no longer renew itself for another 90 days before it expires. Session
  callers are unchanged. narduk-core's `AuthUser` gains an optional
  `apiKey: { id, expiresAt }` naming the key behind an `api-key` principal.
- b462046: `GET /api/admin/users` and its `/api/users` alias now accept an
  admin-owned API key only when it carries the new `auth:admin:users:read` scope
  (or `*`). `PUT /api/admin/users/role` is now session-only, so no API key can
  grant or revoke admin, whatever its scopes. Admin sessions are unchanged.
- 591863c: Closed signup can no longer be bypassed by exchanging a self-signup
  confirmation token as `type=invite`. An exchange now counts as an invite only
  when the verified Supabase user has `invited_at` set, which GoTrue records
  only when an operator invites someone. A client-chosen `type` or a stored PKCE
  `redirectType` is no longer enough.
- Updated dependencies [47f7131]
- Updated dependencies [f17ce87]
- Updated dependencies [02b999f]
- Updated dependencies [6a12081]
- Updated dependencies [5ed9665]
- Updated dependencies [8b0e555]
- Updated dependencies [5de0ec4]
- Updated dependencies [ffae997]
- Updated dependencies [f63937e]
- Updated dependencies [0ab6fb1]
  - @narduk-enterprises/narduk-core@2.15.0
  - @narduk-enterprises/narduk-platform@2.2.0
  - @narduk-enterprises/narduk-app@1.20.2

## 1.30.1

### Patch Changes

- 8212ffd: `POST /api/auth/api-keys` now refuses, with 403, to let an API-key
  caller mint a scope it does not hold itself. A key holding only
  `auth:api-keys:write` can no longer mint a wildcard (`*`) key; `*` is mintable
  only by a key that holds `*`. Session-authenticated users are unaffected
  (narduk-libs#858).
- 57cf7b8: `GET /api/auth/session/exchange` now enforces the `authLogin` rate
  limit, like its POST twin. Before this, the GET route ran the Supabase code
  and `token_hash` exchange without any throttle (narduk-libs#879).
- Updated dependencies [61462de]
- Updated dependencies [786568d]
- Updated dependencies [776c0a1]
  - @narduk-enterprises/narduk-core@2.14.1

## 1.30.0

### Minor Changes

- 1dc62db: Revoke an API key by setting `revoked_at` instead of deleting its
  row, so `last_used_at`, `key_prefix` and the scopes survive as the audit trail
  a suspected leak needs (narduk-libs#806).

  - narduk-core: migration `0008_api_key_revoked_at.sql` adds the nullable
    `api_keys.revoked_at` column (ISO text). `authenticateApiKey` refuses a
    revoked key (`null`); `authenticateD1ApiKey` answers
    `{ ok: false, reason: 'revoked' }`, a new member of
    `D1ApiKeyAuthFailureReason`. The new
    `revokeApiKey(db, id, { userId?, now? })` sets the column and keeps the row.
    Run the app's migrations before deploying this version: both authenticate
    functions read the new column. A Postgres app adds it with
    `ALTER TABLE api_keys ADD COLUMN revoked_at text;`.
  - narduk-auth: `DELETE /api/auth/api-keys/:id` revokes through `revokeApiKey`
    (an already-revoked key answers 404), and `GET /api/auth/api-keys` no longer
    lists revoked keys.

  `create-narduk-app` is a companion patch so the generator pins move with core
  and auth.

### Patch Changes

- 429fd81: Refuse a never-expiring wildcard API key and cap its lifetime at 90
  days (narduk-libs#168). `create-narduk-app` is a companion patch so the
  generator pin moves with auth.
- 0c5bf3d: Load a Reflect metadata polyfill on the Workers path so narduk-auth
  passkey routes no longer 500 when tsyringe evaluates without
  `Reflect.getMetadata` (narduk-libs#786). `create-narduk-app` is a companion
  patch so the generator pin moves with auth.
- 1dc62db: narduk-core and narduk-auth register the files they render with
  Tailwind and with Nuxt UI's component detection (narduk-libs#700). Nuxt UI
  adds an `@source` and scans for `U*` components only in Nuxt layers, and both
  packages are modules, so their utilities existed only when a Nuxt UI theme
  happened to name the same class, and `ui.experimental.componentDetection`
  dropped the themes of components only they render.

  - narduk-auth adds its `app/` directory to the `@source` lines in Nuxt UI's
    `ui.css`: `/auth/callback`, `/auth/confirm` and the sign-in pages keep
    `px-4`, `font-bold`, `min-h-[calc(100vh-8rem)]` and their card widths.
  - With `componentDetection` on, both modules add the Nuxt UI components their
    own files render (core's `UButton` on the error page and the `UDashboard*`
    shell; auth's `UAlert` and `UCard`, among others) to the detection list. An
    app no longer lists module files or components to turn detection on.
  - narduk-core exports the helper as
    `@narduk-enterprises/narduk-core/nuxt-ui-sources` (`registerNuxtUiSources`)
    for other modules that ship app files.

- Updated dependencies [70168be]
- Updated dependencies [1dc62db]
- Updated dependencies [1dc62db]
- Updated dependencies [73c6246]
- Updated dependencies [ab81821]
- Updated dependencies [1dc62db]
- Updated dependencies [3052028]
- Updated dependencies [9cb7dbf]
- Updated dependencies [d8f4366]
- Updated dependencies [7ae3a16]
  - @narduk-enterprises/narduk-platform@2.1.2
  - @narduk-enterprises/narduk-core@2.14.0
  - @narduk-enterprises/narduk-app@1.20.2

## 1.29.4

### Patch Changes

- Updated dependencies [dfa8d39]
  - @narduk-enterprises/narduk-core@2.13.1

## 1.29.3

### Patch Changes

- Updated dependencies [e8a373e]
- Updated dependencies [12f3294]
- Updated dependencies [e87803e]
  - @narduk-enterprises/narduk-core@2.13.0

## 1.29.2

### Patch Changes

- Updated dependencies [551e39a]
  - @narduk-enterprises/narduk-core@2.12.0

## 1.29.1

### Patch Changes

- f395bd6: The shared imports block now sets `import-x/resolver-next` to
  eslint-plugin-import-x's own Node resolver (narduk-libs#562). With no resolver
  set, import-x fell back to its legacy `node` probe, which crashed
  `import-x/no-cycle` on a `vitest.config.ts` with "node with invalid interface
  loaded as resolver". An app that turned `import-x/no-cycle` off for its
  `vitest.config.ts` can drop that override. narduk-core and narduk-auth have
  dropped theirs.
- Updated dependencies [5747011]
- Updated dependencies [02b6c1a]
- Updated dependencies [b0dca25]
- Updated dependencies [45ea540]
- Updated dependencies [f395bd6]
  - @narduk-enterprises/narduk-core@2.11.0
  - @narduk-enterprises/narduk-app@1.20.2

## 1.29.0

### Minor Changes

- a7e08a4: Apps can brand the password setup and reset emails through the
  `narduk-auth:email` Nitro hook. A template that throws or drops the link falls
  back to the default email. `sendAuthEmail` sends an app's own account email,
  such as an invitation, from the configured sender.
  `registerLocalUserWithProvenEmail` and `confirmSessionEmailWithProof` create
  or confirm an account for an address the app has just proven by redeeming a
  single-use token it emailed there, so an invited person sets a password and is
  in without a second confirmation email.

### Patch Changes

- Updated dependencies [0da668a]
- Updated dependencies [5ac629e]
- Updated dependencies [1759259]
- Updated dependencies [5ac629e]
  - @narduk-enterprises/narduk-core@2.10.1
  - @narduk-enterprises/narduk-app@1.20.2
  - @narduk-enterprises/narduk-platform@2.1.1

## 1.28.17

### Patch Changes

- e61a56d: `meta.compatibility.nuxt` now says `>=4.0.0`, matching the `nuxt`
  peer range these modules already declare (#444). Before, the module metadata
  still claimed `>=3.16.0`, so a Nuxt 3 app got no compatibility warning from
  Nuxt and failed later instead. Nuxt 4 apps see no change.
- Updated dependencies [056105e]
  - @narduk-enterprises/narduk-core@2.10.0

## 1.28.16

### Patch Changes

- Updated dependencies [671fbf3]
  - @narduk-enterprises/narduk-core@2.9.0
  - @narduk-enterprises/narduk-app@1.20.1

## 1.28.15

### Patch Changes

- Updated dependencies [df7568d]
  - @narduk-enterprises/narduk-core@2.8.1

## 1.28.14

### Patch Changes

- Updated dependencies [cecc72a]
- Updated dependencies [62b7b79]
- Updated dependencies [62b7b79]
- Updated dependencies [c574403]
- Updated dependencies [2671ccd]
- Updated dependencies [b672613]
  - @narduk-enterprises/narduk-core@2.8.0

## 1.28.13

### Patch Changes

- Updated dependencies [693f7d3]
  - @narduk-enterprises/narduk-core@2.7.0

## 1.28.12

### Patch Changes

- Updated dependencies [fa2f123]
  - @narduk-enterprises/narduk-core@2.6.4

## 1.28.11

### Patch Changes

- Updated dependencies [ecc731b]
  - @narduk-enterprises/narduk-core@2.6.3

## 1.28.10

### Patch Changes

- Updated dependencies [81051b0]
  - @narduk-enterprises/narduk-core@2.6.2

## 1.28.9

### Patch Changes

- Updated dependencies [448e86f]
- Updated dependencies [7142305]
  - @narduk-enterprises/narduk-core@2.6.1

## 1.28.8

### Patch Changes

- Updated dependencies [4599aa7]
- Updated dependencies [4ba5d02]
  - @narduk-enterprises/narduk-core@2.6.0

## 1.28.7

### Patch Changes

- 92835a1: Fixes for the new error-severity lint rules. `LayerAppFooter`
  (narduk-core, narduk-seo) no longer reads `new Date()` during render for the
  copyright year; it reads one SSR-hydrated timestamp (`useSsrNow` in
  narduk-core, `useState` in narduk-seo), so server and client agree.
  `GET /api/auth/api-keys` (narduk-auth) is ordered newest first in SQL and
  limited to 100 keys, since nothing caps how many keys a user may create.
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [92835a1]
  - @narduk-enterprises/narduk-core@2.5.0
  - @narduk-enterprises/narduk-app@1.20.1

## 1.28.6

### Patch Changes

- Updated dependencies [bb37590]
- Updated dependencies [bb37590]
  - @narduk-enterprises/narduk-core@2.4.0

## 1.28.5

### Patch Changes

- Updated dependencies [8da7e33]
- Updated dependencies [05b3ef9]
  - @narduk-enterprises/narduk-core@2.3.0

## 1.28.4

### Patch Changes

- Updated dependencies [fe58c5f]
  - @narduk-enterprises/narduk-core@2.2.4

## 1.28.3

### Patch Changes

- Updated dependencies [7ae9278]
  - @narduk-enterprises/narduk-core@2.2.3

## 1.28.2

### Patch Changes

- Updated dependencies [766ce96]
  - @narduk-enterprises/narduk-core@2.2.2

## 1.28.1

### Patch Changes

- Updated dependencies [fa41027]
- Updated dependencies [fa41027]
  - @narduk-enterprises/narduk-core@2.2.1

## 1.28.0

### Minor Changes

- f08deca: Restrict recovery-mode and unstepped MFA sessions at the grant
  validator, and stop empty-scope API keys from acting as the user.

  A password-recovery callback now sets `auth_sessions.recovery_mode` from the
  server-side type, a forwarded `type=recovery`, or `next` on the `token_hash`
  path. A PKCE `?code=` login whose only signal is `next=/reset-password` is not
  recovery. While that flag is set, `requireAuth` only allows
  `GET /api/auth/me`, `POST /api/auth/change-password`, and
  `POST /api/auth/logout`. Successful password change clears the flag; persist
  no longer defaults omitted `recoveryMode` to `false`.

  When `AUTH_REQUIRE_MFA` is on, Supabase sessions whose row `aal` is not `aal2`
  are limited to MFA enroll/verify, logout, and `/api/auth/me`. **Local
  backend:** the flag is ignored (startup warning). There is no TOTP stack to
  step up, so enforcing it would lock password users out. Passkey
  user-verification is not treated as AAL2.

  Account delete, password change, profile update, and MFA enroll/verify now
  require an interactive session. Notification mutations require
  `auth:notifications:write`. Native Apple honors `AUTH_PUBLIC_SIGNUP=false`.
  Recovery never inserts a new local user; invite remains the closed-signup
  door. `isAdmin` (and email/name) are loaded from the current `users` row on
  every refresh, including inside the Supabase 5-minute window. Static asset
  prefixes are skipped by session-refresh middleware.

  ## Operator action

  Re-mint or re-scope every `nk_` API key that calls `POST /api/notifications`,
  `POST /api/notifications/read-all`, `PATCH /api/notifications/:id`, or
  `DELETE /api/notifications/:id` with `auth:notifications:write` **before**
  upgrading. Keys minted with the documented empty-scope default (`scopes: []`)
  currently drive those mutations and will start returning 403 after this
  release. Account delete, change-password, `PATCH /api/auth/me`, and MFA
  enroll/verify now refuse API-key principals entirely.

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

### Patch Changes

- f08deca: Make the sealed `nuxt-session` cookie a pointer to `auth_sessions`,
  not the grant itself.

  `requireAuth` now consults an optional session-grant validator that
  narduk-auth registers on the request. Core-only apps (no validator) keep
  cookie-as-grant behavior. Apps that install narduk-auth fail closed: a cookie
  whose `auth_sessions` row is missing, expired (local), or never existed no
  longer authenticates.

  **Operational consequence.** After deploy, existing sealed cookies whose
  `auth_sessions` row is absent will stop authenticating. That may log some
  users out once — including local-email sessions minted before this change,
  which never wrote a row. They sign in again and receive a server-side session.
  Logout and password change now revoke other browsers that still hold a copy of
  the cookie.

  Login (not the per-request refresh path) opportunistically deletes a
  `LIMIT`-bounded batch of expired `auth_sessions` rows via the existing
  `expires_at` index. Supabase rows now carry the same 30-day absolute expiry as
  local sessions so abandoned rows are sweepable.

  This is a patch: exported function signatures are unchanged, and the behavior
  change is a security correction, not a new API.

- Updated dependencies [f08deca]
- Updated dependencies [d148560]
- Updated dependencies [384925d]
- Updated dependencies [384925d]
- Updated dependencies [cfa085f]
- Updated dependencies [3ae6e51]
- Updated dependencies [77945b9]
- Updated dependencies [31a43a7]
- Updated dependencies [384925d]
  - @narduk-enterprises/narduk-core@2.2.0
  - @narduk-enterprises/narduk-app@1.20.1

## 1.27.2

### Patch Changes

- Updated dependencies [9051c12]
- Updated dependencies [97b0ac3]
- Updated dependencies [fff943d]
- Updated dependencies [57ba098]
- Updated dependencies [b94ac04]
- Updated dependencies [894cd17]
- Updated dependencies [57ba098]
  - @narduk-enterprises/narduk-core@2.1.0

## 1.27.1

### Patch Changes

- Updated dependencies [8f693b1]
- Updated dependencies [8abb3c8]
  - @narduk-enterprises/narduk-core@2.0.0
  - @narduk-enterprises/narduk-app@1.20.0

## 1.27.0

### Minor Changes

- 2e9d424: Set `runtimeConfig.nardukHealth.authTables`, so narduk-core's
  `/api/health` checks the auth tables only in apps that install narduk-auth,
  and narduk-core fails the build when such an app also declares
  `databaseBackend: 'none'`. The README now states that narduk-auth needs an app
  database.

### Patch Changes

- Updated dependencies [2e9d424]
  - @narduk-enterprises/narduk-core@1.25.0

## 1.26.0

### Minor Changes

- 0f45d4b: Migrate this repo's three list endpoints onto the shared list-query
  contract (`parseListQuery` + `listResponse`, narduk-libs#257). Each route
  keeps its own page ceiling and its own sort allowlist. None of the three
  implements free-text search, so all three declare `searchable: false` and
  answer 400 for a non-empty `q` rather than accepting it and returning an
  unnarrowed page.

  **Compatibility.** Previously-accepted query keys and response fields stay
  accepted / present. New contract fields are additive. Drop the deprecated
  aliases in the next major of each package, once fleet apps read `items`.

  **`GET /api/admin/users`** (narduk-auth)

  - Request: `page` is still accepted and converted to
    `offset = (page - 1) * limit`. `offset` is the new key. Sending both with
    disagreeing values answers 400. `limit` above the route's ceiling of 100 is
    now **clamped to 100** instead of answering 400 (more permissive). `sort`
    accepts `createdAt:asc|desc`, defaulting to `createdAt:desc` (previously the
    descending order was fixed). An unknown key is tolerated (200, with a
    warning logged) for one release rather than answering 400 — see
    `.changeset/list-query-tolerate-unknown-keys.md`.
  - Response: the contract shape `{ items, total, limit, offset, sort, q }` plus
    the deprecated aliases `{ users, page }` so existing consumers keep working.

  **`GET /api/notifications`** (narduk-auth)

  - Request: `unreadOnly` is still any string; only `'true'` filters (the
    pre-contract behaviour). `offset` is now honoured (it was previously
    ignored). An unknown query key is tolerated (200, with a warning logged) for
    one release rather than answering 400. `limit` ceiling stays 100,
    default 50.
  - Response: the contract shape plus the deprecated alias `{ notifications }`.
    `total` is `null` — this route deliberately does not count, which keeps a
    page to a single statement.

  **`GET /api/admin/system-prompts`** (narduk-ai)

  - Request: previously accepted no parameters (extras were ignored). It now
    accepts `limit` (ceiling and default 500), `offset`, and `sort` over `name`
    and `updatedAt`. An unknown query key is tolerated (200, with a warning
    logged) for one release rather than answering 400, so a caller that still
    sends an old ignored parameter keeps working.
  - Response: a bare `AdminSystemPrompt[]` cannot also be a `{ items, … }`
    object, so the wire shape is the contract envelope with `total: null`. The
    bundled `useAdminAi` composable still exposes `AdminSystemPrompt[]` (and
    still accepts a bare array from an older server). No fleet app `$fetch`es
    this route directly (GitHub search, 2026-09-11); stonx, operator-portal and
    riverstatus do not consume it. Ordering is now deterministic (`name:asc` by
    default).

  **Migration (optional).** New callers read `data.items` and page with
  `offset`. Apps using the bundled composables and components
  (`useNotifications`, `useAdminAi`, `AdminUsersTab`) keep their existing public
  shapes.

  **narduk-testkit**'s e2e contracts follow the new shapes and still assert the
  legacy aliases: `expectNotificationList` expects `{ items, notifications }`,
  and the users-api spec accepts `page`, asserts `{ items, users, page }`, and
  checks that `limit=9999` now returns 200 with `limit: 100`.

### Patch Changes

- 699b5da: Backfill the registered Auth* cards (`AuthLoginCard`,
  `AuthRegisterCard`, `AuthExchangePanel`, `AuthPasskeysPanel`,
  `AuthApiKeysPanel`) to the shared component suite bar: README props, slots,
  events and example for each, plus mount and `renderToString` SSR tests.
  Existing source-regex guardrails stay. NE Base cards wait for #250.
- 53987d2: Fix `GET /api/notifications?sort=` accepting and echoing the `sort`
  parameter without ever applying it to the query — the response's `sort` field
  and the actual row order silently disagreed (narduk-libs PR #282 review).
  `ListNotificationOptions.sort` now threads through to `getUserNotifications`'s
  Drizzle `orderBy`, honoring every key in the route's `SORTABLE` allowlist
  (currently just `createdAt`, ascending or descending). This is a fix to
  previously-declared contract behavior (the `sort` parameter has been part of
  the shared list-query contract since narduk-libs#247), not new
  request/response surface, hence patch.

  Audited every other `parseListQuery` call site in narduk-auth and narduk-ai
  for the same defect class (a declared sortable/searchable/filter key that
  never reaches the query): `GET /api/admin/users` (narduk-auth) and
  `GET /api/admin/system-prompts` (narduk-ai) already apply their `sort` option
  correctly — no other fix needed.

- Updated dependencies [548fa01]
- Updated dependencies [960479a]
- Updated dependencies [54577ac]
- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
- Updated dependencies [3a2b7b0]
- Updated dependencies [d606e70]
  - @narduk-enterprises/narduk-core@1.24.0
  - @narduk-enterprises/narduk-platform@2.1.0

## 1.25.4

### Patch Changes

- Updated dependencies [e202cfd]
- Updated dependencies [37c03e2]
  - @narduk-enterprises/narduk-core@1.23.2

## 1.25.3

### Patch Changes

- Updated dependencies [aaf5549]
  - @narduk-enterprises/narduk-core@1.23.1

## 1.25.2

### Patch Changes

- Updated dependencies [6297a08]
  - @narduk-enterprises/narduk-core@1.23.0

## 1.25.1

### Patch Changes

- Updated dependencies [def589f]
  - @narduk-enterprises/narduk-core@1.22.0

## 1.25.0

### Minor Changes

- 48e71ca: Add opt-in browser authorization for native clients using one-time
  S256 PKCE codes, rotating opaque credentials, and revocable D1 sessions.
  Persist optional local email verification proof for consumers that bind
  invitations to verified addresses. Existing consumers retain their current
  behavior until enabling the features after applying the additive migration.

## 1.24.1

### Patch Changes

- 46c9165: Restrict self-serve password links to requests whose origin matches a
  configured loopback app URL. Public deployments fail before issuing a token
  when the development shortcut is enabled. Local Nuxt and Wrangler fixtures
  remain supported.

## 1.24.0

### Minor Changes

- 5e35fae: Add passkey (WebAuthn) sign-in and enrolment to the local auth
  backend (narduk-libs#125, W7 A1–A4).

  Passkeys sit **beside** email + password, never in place of it: password
  sign-in is unchanged, so an unenrolled or lost authenticator is not a lockout
  (narduk-libs#125 D2, "Passkeys beside email+password"). Passkeys are
  local-backend only; the Supabase pathway is untouched.

  Enable with `passkey` in `AUTH_LOCAL_PROVIDERS` plus `AUTH_WEBAUTHN_RP_ID` and
  `AUTH_WEBAUTHN_ORIGIN` (optionally `AUTH_WEBAUTHN_RP_NAME` and
  `AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS`). Anything missing or invalid fails
  closed: the routes answer 501 with the specific reason and the login card does
  not offer the button.

  **Migration.** This release adds `drizzle/0003_webauthn_credentials.sql`,
  which is **D1/SQLite only** — this module publishes no Postgres schema or
  migrations for the auth bridge tables (narduk-libs#94). It is purely additive
  (`CREATE TABLE IF NOT EXISTS` for `auth_webauthn_credentials` and
  `auth_webauthn_challenges`, plus indexes; no change to any existing table), so
  it is a no-op for an app that never enables passkeys. There is no
  down-migration.

  Verification uses `@simplewebauthn/server@13.3.3` and
  `@simplewebauthn/browser@13.3.0`, **exact-pinned** (narduk-libs#125 D3). The
  v13 line is chosen deliberately over v14: v14.0.0 is three days old with an
  hours-old patch, its only breaking change is raising the minimum Node LTS, and
  v13 already carries the GHSA-6hxq-p678-4hr2 x5c trust-anchor fix.

  Security properties, each pinned by a test: registration and management routes
  require an existing session (`defineUserMutation`) so a consuming app that
  treats `/api/auth/` as public at its own boundary still cannot be enrolled
  anonymously; API-key principals are refused (403) so a leaked machine token
  cannot become a persistent interactive login; challenges are stored hashed,
  claimed exactly once before verification, and refused across ceremonies; user
  verification is required and credentials are discoverable, so sign-in carries
  no identifier, no `allowCredentials`, and one generic 401 for every failure; a
  signature counter that does not strictly increase is refused and the new
  counter is written conditionally on the one verified against; RP ID and
  origins never come from the request host; and the challenge table carries an
  absolute live-row ceiling, because the public sign-in options endpoint's rate
  limit is keyed on the client IP and a caller rotating addresses is otherwise
  unbounded.

  Also corrects the README's stale claim that the local email pathway is "a
  complement to Cloudflare Access, not a replacement for it" — company-hq
  `D-AUTH-2` (2026-09-03) records the estate decision to leave Cloudflare Access
  for app-level narduk-auth.

## 1.23.0

### Minor Changes

- 1721a1c: Let the local backend advertise additional auth providers through an
  explicit opt-in `AUTH_LOCAL_PROVIDERS` env var (comma-separated, filtered
  against a known allowlist of `apple` and `passkey`). Unset, `authProviders`
  still resolves to exactly `['email']` for every existing consumer — this is
  preparatory plumbing for upcoming passkey (narduk-libs#125) UI work and adds
  no new authentication behavior on its own.

### Patch Changes

- Updated dependencies [cc5bbbb]
- Updated dependencies [0f2262a]
- Updated dependencies [8b48dba]
  - @narduk-enterprises/narduk-app@1.20.0
  - @narduk-enterprises/narduk-core@1.21.0

## 1.22.0

### Minor Changes

- 1196849: Drop the published Postgres bridge surface:
  `server/database/auth-bridge-pg-schema`, `server/database/pg-app-schema`, and
  `server/database/pg-schema` are removed, along with the `typecheck:postgres`
  gate in `quality:strict`. The package advertised a Postgres dialect it never
  shipped migrations for (narduk-libs#94) — `useAuthBridgeDatabase` now calls
  `createAppDatabase` with the D1 schema only, so a Postgres-backend build no
  longer gets a type-checked-but-non-functional auth bridge; it gets a clear
  absence instead.

  Per operator decision:

  > Logan, 2026-09-04: "Drop the published Postgres surface (Recommended)"

  **Migration for a consumer importing the removed subpath:** if your app
  imports
  `@narduk-enterprises/narduk-auth/server/database/auth-bridge-pg-schema`
  (directly or via your own `server/database/pg-app-schema.ts` re-export),
  delete that import — it was unused scaffolding with no matching migration on
  either side. One known consumer is tracked at
  narduk-enterprises/been-sober-for#95.

- ee7452c: Consolidate the package's four divergent same-origin redirect guards
  onto one hardened implementation, `sanitizeSameOriginPath` in
  `shared/utils/same-origin-path.ts`.

  `app/utils/safeRedirectPath.ts`, `server/lib/app-auth/helpers.ts`,
  `server/lib/app-auth/local-email-core.ts` and
  `server/api/auth/session/exchange.get.ts` each carried their own copy of the
  "is this a safe same-origin path?" check, and they did not agree. Only the
  client-side copy rejected a bare (non-`/`-prefixed) value or a percent-encoded
  backslash, so the advisory client check was strictly stricter than the
  authoritative server checks it was meant to mirror — the weaker check sat on
  the trust boundary that matters.

  The consolidated guard takes the strictest rule any copy had, so the accepted
  set can only narrow:

  - a value that does not start with `/` is rejected rather than coerced into a
    path (`next=example.com` no longer becomes `/example.com`);
  - a percent-encoded backslash (`%5c`, any case) is rejected on the server as
    it already was on the client;
  - protocol-relative (`//host`), literal-backslash, and raw-control-character
    values are rejected by explicit checks rather than only as a side effect of
    URL normalization;
  - malformed percent-encoding (`/%zz`, `/ok%`, `/a%2`) is rejected everywhere,
    as only the local-email copy did (as a side effect of decoding);
  - a non-string value is rejected rather than coerced.

  `sanitizeLocalRedirectPath`, `sanitizeNextPath` and
  `sanitizeLocalEmailRedirect` keep their names and signatures and now delegate
  to the shared guard, so no importer has to change.

  The auth-callback failure branch in `server/api/auth/session/exchange.get.ts`
  now also runs the caller-supplied `next` through the guard before re-emitting
  it on the error redirect, instead of passing it through verbatim.

### Patch Changes

- d6e098e: Set explicit `autocomplete` tokens on `AuthLoginCard` and
  `AuthRegisterCard` credential fields (`email`, `current-password`,
  `new-password`, `name`). `@nuxt/ui@4.6.0`'s `Input.vue` defaults
  `autocomplete` to `"off"` when a consumer doesn't override it, which blocked
  password managers from filling or saving credentials on every app using these
  cards (narduk-libs#60).
- Updated dependencies [d6e098e]
  - @narduk-enterprises/narduk-core@1.20.5

## 1.21.1

### Patch Changes

- c83b8eb: narduk-auth: fix WCAG AA colour-contrast failure on the `/login` auth
  card's subtitle, "Forgot your password?" link, and footer text.

  `AuthLoginCard.vue` rendered those three lines with Nuxt UI's `text-muted`
  utility, which resolves to `neutral-500` (light) / `neutral-400` (dark) — a
  pairing Nuxt UI only guarantees against its own default `--ui-bg` (white in
  light mode). Consuming apps are free to repoint `--ui-bg` at a different
  "default" surface, as operator-portal does (`app/assets/css/tokens.css`:
  `--ui-bg: var(--op-ground)`, `#edf0f4`). Against that background `neutral-500`
  measures 4.17:1 — below the 4.5:1 floor, matching the 4.16:1 axe found on
  operator-portal's `/login` (narduk-enterprises/operator-portal#238,
  `tests/e2e/accessibility-baseline.json`).

  Swapped `text-muted` for Nuxt UI's `text-toned` (`neutral-600` light /
  `neutral-300` dark) on all three lines — still a muted, secondary ink, but
  with headroom to clear 4.5:1 against both Nuxt UI's own default background and
  operator-portal's `#edf0f4` ground, in both themes. The fix stays local to
  narduk-auth: `text-muted` is a Nuxt UI framework default, not a value the
  narduk-ui design-token layer (`packages/design/narduk-ui/tokens.css`) defines
  or owns, so a token-layer edit would not have touched this component and would
  have rippled into unrelated narduk-ui consumers for no benefit.

  Added a deterministic, browser-free unit test
  (`tests/auth-login-card-contrast.test.ts`) that computes the WCAG contrast
  ratio from Tailwind's own oklch colour definitions and asserts the fix clears
  4.5:1 in both themes, including against the exact background that exposed the
  bug — so this cannot regress silently.

  Refs narduk-enterprises/operator-portal#238

## 1.21.0

### Minor Changes

- aa0590a: Correctness pass over the auth package:

  - `POST /api/auth/session/exchange` now accepts the same
    `tokenHash`+`verificationType` shape as the GET route, and
    `AuthExchangePanel` handles Supabase `token_hash`+`type` email links instead
    of dead-ending with "The auth callback is missing its code."
  - The Supabase password-recovery redirect is now a same-origin path, so the
    client exchange panel no longer throws on an absolute URL passed to
    `navigateTo` without `external: true`.
  - `/reset-password?recovery=1` without a token no longer hides the
    current-password field on a runtime-confirmed local backend, where that form
    could never succeed (local changePassword always verifies the current
    password). While the runtime backend is unresolved the page keeps the
    recovery form, so Supabase recovery landings are unaffected.
  - `PUT /api/admin/users/role` returns 404 for an unknown `userId` instead of
    silent success, and executes through the shared query path instead of
    `.run()`.
  - Local email/password logins fail with a clear "apply
    drizzle/0002_local_email_auth.sql" message when the lockout table is
    missing; the hard migration coupling introduced in 1.20.0 is now documented
    in the README and CHANGELOG.
  - `verifyMfa` reports `aal1` instead of asserting `aal2` when the session
    could not be persisted.
  - Removed the dead `loginAsTestUser()` composable function (its
    `/api/auth/login-test` endpoint never existed) and the never-runnable
    `db:generate`/`db:studio` scripts (no drizzle config has ever shipped).
  - `server/utils/accountDeletion.ts` is now a pure re-export of the bridge
    implementation instead of a byte-divergent copy; the un-suffixed names keep
    working.
  - New passwords and profile names are capped at 200 characters (existing
    credential verification stays uncapped), and `auth_email_links.purpose` is
    typed to the `setup`/`reset` values the migration CHECK enforces.

## 1.20.2

### Patch Changes

- Updated dependencies [1d017c7]
  - @narduk-enterprises/narduk-core@1.20.4

## 1.20.1

### Patch Changes

- fa7670b: Render provider-aware login copy so email-only applications do not
  advertise Sign in with Apple.

## 1.20.0

### Minor Changes

- 8adb1ec: Add an opt-in local email/password setup and recovery pathway
  informed by the reusable PACC TRAC and Harvest Tracker patterns: digest-only,
  email-bound, single-use links; explicit redemption; safe local redirects;
  generic request responses; and persistent lockout. This is additive to local
  auth, leaves the Supabase pathway unchanged, and explicitly does not replace
  or bypass Cloudflare Access as an app's outer gate.

  **Upgrade note (added retroactively):** this release made
  `drizzle/0002_local_email_auth.sql` mandatory for the default local backend —
  every local email/password login now reads the `auth_local_email_attempts`
  table it creates. A local-backend app upgrading past 1.19.x without applying
  that migration fails every login until it runs. See README "Migrations".

## 1.19.31

### Patch Changes

- @narduk-enterprises/narduk-app@1.19.1
- @narduk-enterprises/narduk-core@1.20.3

## 1.19.30

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves
  into narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for
  ESLint 10 on a replace-by-default basis — maintained third-party plugins
  wherever they cover the intent, 45 bespoke rules surviving out of 103 (every
  one with tests and no `testMode` bypasses), the proven-inverted hydration
  rules and dead Nitro security gates rebuilt against the executed deep-review
  proofs, legacy presets and the frozen nuxt-ui spec tier removed, and every
  code-corrupting autofixer gone. Consumer API (`createAppLintConfig`,
  `composeSharedConfigs`, the 14 capability packs) is signature-compatible;
  adopting v2 requires ESLint `^10` (peer). License corrected to UNLICENSED
  (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening
  pass (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer
     `cwd` — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core
     rules the packs carry are gated out of `tests/**` and friends so the
     widening does not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites
     under `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did
     for every consumer using `nardukTemplateStrictCapabilityPacks`. Those
     patterns start applying again. A portable Nuxt layer (no `#server/*` alias
     for its own sources) should assign the new
     `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` export to its server glob rather
     than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by
  renaming a binding (an aliased `defineEventHandler`, a runtime-derived HTTP
  method, `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver,
  and `limit: undefined`), and `no-legacy-overlay-model`'s blindness to
  camelCase `modelValue` bindings. Every one ships with the fixture that proved
  it as a regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting
  v2 also swept their stale `eslint-disable` comments onto the replacement rule
  ids and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer
  that `readWorkerRuntimeEnv` already supplied and that the merge order
  discarded; and `narduk-app-tools` swaps one `split().join()` for
  `replaceAll()`. The five layer packages (`narduk-core`, `-auth`, `-seo`,
  `-ai`, `-uploads`) assign the portable-layer import rule in their own configs,
  and `narduk-core` and `-uploads` carry scoped, commented exceptions for the
  pre-existing conditions their newly-linted `runtime/server/**` trees surfaced.

- Updated dependencies [95ec690]
  - @narduk-enterprises/narduk-core@1.20.2
  - @narduk-enterprises/narduk-app@1.19.1

## 1.19.29

### Patch Changes

- Updated dependencies [e030789]
  - @narduk-enterprises/narduk-core@1.20.1

## 1.19.28

### Patch Changes

- e4c8262: Replace implicit reliance on `narduk-core`'s Nuxt auto-imports
  (`useAppFetch`, `formatBuildTimeLocal`, `useLogger`, `requireAdmin`) with
  explicit imports from `@narduk-enterprises/narduk-core/*` subpaths.

  These composables/utils were previously called as bare globals, which only
  resolves when a consuming app registers `narduk-core`'s Nuxt module with its
  default options (`app: true`). A consumer that narrows the module surface (for
  example `{ app: false, server: true }`, used by `spacex-ipo` to avoid a
  component-registration collision with `narduk-seo`'s own `LayerAppFooter`)
  fails `nuxt typecheck` with `Cannot find name 'useAppFetch'` the moment it
  also depends on `narduk-seo` or `narduk-auth`, because those packages'
  composables/components still assumed the global was present.

  No behavior change: each site now imports the exact same function it was
  already calling implicitly.

  Bump `create-narduk-app` in step so its generated-app pins for `narduk-seo`,
  `narduk-auth`, and `narduk-analytics` refresh to these patched versions.

## 1.19.27

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
