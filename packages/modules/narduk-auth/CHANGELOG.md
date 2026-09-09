# @narduk-enterprises/narduk-auth

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
