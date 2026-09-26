# @narduk-enterprises/create-narduk-app

## 0.14.6

### Patch Changes

- 24a81ad: `narduk-app development` deploys: a Cloudflare request that never
  completed now says which request and why, e.g.
  `Cloudflare GET /workers/scripts did not complete (TimeoutError: …; cause none)`,
  and keeps the original error as `cause`. The deploy receipt's `failure`
  records the same text, so a timeout, a DNS failure and a reset connection can
  be told apart (narduk-libs#1096). No token, account id or response body is
  included, and writes are still never retried.
- 1300651: Add `narduk-app doctor --all`: one command with one verdict line,
  `DOCTOR PASS|WARN|FAIL -- <reason>`, followed by each leg's own report. It
  composes the existing legs and reimplements none of them: bare `doctor`'s
  prerequisites, `doctor --adoption` (foundation, toolchain, shared-UI, coverage
  and deployment checks, plus the security-header and live probes with
  `--live`), and `doctor --audit`. Exit 1 only on FAIL. An undecided adoption
  requirement or an unreachable registry reads WARN, never red. `--json` prints
  the verdict and all three leg reports as one object. Bare `doctor`,
  `--adoption` and `--audit` are unchanged (#376).
- c0e54c4: Add `narduk-app ensure-generated <file...> -- <command...>` and
  `narduk-app check-starter-identity`, the shared versions of the
  `ensure-generated-files.sh` and `check-starter-identity.mjs` copies
  template-derived apps carry, with the same rules (#1019).
- 881452e: Supabase backend: a social-only session (no `email` provider) must
  have signed in within `RECENT_SIGN_IN_WINDOW_SECONDS` (10 minutes) to set its
  first password through `POST /api/auth/change-password`; an older session gets
  403 `reauthentication_required`. Before, it could set a password with no
  proof, sign in with it, and so satisfy the recent-sign-in window that account
  deletion relies on (narduk-libs#1075). Recovery sessions are exempt.
- 5c87827: narduk-auth: `POST /api/auth/mfa/enroll` and
  `POST /api/auth/mfa/verify` answer
  `501 MFA is only available when Supabase auth is enabled.` on the local
  backend (#1048). They used to answer the Supabase-session 401, which reads as
  an expired session and sends the user to sign in again for nothing.
- d062de8: narduk-auth (#1060):

  - `resolveRequestPrincipal(event, { allowNative: true })` no longer throws 404
    or 503 on an app without native sign-in (no native clients, or not the local
    backend). A request carrying a bearer that is not an `nk_` key now resolves
    the session, or `null`, as the README says.
  - Starting a passkey ceremony answers the fixed 503 and logs the cause when
    `@simplewebauthn/server` throws while generating options, not only when it
    fails to load. Before, the caller got an opaque 500.
  - The `clientDataJSON` decoder is strict base64url. Whitespace, standard
    base64's `+` and `/`, a lone trailing character and surplus padding are
    refused. Both decoders already failed closed, and tests now pin this one.
  - Tests cover the 503 on both finish ceremonies and on a failed
    `@simplewebauthn/server/helpers` load.

- f6bcea4: narduk-auth: a local-backend session now follows the users row's
  sign-in methods (#1042). When a password has been set, or an Apple ID linked,
  since the cookie was issued, the next request clears `needsPasswordSetup` and
  adds `email` or `apple` to `authProviders`, and the refresh rewrites the
  cookie. In practice this reaches other live sessions through Apple linking;
  setting a first password by email link already signs every other session out.
  The refresh now compares `needsPasswordSetup`, `authProvider`, `authProviders`
  and `emailConfirmedAt` as well as email, name, isAdmin, recoveryMode and aal.
  Providers the row cannot see, such as a passkey sign-in, are kept;
  Supabase-backend sessions are unchanged.
- 78527a7: narduk-auth: an `auth_sessions` row's expiry is now enforced on the
  Supabase backend as well as the local one (#1043, part). That covers every
  session read path and `getCurrentSupabaseContext`, which could otherwise
  refresh an expired row back to life. Before, a Supabase cookie was accepted on
  an expired row while it was inside its revalidation window or when the
  Supabase refresh failed recoverably, until a login sweep happened to delete
  the row. A Supabase session that made no request for 30 days (the row's
  window, which a refresh slides) now signs in again.

  Upgrading from narduk-auth below 1.28.0: a Supabase row written before 1.28.0
  holds the access token's expiry, about an hour, not the 30-day lifetime, and
  is refused once that hour has passed. On an app that upgrades straight from
  below 1.28.0, every Supabase user not active in the hour before the deploy
  signs in again, once; the new sign-in writes a 30-day row. From 1.28.0 a row
  is rewritten at its next refresh, so only users idle since that upgrade are
  affected, and the login sweep was already deleting their rows.

- b10dad2: narduk-auth: the session-grant validator plugin refuses to start
  while `runtimeConfig.nardukSessionGrantRequired` resolves to anything but
  `true` (#1040). The module sets the flag at build time, but
  `NUXT_NARDUK_SESSION_GRANT_REQUIRED=false` could override it at runtime
  without anything noticing. The validator is still attached to every request
  whatever the per-request config says, so an override that only reaches
  request-time config (possible on Cloudflare with older compatibility dates)
  still fails closed.
- ee59247: narduk-auth: `GET /api/_auth/session` (nuxt-auth-utils' own route) no
  longer returns the user of a revoked session (#1041). The route read the
  sealed cookie and never asked the session-grant validator, and clearing the
  session did not stop it, because h3 re-reads the request's cookie. The
  `auth-session-refresh` middleware now answers `{}` for a cookie whose grant is
  revoked, expired or unreadable.
- 97b3cec: narduk-core: new `requireAdminRouteScopes(admin, scopes)` lets an
  admin route opt into an API-key scope (#971, "scopes per route, opt-in"). A
  key that carries scopes must hold the ones the route names, or `*`. A key with
  no scopes keeps its full admin reach, and admin sessions are unchanged. The
  helper refuses a non-admin itself. A narrow key holding `auth:api-keys:write`
  can still mint an unscoped key (#1122). `GET /api/runtime/status` now names
  `runtime:status:read`, so an admin-owned key minted for another purpose (for
  example `['registry:read']`) is refused there with 403.
- 48048b9: `shared/utils/units` adds `formatLatitude`, `formatLongitude` and
  `formatCoordinate`: a position with hemisphere letters in decimal degrees,
  degrees and decimal minutes, or degrees-minutes-seconds, rounded once and
  carried so it never prints `60′`. `useFormatters()` binds it as
  `format.coordinate` (narduk-libs#995).
- 01090c4: Add `readWorkerIdentity(event)`, which reports the deployed source
  revision and the Worker version from the `version_metadata` binding (default
  `CF_VERSION_METADATA`), and let `/api/health` surface it through
  `runtimeConfig.nardukHealth.identity` (app-named response headers, and an
  optional `identity` body field) so apps stop overriding the route to add
  deploy identity (#1022).
- 6530d76: The shared `narduk/ignores` baseline now also ignores generated test
  output at the lint root (`coverage/`, `playwright-report/`, `test-results/`),
  so `narduk-lint` no longer lints `vitest --coverage` output and a second
  `quality` run no longer fails on unbudgeted warnings (#902).
- 2c5e67a: `import-x/no-cycle`, `import-x/named`, `import-x/default` and
  `import-x/export` now check local TypeScript code (#973). The pinned import-x
  resolver used to resolve `./b.ts` but not `./b` or `./b.js` from a `.ts` file,
  which is how TypeScript sources spell local imports, so these four rules never
  followed a local import. It now resolves TypeScript extensions and the `.js` →
  `.ts` alias, and `import-x/extensions` lets the export map parse the resolved
  `.ts` file.

  The four rules move from `error` to `warn`, so the bump turns no consumer red.
  New findings land in `lint-budget.json` and ratchet down from there, and
  making the rules `error` again is a follow-up. A strict budget needs
  `narduk-lint --accept-new-rules` once to record the new counts. `.vue` files
  are resolved but not parsed for exports. On narduk-core, lint heap and time
  are unchanged: about 2.1 GB peak RSS and about 25 s both before and after.

- 70c0170: Minimal-code pass (#1037), no behavior change in any route or policy.
  Two exports are removed: `isLinkLocalIPv6Hextet` (a Nitro server auto-import
  in apps) and `prependNitroErrorHandler` (importable from
  `@narduk-enterprises/narduk-core/server/error-sanitizer`); nothing in
  narduk-libs uses either. narduk-core drops `isLinkLocalIPv6Hextet`, moves the
  Nitro error-handler prepend into one module-side helper that orders the
  sanitizer and the JSON no-store handler in a single call (the runtime
  `prependNitroErrorHandler` copy, used only by tests, is gone), and marks the
  unused `getSessionGrantValidator` deprecated. narduk-auth keeps its
  per-request session and user row reads in one keyed cache.
- f65e0ba: Add `NeProse` (narduk-libs#1005): a markdown document rendered in the
  suite's type scale — h2/h3 headings (a `#` h1 is demoted to h2, since the page
  header owns the h1), paragraphs, nested ordered and unordered lists, fenced
  code with its language, aligned tables, blockquotes, rules, and inline code,
  bold, italic and links. Takes `source` (markdown) or a pre-parsed `blocks`
  AST.

  The markdown subset is parsed by a small, pure, dependency-free parser
  exported from the package root as `parseProse()`, with `proseOutline()` to
  build a table of contents: every heading gets a unique slug `id`. Rendering is
  element by element with no `v-html`, so raw HTML in the source is text, and a
  link keeps its `href` only for `http(s):`, `mailto:` or a scheme-less
  (relative, `#`, `?`) target; `javascript:` and every other scheme render the
  text alone. The AST and prop types (`NeProseProps`, `NeProseBlock`,
  `NeProseInline`, `NeProseHeading`, …) are exported for the design kit to
  mirror.

  The eslint-config and narduk-app-tools shared-component lists name `NeProse`
  so the drift and item-13 tests match `narduk-shell`'s registry. The libs
  explorer gains the `ne-prose` example its coverage check requires.
  `create-narduk-app` takes the patch because it pins `narduk-shell`.

- 9a99983: Add `NeSkipLink` and `NE_MAIN_ID` (narduk-libs#977). `NeSkipLink` is
  a plain `<a href="#main-content">`, never a RouterLink, that moves keyboard
  focus to its target when followed: it adds `tabindex="-1"` to a target with no
  tabindex, keeps one it already has, and leaves native fragment navigation
  alone. It is hidden until focused and styled from the NE tokens. `NE_MAIN_ID`
  (`'main-content'`) is its default target, auto-imported by the module for
  `<main :id="NE_MAIN_ID">` and exported from the package root. `NeAppShell`'s
  own skip link is now an `NeSkipLink`, so following it moves focus into the
  shell's `<main>`.

  The eslint-config and narduk-app-tools shared-component lists name
  `NeSkipLink`, so an app-local component of that name is reported as shadowing
  the shared one.

  The Libs Explorer gains an `NeSkipLink` usage page.

- 672f77a: narduk-auth, narduk-seo, narduk-analytics and narduk-ai now declare
  `@nuxt/ui` as a peer at exactly `4.11.1` (#1033). Each package renders Nuxt UI
  components and none declared it. This is the version narduk-core already
  depends on and narduk-shell already requires as a peer, so an app on
  narduk-core already installs it. An app on another `@nuxt/ui` version now gets
  pnpm's peer warning.
- 486d76a: Add `NeDataAttribution`, a consistent "Data from <source>, updated
  <time>" credit driven by a structural `NeDataSource` (name, http(s)-only href,
  licence, publish time) and formatted through `./format` with a required zone
  and a caller-supplied `now`, and `NeLegalPage`, a legal-page layout with a
  formatted "Last updated" date and a table of contents.
  `privacyPolicyTemplate()` and `termsOfServiceTemplate()` return section
  structure whose every body is a marked placeholder — no legal wording ships
  (narduk-libs#388, "Build, wording later"). A page stays a visible,
  `data-ne-legal-status="draft"` draft until the app sets `wordingApproved` and
  no placeholder remains; `hasLegalPlaceholders()` lets an app's own test guard
  the launch.

  `NeDataAttribution` and `NeLegalPage` join the eslint-config and
  narduk-app-tools shared-component lists and the libs-explorer inventory, and
  the legal-template helpers are auto-imported by the module.

## 0.14.5

### Patch Changes

- 60a0fa6: narduk-app-tools: add `narduk-app auth agent-key create`
  (narduk-libs#782). It creates a non-login user (no password, an undeliverable
  `.invalid` address) and an API key for it in one D1 batch, writing the `users`
  timestamps that hand SQL left out. The raw key goes only to the stdin of the
  secret-sink command after `--` (such as the guarded nvault setter), never to
  argv, stdout or a file, and D1 stores its SHA-256 hash. `--app-url` proves the
  key with `GET /api/auth/api-keys` (401 without it, 200 or a missing-scope 403
  with it). narduk-auth's README now says `GET /api/auth/me` is session-only and
  names the endpoint that proves a key.
- d65a7a8: `deleteCurrentUserAccount` / `deleteCurrentUserAccountBridge` now
  re-authenticate a Supabase caller against Supabase
  (`verifySupabaseAccountDeletionCredentials`) when the caller passes no
  `verifyCredentials` hook (narduk-libs#1051). An app that built its own delete
  route on the public helper used to fall through to the local password-hash
  check, which a Supabase-provisioned user (no local hash) skipped, so `{}`
  deleted the account. A principal without a session backend (an API key) takes
  the app's backend, so on a Supabase app it fails closed with 401, and the
  Supabase session it re-authenticates must belong to the account being deleted:
  a key beside someone else's session cookie also gets 401.
  `verifySupabaseAccountDeletionCredentials` takes an optional `{ userId }` for
  the same binding, and a `verifyCredentials` hook now receives `{ userId }` as
  its third argument, so passing that function as the hook keeps the binding.
  Supply `verifyCredentials` only to replace the check with your own.
- 0f2e149: narduk-auth: Sign in with Apple on the local D1 backend
  (narduk-libs#164, library side). New `GET /api/auth/apple/start` and
  `POST /api/callbacks/auth/apple` run Apple's web flow (`form_post`, state
  cookie, SHA-256 nonce) and verify the identity token natively against Apple's
  JWKS (`iss`, `aud`, `exp`, nonce), with no hosted auth and no client-secret
  JWT. `startOAuthFlow` and `signInWithNativeApple` no longer 501 on the local
  backend when `AUTH_APPLE_SERVICES_ID` / `AUTH_APPLE_NATIVE_CLIENT_IDS` are
  set, and `users.apple_id` is populated. `/api/auth/runtime-public` reports
  `appleEnabled`, which the login and register cards use instead of requiring
  the Supabase backend. An existing account links to an Apple ID only when the
  app has proven its email.
- e4c5dcb: narduk-core: the estate error page (`./app/error-page`) gains seams
  so apps wrap it instead of forking it (narduk-libs#976): `copy` (title and
  description per status, with a `default`), `links`, `homeLabel`, `homeTo`,
  `retryLabel`, `layout`, `ui` colour classes in place of hardcoded
  `text-primary`, an awaited `onBeforeClear(error, action)` hook whose failures
  never block recovery, and an `#actions` slot. The detail redaction outside
  `previewSafeMode`, `noindex, nofollow`, and the request id cannot be
  overridden. With no new prop set, the page renders as before. The export's
  type declaration covers every new prop.
- a29099c: `./format` adds `calendarDateIn` and `isSameCalendarDay`: the
  calendar date of an instant in a named zone as a sortable `YYYY-MM-DD` key,
  read from `Intl`'s parts rather than the `en-CA` formatted-string trick five
  apps hand-rolled. Both are also on `createFormatters()`'s bound set
  (narduk-libs#992).
- f5e3293: narduk-app-tools: `foundation:check:coverage` sub-check 9.8 flags a
  file that fetches `https://data.nard.uk` directly instead of through
  narduk-core's `createNardukDataClient` / `fetchNardukDataJson`
  (narduk-libs#373). It fails when narduk-core is a dependency and warns
  (`unknown`) otherwise. A file that names either shared entry point, or only
  links to the origin, is not reported.
- 8d88b3d: `<AppMapKit>` no longer throws a `TypeError` when `createPinElement`
  or `itemLabel` is set at mount and later becomes `undefined`. The pin layer's
  wrappers read the live prop with optional chaining, the same way `pinGeometry`
  and `itemKey` already did: a missing glyph renders an empty one, and a missing
  label writes the empty accessible name the pin layer defaults to (#1038).
- adcaf7a: `NeDataTable` can make a missing cell read as a word instead of a
  fixed em dash. `missingText` on the table sets it for every cell, and
  `missingText` on a `NeDataColumn` (a string, or a function of the row)
  overrides it for that column. The text is drawn visible and `text-dimmed`, so
  sighted and screen-reader users read the same word ("unreported", "unset",
  "not claimed"). With neither set, the table keeps the em dash with "No value"
  for a screen reader, as before (#1059).
- e49a414: Add
  `resolveBuildDeploymentTarget(env?, { productionBranch?, default? })` under
  `@narduk-enterprises/narduk-seo/shared/deploymentTarget`, returning
  `{ target, source }` from the explicit deploy-target variables, then the
  Workers Builds / Pages branch, then a default. The module now falls back to
  the branch when no `NARDUK_DEPLOY_TARGET` (or `NUXT_PUBLIC_` equivalent) is
  set, so a branch build is noindexed as `preview` and a `main` build counts as
  `production` for `hostAwareIndexing` without a `nuxt.config.ts` write-back. A
  build with neither variable keeps today's unset target (narduk-libs#999). Apps
  that deploy production from another branch set `nardukSeo.productionBranch`
  (default `main`).
- d092fec: Add
  `sitemapUrlsFromListing(items, { loc, lastmod?, changefreq?, priority? })`
  under `@narduk-enterprises/narduk-seo/shared/sitemapFromListing`: a pure
  helper that turns a listing of entities into `@nuxtjs/sitemap` URL rows. It
  keeps input order, skips items whose `loc` builder returns a blank value,
  dedupes by `loc` (first wins) and normalises `lastmod` to an ISO string. The
  README gains a "Programmatic SEO kit" section tying it to the structured-data
  composables and the OG image pipeline (narduk-libs#375).
- 6e7286c: narduk-core: `useShare`, native share with a clipboard fallback and a
  cancel-aware outcome (narduk-libs#994). New explicit export
  `@narduk-enterprises/narduk-core/app/share`: `share(content, { fallback })`
  answers `'shared' | 'copied' | 'cancelled' | 'failed'`. A dismissed sheet is
  `'cancelled'` and never overwrites the clipboard. Any other share failure
  falls back to the clipboard, and a clipboard refusal is reported.
  `copy(text)`, `copied` and a hydration-safe `canNativeShare` come with it;
  `createSharer` is the Vue-free half. Nothing is auto-imported.
- 9434163: narduk-core: `useStoredState`, a hydration-safe, validated,
  failure-tolerant Web Storage ref (narduk-libs#993). New explicit export
  `@narduk-enterprises/narduk-core/app/stored-state`:
  `useStoredState(key, options)` holds the default on the server and first
  paint, applies the stored value after mount, validates it, writes changes back
  and offers `.clear()`; `createStoredState` is the Nuxt-free half. Every
  storage access, including the `window.localStorage` property itself, is
  try/caught. `usePersistentTab` now resolves its storage through the same
  guarded accessor, so blocked storage no longer throws from its restore or its
  write watcher. Nothing is auto-imported.

## 0.14.4

### Patch Changes

- cbfcc73: Add `server/utils/chatCompletions`: `chatCompletion` /
  `chatCompletionJson`, a provider-neutral OpenAI-compatible chat client with
  `baseUrl`, `maxTokens`, JSON mode, a per-attempt timeout, a 5xx/network retry,
  usage in the result and sanitized H3 errors that never carry the raw provider
  body (#985). `grokChat` is unchanged.
- badb7d0: Add `narduk-app dev:seed`: loads `seed/{d1,kv,r2}/<BINDING>/`
  fixtures into Wrangler's local D1/KV/R2 with the Cloudflare credential
  variables removed from the child, so a checkout (or a cloud agent container)
  reaches a seeded local environment with no production credential. Generated D1
  apps get a starter `apps/web/seed/` fixture and a `dev:seed` script (#378).
- 36976a4: Add `narduk-app manifests validate` and `validateCloudflareManifest`:
  the wrangler ↔ `Config/cloudflare-app.json` parity check (bindings and crons
  as sorted sets, `deployment.accountId`, `workersDev`/`previewUrls`) that apps
  carried as their own drifted `validate-manifests.mjs` copies, parsed with
  `jsonc-parser` (#996).
- 918cbe1: narduk-auth: add `server/utils/request-principal` (narduk-libs#980).
  `resolveRequestPrincipal(event, options)` returns the caller, or `null` for an
  anonymous caller or a recovery-mode / MFA-step-up session that the
  restricted-session allowlists refuse for this request, so tenancy guards keep
  their own 401/404 choice without skipping the rules `requireAuth` applies. API
  keys (`allowApiKey`, with optional `requiredApiKeyScopes`) and native bearers
  (`allowNative`) are opt-in; `emailVerified` comes from narduk-auth's proof,
  not the raw session field. `resolveTenancyUserId` is a ready-made
  narduk-tenancy `resolveUserId`. `session-privilege` also exports
  `sessionPrivilegeRefusal`, the non-throwing form of
  `assertSessionPrivilegeAllowsRequest`. The narduk-tenancy README's guard
  example now uses `resolveTenancyUserId`.
- 830f3ed: Supabase account deletion (narduk-libs#1052, the rest of #923): a
  social-only account (no `email` provider) now needs a recent sign-in — its
  `auth_sessions` row created within `RECENT_SIGN_IN_WINDOW_SECONDS` (10
  minutes) — or the delete answers 403 `reauthentication_required`; it used to
  delete with no re-authentication at all. The upstream session created by the
  current-password check (deletion and password change) is signed out with
  `scope: 'local'` once the check passes. Invited or magic-link users with the
  `email` provider are held to the password on purpose, and the comment and
  README now say so.
- abb9b15: narduk-core: D1 bound-parameter chunking counts parameters, not
  values (narduk-libs#988). `chunkD1BoundValues`, `runD1Chunked` and
  `collectD1ChunkedRows` take `parametersPerValue` and `reservedParameters`,
  derive the chunk size from them, and throw at call time when an explicit
  `chunkSize` would overrun. New `chunkD1Rows(rows, table)` sizes multi-row
  `INSERT` chunks from the table's column count. With no new option set,
  behaviour is unchanged.
- 39046cb: Deprecate `LayerAppShell`, `LayerChromelessShell` and
  `LayerDashboardShell` in favour of narduk-shell's `NeAppShell` (components
  backlog item 18, narduk-libs#265). They will be removed in the next
  narduk-core major. Behaviour is unchanged: this adds `@deprecated` JSDoc and a
  README migration mapping only, with no runtime warning, since core's own
  `app.vue` and `dashboard` layout still render them.
- 3026594: `formatCompact` no longer throws a `RangeError` when
  `minimumFractionDigits` is above its default ceiling of one digit; the ceiling
  rises to meet it. `formatPercent` now honours `minimumFractionDigits` /
  `maximumFractionDigits` like the other number formatters instead of dropping
  them; its one-digit default applies only when none of `digits` or the pair is
  given (narduk-libs#937).
- 4276bf3: narduk-core: keyset cursors for cursor-mode list routes
  (narduk-libs#987). New explicit export
  `@narduk-enterprises/narduk-core/server/list-cursor`: `encodeListCursor`
  renders a versioned base64url cursor bound to the route's endpoint, sort and
  hashed `bind` values; `readListCursor` / `decodeListCursor` read it back and
  refuse any mismatch with one `400 cursor_invalid`; and `keysetAfter` is the
  tie-safe seek predicate (`(a > ?) OR (a = ? AND b > ?) ...`) that stops rows
  sharing a timestamp from being skipped across a page boundary. Nothing is
  auto-imported.
- d0a4ba0: `useLocalBusinessSchema` now emits its `openingHours` strings (the
  schema.org text form, `'Mo-Fr 09:00-17:00'`) under `openingHours`. They used
  to land under `openingHoursSpecification`, whose range is structured
  `OpeningHoursSpecification` objects, so every page that passed opening hours
  shipped invalid LocalBusiness JSON-LD (narduk-libs#944). The option type is
  now exported as `LocalBusinessOptions`.
- b5932aa: `declutter()` (`./marks`) now sizes its merge grid from the largest
  item radius, so overlapping discs with a radius above 24 px merge wherever
  they sit on screen instead of depending on grid position (#933).
- 8a551eb: Add the marketing sections (components backlog item 21,
  narduk-libs#268): `NeHero`, `NeFeatureGrid`, `NeCta` and `NeMarketingFooter`,
  thin themed wrappers over Nuxt UI's `UPageHero`, `UPageGrid` + `UPageFeature`,
  `UPageCTA` and `UFooter`. Each takes its primitive's own props and slots
  unchanged and adds only the suite's token classes through the primitive's `ui`
  prop (the headline and feature icons read `--ne-accent`, the CTA panel
  `--ne-radius-panel`, the footer a `--ne-hairline` rule); a caller's `ui`
  merges after them and wins a conflict. Their prop types are exported from the
  package root.

  The eslint-config and narduk-app-tools shared-component lists name the four so
  the drift and item-13 tests match `narduk-shell`'s registry. Explorer
  inventory, catalog and usage ship beside the components.

  `create-narduk-app` takes the patch because it pins `narduk-shell` in
  generated apps; its `PACKAGE_VERSIONS` literal is not hand-edited
  (`versions:sync` re-pins it at `release:version`). The generator's
  landing-page scaffold is not part of this change.

- 39046cb: Name `NeAppShell` as a narduk-shell shared component, so the
  no-local-copy lint rule and foundation item 13 recognise an app-local copy of
  it, and the drift and item-13 tests match narduk-shell's registry
  (narduk-libs#265). The libs explorer gains the `ne-app-shell` example its
  coverage check requires.
- 39046cb: Add `NeAppShell` (components backlog item 18, narduk-libs#265): the
  opt-in application frame — a rail of labelled, always-expanded sections whose
  active item comes from the router, with ArrowUp/ArrowDown/Home/End focus
  movement, a drawer only below Nuxt UI's `lg` breakpoint, `rail-top` /
  `rail-bottom` / `navbar` / `navbar-right` slots, and one `<main>` with a skip
  link. Built on `UDashboardGroup`, `UDashboardSidebar`, `UDashboardNavbar` and
  `UNavigationMenu`. Nothing is registered as a layout and nothing is
  scaffolded.

  New module options `accent`, `structure` and `sections` pass through
  `app.config.nardukShell` as a default the app's own `app.config.ts` beats.
  `accent` / `structure` set `--ne-accent` / `--ne-structure` app-wide,
  teleported overlays included, through one head `<style>`; with neither set
  nothing is written. `useNardukShellSections()` is auto-imported (also with
  `components: false`): shared, SSR-safe rail state seeded from `sections`.

- 9f8e206: `mapOverviewCamera` (`./marks`) frames a point set that straddles the
  antimeridian on its own data. It used a plain min/max of longitudes, so any
  crossing set spanned 360 degrees minus its short arc and always fell back to
  `NORTH_AMERICA_OVERVIEW`. Longitudes are now unwrapped around their largest
  gap before the outlier trim (the rule `computeLongitudeSpan` uses); `span.lng`
  is the short arc and `center.lng` is normalised to -180..180. A set whose
  largest gap already sits across +/-180 is framed exactly as before
  (narduk-libs#932).
- a703b1b: Passkey routes now answer 503 "Passkeys unavailable: server
  misconfiguration" and log the cause when `@simplewebauthn/server` fails to
  load, instead of an opaque 500 (narduk-libs#892). The library, including its
  `helpers` entry, is now imported lazily on the first ceremony rather than at
  module load, so a load failure such as #786's missing Reflect polyfill rejects
  where it can be answered. The error and its `cause` chain are logged under
  `AppAuth`; the cause never reaches the response. `readPresentedChallenge`
  decodes base64url with the platform `atob`, so the pure ceremony checks no
  longer import the library at all. Successful ceremonies behave as before.
- 1ad30f8: `hitTestPolygonOverlays` no longer reports a hit for a point inside a
  polygon's hole. A drawable's `rings` are `[outer, ...holes]` and the overlay
  layer draws the holes empty, so containment is now even-odd across rings; a
  tap on the empty water of a lake no longer selects the surrounding polygon,
  and falls through to a polygon drawn inside the hole (narduk-libs#931).
- 591f07c: Account deletion now re-authenticates Supabase email+password users
  against Supabase. `POST /api/auth/account/delete` only checked the local
  `users.password_hash`, which Supabase-provisioned users never have, so on the
  Supabase backend a request with `{}` deleted the local user and the upstream
  identity with no password. A linked user with a stale local hash had the
  opposite problem: deletion demanded the old local password. On a Supabase
  session the route now verifies `currentPassword` with `signInWithPassword`,
  the same check password change uses, and never consults the local hash
  (narduk-libs#923).

  `deleteCurrentUserAccountBridge` (and its `deleteCurrentUserAccount` alias)
  accepts a new optional `verifyCredentials` hook that replaces the local hash
  check; the new `verifySupabaseAccountDeletionCredentials` export is the
  Supabase one. Provider-only accounts and the local backend behave as before.

- 9e0f2f2: Supabase logout now revokes only the current session upstream.
  `POST /api/auth/logout` called `signOut()` with no options, and
  `@supabase/auth-js` defaults that to `{ scope: 'global' }`, which revoked
  every session the user held at the authority: their other devices, and every
  other app on the same Supabase project, were signed out within one
  revalidation window. It now calls `signOut({ scope: 'local' })`
  (narduk-libs#921). The local backend is unchanged.
- 1e4b5fe: Add `narduk-testkit e2e check|setup|run` (narduk-libs#997), the
  shared replacement for the `scripts/setup-playwright-browsers.mjs` and
  `scripts/run-web-e2e.mjs` copies in 13 apps. `check` launches Chromium
  headless (an existing executable is not proof it starts) and quotes the launch
  error; `setup` runs the app's `playwright install chromium` into the ambient
  `PLAYWRIGHT_BROWSERS_PATH` or Playwright's shared machine cache, never a
  per-checkout one; `run` checks, then runs `playwright test` with the default
  config, `--project=web` only when the caller chose no project (Playwright
  accumulates repeated `--project` flags), and `--import tsx` once when the app
  has tsx. `playwright/config` also exports `resolveBrowserCachePath(env)` and
  `withDefaultProject(args, project)` for apps that keep a custom runner.
- 471374e: Add `server/kit/vitest` with `nuxtVitestAliases({ appRoot })` and
  `server/kit/nitro-runtime-stub` (narduk-libs#998). The helper builds Vite
  `resolve.alias` entries for Nuxt's `#` and `~` aliases from the table Nuxt
  writes (`.nuxt/tsconfig.json`), so `#layer`, `#narduk-core/schema` and
  `#narduk-core/postgres-runtime` follow narduk-core's `module.ts` (including
  the postgres backend) instead of hand-copied paths. It never aliases a bare
  package name, keeps exact and prefix keys distinct, and throws naming
  `nuxt prepare` when the table is missing. `nitropack/runtime` (anchored) and
  `#imports` point at one stub with `useRuntimeConfig`, `setTestRuntimeConfig`,
  `resetTestRuntimeConfig` and a throwing `useEvent`.
- 5d93591: Add `@narduk-enterprises/narduk-testkit/e2e/readiness`:
  `registerReadinessSetup` is the body of the preset's `setup` project (base URL
  → `/api/health` status `ok|degraded` plus optional app assertions → warm each
  listed route once), so apps stop repeating per-spec `beforeAll` readiness
  guards (#1000).
- b3c821f: New `@narduk-enterprises/narduk-core/server/wait-until`, the
  background-work helper five apps hand-rolled (#991). `resolveWaitUntil(event)`
  returns the runtime's `waitUntil` bound to its owner, looking at
  `event.waitUntil`, then the Cloudflare `ExecutionContext`, then
  `event.context.waitUntil`, and walks a Nitro internal fetch to its SSR parent
  event. `runInBackground(event, task, { onError, fallback })` hands the task to
  it with its rejection observed, and detaches or awaits it when no `waitUntil`
  exists; it never rejects. `withD1Cache` now uses the same resolver for its
  stale refresh, so the refresh also survives an internal fetch.

## 0.14.3

### Patch Changes

- 47f7131: A key minted by another API key can no longer outlive it
  (narduk-libs#920). `POST /api/auth/api-keys` from an API-key caller clamps a
  child with no `expiresInDays` to the calling key's expiry, and refuses with
  403 an explicit expiry past it, or `null` under a key that expires. A `*` key
  can no longer renew itself for another 90 days before it expires. Session
  callers are unchanged. narduk-core's `AuthUser` gains an optional
  `apiKey: { id, expiresAt }` naming the key behind an `api-key` principal.
- f17ce87: Each `createAppDatabase()` accessor now memoizes its own per-request
  Drizzle instance. They used to share one `event.context._appDb` slot, so
  whichever accessor ran first on a request fixed the schema for every later
  one. On signed-in requests that was narduk-auth's `useAuthBridgeDatabase`,
  from its session middleware, so the app's `useAppDatabase(event)` got auth's
  schema and its relational queries could not see the app's tables (#919).
  `event.context._appDb` is no longer written; the type stays, marked
  deprecated.
- b462046: `GET /api/admin/users` and its `/api/users` alias now accept an
  admin-owned API key only when it carries the new `auth:admin:users:read` scope
  (or `*`). `PUT /api/admin/users/role` is now session-only, so no API key can
  grant or revoke admin, whatever its scopes. Admin sessions are unchanged.
- 591863c: Closed signup can no longer be bypassed by exchanging a self-signup
  confirmation token as `type=invite`. An exchange now counts as an invite only
  when the verified Supabase user has `invited_at` set, which GoTrue records
  only when an operator invites someone. A client-chosen `type` or a stored PKCE
  `redirectType` is no longer enough.
- b565b01: narduk-charts: `niceScale` no longer loops forever when a domain
  spans only a few ULPs (#927). It widens such a range the same way as
  `min === max`, and it builds ticks by index.

  narduk-charts: domain and histogram math no longer spreads every value into
  `Math.min`/`Math.max`, which threw a RangeError past ~100k values (#929).
  Internal `arrayMin`/`arrayMax` loop helpers replace those calls.

  narduk-charts: `useChart` starts observing its container again when `width`
  goes from set to unset (#934), so a chart that was pinned to a fixed width no
  longer sticks at 600px.

  narduk-charts: `NardukBarChart` bars grow from zero instead of the domain
  floor (#928), so negative values hang below (or left of) the zero line.
  Stacked bars keep separate positive and negative totals, and the stacked
  domain covers both.

- 4b85a74: `composable-primary-export` and `require-use-prefix-for-composables`
  now check aliased named exports (`export { helper as useCartHelper }`). Both
  rules looked the export up by its alias instead of the local declaration it
  names, so every renamed export was skipped.
- 02b999f: New `@narduk-enterprises/narduk-core/server/utils/shared-secret`:
  `requireSharedSecret(event, { secretKey, fallback?, header?, unsetStatus?, rejectStatus?, rejectMessage? })`
  checks any static inbound secret in constant time, `hasSharedSecret` is its
  non-throwing twin for "session OR token" guards, and `timingSafeEqualText` is
  exported (narduk-libs#979). `requireCronAuth` is now a wrapper over it and
  behaves as before.
- 6a12081: `requireCronAuth` now compares the bearer token with `CRON_SECRET` in
  constant time instead of with `!==`, which exits at the first differing
  character (narduk-libs#871).
- 5ed9665: `withD1Cache` now hands its stale-window background refresh to the
  request's `waitUntil`, trying `event.waitUntil`, then the Cloudflare
  `ExecutionContext`, then `event.context.waitUntil`. Before, a Worker could
  cancel the refresh once the response was sent, so the row stayed stale and
  every request in the window started another refresh that could also be
  dropped. `_meta.cachedAt` now reports when the served value was written
  (`expires_at` minus `ttlSeconds`) instead of the time of the current request.
- 804410d: `narduk-app doctor --audit` is the doctor's dependency-audit leg
  (#376). One `pnpm audit --json` call, cached per `pnpm-lock.yaml` hash for up
  to 12 hours, gives one verdict line. It FAILs only on a high or critical
  advisory that the app has not accepted in `narduk-app.json`
  `security.acceptedAdvisories` (`{ "id", "reason", "expiresOn"? }`), and it
  prints the line to paste, saying first when a patched version makes the bump
  the fix. Low and moderate advisories never count. An unreachable registry or a
  missing lockfile is UNKNOWN and exits 0, an expired `expiresOn` is a WARN, and
  a declaration that no longer matches is a "remove this entry" note. Bare
  `doctor` is unchanged. `create-narduk-app` scaffolds `narduk-app.json` with an
  empty list and adds a how-to section to the app README.
- 8b0e555: Registry auth no longer routes the retired `@narduk-geo` scope
  (#140). Its last consumer, farm-analytics, is retired.
  `patchPackageRegistryNpmrcContent` (narduk-platform) and `renderRegistryAuth`
  / `narduk-app registry-auth` (narduk-app-tools) now write only the
  `@narduk-enterprises` route. They drop a stale `@narduk-geo:registry=` line
  the same way they already drop `@loganrenz:registry=`. The exported constants
  `MAPKIT_PACKAGE_REGISTRY_SCOPE` (narduk-platform) and `NARDUK_GEO_SCOPE`
  (narduk-app-tools) are removed. A GitHub code search across narduk-enterprises
  and loganrenz found no importer outside narduk-libs.
- 6f2f1ee: `foundation:check` no longer holds an app without Nuxt to the Nuxt
  modules (#157). An app with no `nuxt.config.*` at a known path and no `nuxt`
  dependency gets sub-check 2.1 on `narduk-testkit`, `narduk-app-tools` and
  `eslint-config` only, and 2.1c (`narduk-core`), 2.3 (when `narduk-core` is not
  a dependency) and 3.1/3.2/3.3 report `not-applicable`, with "not a Nuxt app"
  and the reason in the detail. They never report `pass`. The eslint-config
  README names `composeSharedConfigs()` as the supported ESLint route for an app
  without Nuxt.
- 5de0ec4: The shared `narduk/imports` block sets
  `import-x/ignore: ['node_modules']`, so `import-x/no-cycle`, `named`,
  `default` and `export` no longer parse installed packages' sources and type
  trees. In narduk-core that walk held about 3.4 GB of heap: peak RSS falls from
  5.2 GB to 1.8 GB, lint time from about 85 s to 28 s, and the messages are
  identical. A cycle cannot run through an installed package, and TypeScript
  already checks named and default imports from one (#789). narduk-core's `lint`
  script drops its 4096 MB heap stopgap and runs under the repo's 3072 MB
  default again.
- 4b85a74: `no-locale-date-format-in-ssr-text` now matches `no-render-clock` on
  what counts as render code. It no longer reports locale date formatting inside
  a `v-on` / `@event` handler, which only runs after a user event. It now
  reports formatting inside a synchronous array callback
  (`items.map((i) => i.at.toLocaleDateString())`) or an IIFE at the top of
  `<script setup>` or inside `computed()`, which runs during server render.
- 4b85a74: `narduk/no-raw-define-event-handler-in-mutation-routes` stops its
  "composed inside an approved wrapper" exemption at a function boundary
  (narduk-libs#886). `defineUserMutation(defineEventHandler(…))` is still the
  wrapper's own composition, but a raw `defineEventHandler` declared inside the
  wrapped route's callback is a new, unwrapped handler and is now reported.
  `create-narduk-app` is a companion patch because it pins eslint-config.
- 9ff6496: The admin PostHog pages, devices, entry-exit, referrers and insights
  routes now scope the shared project to this app by host: the `$current_url`
  host must equal the configured domain's host or be a subdomain of it, the same
  test recordings uses. A `$current_url` substring match used to count any app
  whose host contains this one, and any URL carrying the domain in its path or
  query. With no domain configured these routes now return no data, as
  recordings does, instead of dropping the filter and returning every app's
  traffic (#924). `buildPosthogCurrentUrlClause` returns `AND false` for a blank
  domain, and the new `buildPosthogCurrentUrlHostMatch` gives the bare HogQL
  expression.
- 4b85a74: The Cloudflare Workers module-scope analyzer treats a
  `new Promise(executor)` executor as running during module evaluation, which it
  does: the executor runs synchronously during construction (narduk-libs#887).
  The four rules built on it (`no-worker-global-scope-operations`,
  `no-worker-global-scope-db-clients`, `no-supabase-client-in-global-scope`, and
  the rest) now report a `fetch`, `new Pool` or `createClient` inside a
  module-scope `new Promise((resolve) => …)`, whether the executor is inline or
  a named function. Work the executor defers (`setTimeout`, `.then`) stays
  unreported. `create-narduk-app` is a companion patch because it pins
  eslint-config.
- ffae997: The runtime-env readers now accept wrangler `vars` that are JSON
  booleans or numbers. Workers expose those on `env` as JS values, not strings,
  and the readers used to treat them as empty.

  - `"NUXT_PUBLIC_ALLOW_GEOLOCATION": true` now reads as `true`. It used to read
    as `false` and skip the runtime-config fallback.
  - A number now reads as its string form.
  - An object or array var, or a value `readRuntimeBoolean` cannot recognise,
    now falls through to the runtime-config fallback instead of returning
    `defaultValue` or an empty string.

- f63937e: New `@narduk-enterprises/narduk-core/server/scheduled-jobs`, the
  Cloudflare cron dispatcher that seven apps hand-rolled (#990).
  `defineScheduledJobs()` is one Nitro `cloudflare:scheduled` plugin,
  `runScheduledJobs()` serves a plain Worker's `scheduled`, and
  `declaredCrons()` / `cronParity()` check the jobs against wrangler
  `triggers.crons`. A job runs only on a cron it declares, and each job runs
  behind its own error boundary under `Promise.allSettled`. One failing job
  therefore no longer skips the others, as Nitro's serial hooks did when
  operator-portal's export stopped its retention prune. An optional D1 lease
  (compare-and-swap upsert, released by lease id; `SCHEDULED_JOB_LEASES_SQL`)
  keeps a cron run and a manual trigger from overlapping.
- fcc7c01: The narduk-shell module now registers `src/runtime` with Tailwind
  through Nuxt UI's `ui.css` `@source` lines. When an app turns
  `ui.experimental.componentDetection` on, it also adds the `U*` components the
  suite renders (narduk-libs#978). narduk-shell is a module, not a layer, so
  before this a utility that only a `Ne*` component used was never generated in
  a consuming app, and with detection on the suite's `U*` components lost their
  themes. This is the same fix narduk-auth got in #700.
- 0ab6fb1: `broadcastSSE` now removes a connection whose write rejects, which is
  how a closed or errored stream reports a client that went away. It used to
  catch only a synchronous throw, so a dead connection stayed on its channel and
  every later broadcast raised another unhandled rejection.
- 0a28489: `createFakeR2Bucket().put()` no longer ignores what a real bucket
  enforces (#916). It honours the `R2Conditional` form of `onlyIf`: it resolves
  `null` and writes nothing when the condition fails, so create-if-absent via
  `etagDoesNotMatch: '*'` works. It throws on the `onlyIf` forms it does not
  emulate (a `Headers` object, a weak `W/` etag). It rejects an `md5`/`sha*`
  checksum that does not match the body, and parses a `Headers` passed as
  `httpMetadata`. `writeHttpMetadata()` writes all six stored fields, not only
  content-type and cache-control.

  The `narduk-testkit/d1` harness records statements when they execute, not when
  they are prepared (#922). A per-item loop over one reused prepared statement,
  which is the shape of every drizzle `.prepare()`d query, now counts once per
  item, so `expectStatementBudget` and `scaleMatrix` catch that N+1. Each
  `batch()` member counts as one statement, and a statement prepared but never
  run no longer counts.

- 5187a1e: The generated `apps/web/scripts/validate-manifests.mjs` strips
  `wrangler.jsonc` comments and trailing commas with a string-aware scanner
  instead of a regex, so a `"*/15 * * * *"` cron no longer pairs with the
  `"**/*.mjs"` glob to crash `manifests:validate`. It also sorts the wrangler
  crons before comparing them with the manifest's (#914). The file is a seed: an
  existing app picks up the fix by copying the new script from a fresh scaffold.

## 0.14.2

### Patch Changes

- 2d7da38: `upgrade` now appends the `narduk:router` block to an existing
  `AGENTS.md` that has no markers, instead of reporting it unmanaged. The rest
  of the file is untouched, and a `<!-- narduk:unmanaged -->` header still opts
  out. The block also names the app's shared `@narduk-enterprises/*` packages
  and points at `narduk-app doctor` and `create-narduk-app upgrade`. A file with
  only one marker of the pair is reported `unresolved` and left alone
  (narduk-libs#377).
- 8212ffd: `POST /api/auth/api-keys` now refuses, with 403, to let an API-key
  caller mint a scope it does not hold itself. A key holding only
  `auth:api-keys:write` can no longer mint a wildcard (`*`) key; `*` is mintable
  only by a key that holds `*`. Session-authenticated users are unaffected
  (narduk-libs#858).
- 3b03a43: Make development mode survive a GitHub repository rename. The client
  resolves the origin-named repository once through `GET repos/{owner}/{name}`,
  which follows a rename, to its canonical name and numeric id.
  `development exit` now accepts a validation run whose repository and head
  repository carry that id, where it used to reject every run of a renamed
  repository by comparing full names. Workflow holds, restores and run
  cancellations address the canonical name, so no write goes through a redirect.
  Activation records, receipts and validation history keep the key they were
  created under.

  `create-narduk-app` takes the patch because it pins `narduk-app-tools` in
  generated apps.

- b55dea5: The development-mode migration classifier treats the name an
  `ALTER TABLE ... RENAME TO` moves a table to as the file's own, so the rebuild
  that renames the original table out of the way and later drops it no longer
  reports a spurious `drop-table` (#876). `deploy-local` now refuses a blank,
  non-https or local `SITE_URL` before it builds, migrates or deploys, rather
  than after production has moved (#877); `--no-probe` still skips the check.
- 61462de: The canonical-host redirect now always stays on the canonical origin.
  Before this, a raw request path such as `/.//evil.com` normalised to
  `//evil.com`, and the middleware resolved that as a scheme-relative URL,
  answering with a 308 to `https://evil.com/` (narduk-libs#444, CANON-1).
- f43caf2: Fix two narduk-charts rendering bugs. `macd()` no longer returns
  signal values before the MACD line exists; the signal now starts
  `signalPeriod` samples after the line's first real value (#867).
  `NardukBarChart` with `stacked` or `stackedPercent` on a `log` or `symlog`
  axis now ends each stack where the axis places its total, so equal totals line
  up regardless of how they split across series (#873). Linear stacks are
  unchanged.
- 71a1f22: Dependabot `safe`-lane merges now reach production.
  `dependabot-merge.yml` starts main CI with `GITHUB_TOKEN`, and a run started
  that way fires no `workflow_run`, so Promote never saw it (narduk-libs#787).
  The generated `ci.yml` gains a `promote-dispatch` job for exactly that case: a
  bot-dispatched run on `main`. After every CI job has passed, and only while
  the commit is still main's head, it dispatches `promote.yml` with
  `verified-sha`. The job waits on nothing. `docs/workers-builds.md` now shows
  the `workflow_dispatch` input and a `gate` job for the app-owned
  `promote.yml`. Whatever started the run, the gate promotes main's head once
  the latest `ci / Required` on that commit has passed, so a queued Promote
  replaced in the concurrency group loses nothing. An app that hasn't adopted
  this gets a notice instead of a failure; any other API error fails the job.
  `ci.yml` is pin-managed, so existing apps copy the job by hand.
- bfdb770: `deploy-local` now names `GH_PACKAGES_READ`'s registered route
  (nvault `github/prd/narduk-enterprises-packages-read`) when that key is
  missing, rather than sending the operator to the app's config, which holds no
  copy of it. The README shows the combined `nvault run` invocation (#333).
- 786568d: HEAD-as-GET now carries the caller's socket address to the inner GET
  as Nitro `_platform.clientAddress` context, not as a synthesised
  `cf-connecting-ip` header. A route that trusts `x-forwarded-for` now resolves
  a HEAD to the same client as its GET, where before every client behind a proxy
  shared the proxy's bucket for HEAD. The default configuration keeps its
  per-socket identity, and no client-settable input gains precedence
  (narduk-libs#683).
- 776c0a1: The legacy enforcing CSP no longer allows
  `https://pagead2.googlesyndication.com` in `script-src` for every app. An app
  that serves AdSense adds the origin itself with
  `runtimeConfig.public.cspScriptSrc` / `CSP_SCRIPT_SRC`, plus the frame and
  connect origins its ads need (narduk-libs#459).
- 31c907d: Redact plural secret keys (`tokens`, `secrets`, `passwords`,
  `accessTokens`, `dbPasswords`, …) in the TypeScript, Python, Go and Swift
  sanitizers. LLM usage counts such as `inputTokens` and `total_tokens` stay
  visible (narduk-libs#872).
- e473c74: `createMapKitFixedWindowRateLimit` no longer keeps a window for every
  client it has ever seen. Expired windows are dropped as time passes, and a new
  `maxKeys` option (default 10,000) caps the live windows; past the cap the
  oldest is dropped and that client starts a fresh window. The per-client
  `cf-connecting-ip` keying in the docs is now bounded under traffic from many
  addresses.
- e473c74: `<AppMapKit>` zoom-to-fit frames points either side of the
  antimeridian the short way round. `mapKitBoundingRegion` now measures
  longitude with the same largest-gap span as `computeCoordinateBounds`, so
  points at 179.5 and -179.5 frame a 1-degree strip centred on 180 instead of a
  359-degree arc centred on 0.
- f2869f8: `NeDetailView` decides "unavailable" from the value, not by comparing
  the rendered text with the placeholder (narduk-libs#875). A reported `'N/A'`,
  or a reported `'—'` against the default placeholder, now renders as a reported
  value instead of being muted and stamped `data-ne-detail-unavailable`. A
  present value that its `format` cannot render (a quantity with no unit, money
  with no currency, a date with no zone, a non-number under a numeric format) is
  still unavailable. `create-narduk-app` is a companion patch because it pins
  narduk-shell.
- dc6be99: The default social image plugin no longer throws from its `useHead`
  getter (narduk-libs#874). An app with `defaultOgImage` and no usable site URL
  (unset, unparsable, or plain HTTP on a public host) used to fail SSR on every
  page. It now renders the page without the default `og:*` tags and logs one
  `[narduk-seo] Default social metadata skipped: …` warning per process.
  `defaultSocialMeta()` itself still rejects unsafe input, now with a clear
  message when the site URL is missing.
- 57cf7b8: `GET /api/auth/session/exchange` now enforces the `authLogin` rate
  limit, like its POST twin. Before this, the GET route ran the Supabase code
  and `token_hash` exchange without any throttle (narduk-libs#879).
- e1146b4: `upgrade`'s dry-run diff renders a created managed file as additions
  only (`@@ -0,0 +1,N @@`) and an emptied one as removals only, instead of
  showing a phantom blank line on the empty side.
- cc50347: `narduk-app development validate` works from a contributor host while
  the repository is enrolled from another workstation (narduk-libs#827). Without
  a local activation record it checks GitHub: when the held workflows are
  disabled, it requests validation, so a PR can get its `ci / Required` result.
  When none is held, it refuses and names them, instead of claiming that normal
  delivery validates pushes. `development status --remote` on such a host also
  lists the held workflows.

## 0.14.1

### Patch Changes

- 89249cf: Development mode now proves and reports Worker script triggers
  (narduk-libs#756). After `wrangler triggers deploy`, `deploy:dev` reads the
  live cron schedules back and ends `unproven` instead of `verified` when the
  declared crons are not in force. `development status --remote` shows
  declared-vs-live crons and routes (zone routes plus custom domains) for each
  component, and `development enter` reports the same mismatch at entry. A live
  read that fails is reported as `unknown`, never as in sync.

## 0.14.0

### Minor Changes

- b59c4a8: Scaffold new apps on TypeScript 6.0 (`6.0.3`), inside the
  D-TOOLCHAIN-1 `~6.0.3` baseline (narduk-libs#307).

  The generated root `package.json` now pins exact `typescript: 6.0.3` (inside
  the baseline `~6.0.3` range; the generator pins every dependency exactly)
  instead of `5.9.3`. The rest of D-TOOLCHAIN-1 (Node 24 through
  `.node-version`, `engines.node`, the current shared-workflow pin and the
  `github-actions` Dependabot block) had already landed, so this was the last
  stale point. The workspace moves in the same change: every narduk-libs package
  now builds and typechecks with TypeScript `~6.0.3`, so a scaffolded app and
  the packages it consumes are compiled with the same major.

### Patch Changes

- 8f4a177: Scope admin PostHog session recordings to `POSTHOG_DOMAIN` so a
  shared project cannot list another app's replays, and include the domain in
  the recordings cache key.
- 70168be: Standard-mode analytics now strips fragments, sensitive query keys
  and page text without enabling strict privacy; IndexNow submit keeps URLs on
  the site host; the env catalog treats INDEXNOW_KEY as unique per app.
- 1dc62db: Add `narduk-app db create` and fail `foundation:check` on the
  placeholder D1 id (narduk-libs#662).

  `foundation:check` sub-check 1.5 fails any `d1_databases[].database_id` (top
  level or any `env.<name>`) that is still the scaffold placeholder
  `00000000-0000-0000-0000-000000000000`, naming `narduk-app db create` and the
  raw `wrangler d1 create <name>` step. The placeholder builds, dry-runs and
  tests clean, so this is the first gate that notices the database does not
  exist. A fresh `create-narduk-app` scaffold with a database now fails 1.5, and
  only 1.5, until it is provisioned; a `--no-database` scaffold is unaffected.

  `narduk-app db create [--checkout <dir>] [--binding <NAME>] [--dry-run] [--json]`
  creates the one database a placeholder binding stands for: it refuses when the
  id is already real, takes the name from `Config/cloudflare-app.json` (never an
  argument), requires an explicit account (`account_id` or
  `CLOUDFLARE_ACCOUNT_ID`), writes the returned id into the wrangler config the
  manifest names with comments and formatting intact, prints the id and account,
  and never deletes.

  The generated `apps/web/wrangler.jsonc`, `README.md` and
  `docs/workers-builds.md` now say how to create the database.

- 1dc62db: `narduk-app e2e-serve` now drops service bindings to Workers outside
  the E2E run instead of letting workerd refuse to start
  (`binding "ENGINE" refers to a service "…", but no such service is defined`),
  and names each one on stderr. A binding back to the Worker itself is kept,
  nothing is written into the app tree, and `--keep-service-bindings` passes the
  config through untouched for an app that runs the target Worker alongside.
  Dropping needs the app's wrangler at 4.99.0 or later (narduk-libs#788).
- 1dc62db: `narduk-app deploy versions-promote` accepts
  `--gate-verified "<check>@<sha>"`, the promote workflow's attestation that the
  gate check passed on a commit (narduk-libs#400, option 2). The value splits on
  its last `@` and needs the full 40-character SHA. The promote refuses with
  `gate-mismatch` (exit 9), before touching anything, when the attested SHA is
  not the commit being promoted or the resolved version's `workers/tag` is not
  that commit. It logs the attested check and SHA and reports them as
  `gateVerified`. The flag is optional: without it the promote runs as before
  and warns that no gate attestation was passed. The generated
  `docs/workers-builds.md` promote excerpt and the `promote-d1.steps.yml` dry
  run now pass `--gate-verified "ci / Required@$VERIFIED_SHA"`.
- 1dc62db: `verify --live` diagnoses a stale local NXDOMAIN (narduk-libs#783).
  When the system lookup fails with `ENOTFOUND` / `EAI_AGAIN` but 1.1.1.1 /
  8.8.8.8 resolve the host, the report adds a distinct `dns` UNKNOWN assertion
  ("local resolver has a stale negative answer") with the public addresses and
  the remedies, instead of reading like a dead deployment; the exit code
  stays 2. The new `--resolver public` probes through the public resolvers'
  answer while keeping the hostname for TLS SNI and `Host`. Live probe responses
  also carry the transport's `errorCode`.
- c6653d8: Resolve the active Worker version from provider deployment allocation
  instead of versions-inventory list position, page the deployments list the
  same way as versions when `result_info` is present, and add bounded
  preview-alias identity convergence with aggregated post-convergence
  diagnostics (narduk-libs#47).
- 429fd81: Refuse a never-expiring wildcard API key and cap its lifetime at 90
  days (narduk-libs#168). `create-narduk-app` is a companion patch so the
  generator pin moves with auth.
- 0c5bf3d: Load a Reflect metadata polyfill on the Workers path so narduk-auth
  passkey routes no longer 500 when tsyringe evaluates without
  `Reflect.getMetadata` (narduk-libs#786). `create-narduk-app` is a companion
  patch so the generator pin moves with auth.
- 8226f05: Address narduk-charts lint findings deferred at eslint-config
  adoption (#131). `create-narduk-app` releases alongside because it pins
  narduk-charts.
- 7484b7d: Carry the options the retired standalone narduk-charts repository
  published as 2.6.0 on 2026-09-23: line-series `spanGaps`, `mode: 'points'`,
  `marker` (`radius`, `filled: false` rings), `opacity` and `showValues` /
  `formatValue`; point annotations' `ring`; `xTickIndices` with thinning on
  narrow charts; and bar `yMin` / `yMax`, `showXAxis`, `showYAxis`, `showGrid`,
  `showLegend` and `padding`. narduk-libs continues from 2.6.0, the registry's
  `latest`, so this release is the first to ship those options together with
  narduk-libs' 2.5.x fixes and the `./spark` export. The package docs now name
  narduk-libs as the only source and release path. `create-narduk-app` releases
  alongside because it pins narduk-charts.
- 1df13cb: Add `@narduk-enterprises/narduk-charts/spark`: axis choice, SVG path
  generation (optional timestamp X via `times`), and 24h/7d/30d trailing-window
  helpers for micro-sparklines. The Vue line-chart sparkline recipe is
  unchanged. `create-narduk-app` releases alongside because it pins
  narduk-charts.
- 7766d90: `composeSharedConfigs()` and `createAppLintConfig()` accept
  `communityLayer: false` so a caller can take a capability pack without the
  shared community plugin tail (`import-x`, `unicorn`, `promise`, `security`,
  `regexp`, `eslint-comments`, `vitest`, Vue house style). Baseline ignores,
  typescript-eslint project rules, and console hygiene stay on. Today's default
  stays on for every existing caller (narduk-libs#167).
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

- 73c6246: Add `nardukCore.auth` (default `true`) so a site with no accounts can
  skip `nuxt-auth-utils` and the empty `session.password` seed
  (narduk-libs#169). `auth: false` does not install the session module and does
  not register `/api/_auth/session`. With `app` on it registers a signed-out
  `useUserSession` so the dashboard layout still renders, and the build stops
  with a clear error if `@narduk-enterprises/narduk-auth` is installed with
  nothing else providing `nuxt-auth-utils`. Existing apps keep today's install.
  `create-narduk-app` is a companion patch so the generator pin moves with core.
- ab81821: Downstream modules can add CSP sources through
  `nuxt.hook('narduk-core:csp', allow => ...)` without forking the estate
  policy. The hook is applied before the policy is resolved, and a contribution
  that arrives too late to merge fails the build instead of silently dropping
  (narduk-libs#410). `create-narduk-app` is a companion patch so the generator
  pin moves with core.
- 1dc62db: Document in the README that on the `cloudflare-module` preset,
  nitropack 2.13.4 reads the whole request body into memory before h3 or any
  route handler runs (narduk-libs#458). Only Cloudflare's edge limit (100 MB on
  Free and Pro) bounds that read. The package's own ceilings
  (`defineValidatedHandler` `maxBodyBytes`, the 64 KiB CSP report cap) bound
  parsing, not the read. The note says why there is no Content-Length gate and
  when to re-test: when the Nitro pin moves, or on Nitro v3, whose Cloudflare
  handler does not buffer. No runtime change.
- 3052028: Resolve Cloudflare bindings on Nitro internal SSR fetches so a nested
  `useFetch` / `$fetch` keeps the Worker `DB` (narduk-libs#49). When an event
  carries no `event.context.cloudflare`, the worker-env resolver behind
  `useDatabase`, KV, Hyperdrive and rate-limit helpers now falls back to the
  isolate env Nitro's cloudflare presets set on `globalThis.__env__` for every
  fetch and scheduled event; with neither present it still fails closed. No
  `AsyncLocalStorage.enterWith()`, which workerd does not implement.
  `create-narduk-app` is a companion patch so the generator pin moves with core.
- 9cb7dbf: Add `useLiveProduct(refresh, { intervalMs, updatedAt? })`, the
  recommended replacement for a bare `useIntervalRefresh` when the refreshed
  data is user-visible live content (narduk-libs#374). Polling pauses while the
  page is hidden and refreshes at once on return when a poll fell due;
  overlapping refreshes share the run in flight (`useInFlightTracker`), and
  `refresh()` never rejects, keeping a failure in `error`. Its `updatedAgo` ("3
  minutes ago") reads `formatRelative` against `useSsrNow`, and nothing runs
  until mount, so neither the label nor `pending` can mismatch the server
  render. It takes any refresh callback and fetches nothing itself.
- d8f4366: `defineValidatedHandler` now accepts `authorize`, which runs after
  params and query pass and before the body is read, so an unauthenticated
  caller never pays for the payload or the body schema (narduk-libs#371).
  Mutation helpers map a `ZodError` onto the same `VALIDATION_FAILED` 400, so
  caller key names no longer land in `statusMessage`. `create-narduk-app` is a
  companion patch so the generator pin moves with core.
- c6ec7da: development deploy: receipts carry per-step timings (`steps`,
  `totalSeconds`) and print the slowest steps. Every verified deploy queues full
  validation of the deployed commit (a capture commit for a dirty tree) to a
  detached worker that pushes `narduk-validation/<sha>/<uuid>`; one worker per
  repository, the newest SHA wins, superseded automatic runs are cancelled and
  their branches deleted, and a push that fails twice shows as `NOT PUSHED` in
  `development status`. deploy:dev refuses a capture that changes protected
  paths (`deployment.development.protectedPaths`, migration directories,
  Wrangler binding or Durable Object changes) unless run with `--gated`, and
  refuses after a `red-main` issue has been open for 24 h unless
  `--red-main-fix <issue>` names it. New
  `development rollback --to <known-good build>`; automatic rollback on failed
  proof is off unless `deployment.development.rollback` declares
  `automatic: true` with a `rehearsalRef`, and it pages instead of crossing a
  Durable Object, binding or non-expand-only migration change.
  `exec --operation migration` applies the expand-only rule (12.9): a drop or
  rename refuses unless it is a declared contract migration already landed on
  the production branch. For an app that declares no `deployment.migrations`
  (12.9 NA), files already on the production branch before the hold took effect
  (recorded as `migrationBaseline`; `enter --refresh` recovers it for an
  existing enrollment from the checkout's reflog, never from the current ref)
  are not judged; files that landed during the hold always are. An app that
  declares `deployment.migrations` (expand-contract) has every file judged.
- 10aca7a: development deploy now reconciles Worker crons and routes after
  promote. Version upload and `POST {script}/deployments` carry code only, so a
  trigger change in wrangler.jsonc previously never applied. The deploy path now
  runs `wrangler triggers deploy` from the artifact's resolved config
  (`.output/server/wrangler.json`, falling back to the source Wrangler file when
  the artifact omits those keys).
- feafb59: development enter refuses an already-disabled held workflow unless it
  is retired or `--accept-prior-state` is journaled. Adopting
  `disabled_manually` as `desiredState` silently left CI and promote off after
  exit (narduk-libs#754). Exit and `development status` now name any workflow
  restored to a disabled state.
- 9cb7dbf: `narduk/component-directory-structure` and
  `narduk/no-shadowed-shared-component` find a component's `components/` root by
  path segment instead of `indexOf('components/')` (narduk-libs#777). A checkout
  directory whose name ends in `components` — a worktree such as
  `core-module-app-components/` — is no longer taken for the root, so a local
  `pnpm run quality` stops reporting every component as "folder depth 7". A
  nested `my-components/` folder no longer cuts the path in half when the shadow
  rule computes Nuxt's component name. Both go through a new, tested
  `segmentsAfter` helper in `path-scope`.
- 1dc62db: Add `NeMeter` to the shared-component lists in eslint-config and
  narduk-app-tools so they match narduk-shell's registry after #601.
- 1c10b9b: Add `NeSearchInput` to the shared-component lists in eslint-config
  and narduk-app-tools so they match narduk-shell's registry after #815.
- a48e52e: `createAppLintConfig` no longer enables the theme-resolving
  `better-tailwindcss` rules just because `app/assets/css/main.css` exists or
  `tailwindcss` happens to resolve (narduk-libs#665). Pass `tailwindEntryPoint`
  to opt in. `create-narduk-app` is a companion patch so the generator pin moves
  with eslint-config; no generator source change.
- d880027: `foundation:check` items 1.1, 1.2, 1.4 and 1.5 are not-applicable
  when the app's only declared deployment target is not Cloudflare
  (narduk-libs#158). The checker reads `Config/project-lifecycle.json`
  `environments[].deploymentTargets[].provider`, or `Config/coolify-app.json`
  when there is no `Config/cloudflare-app.json`. A Worker that sets
  `worker.nitroPreset` (or `worker.framework`) to `none` is the same: 1.1 no
  longer fails a hand-rolled `src/index.ts` Worker that has no Nitro build. Item
  1.3 still requires `manifests:validate`. Items 3.1/3.2 read
  `access.exposureClass` from `Config/coolify-app.json` when the Cloudflare
  manifest is absent, so a Coolify public site is still asked for narduk-seo and
  narduk-analytics.
- 9cb7dbf: A generated private app now ships `.github/actionlint.yaml` declaring
  the self-hosted runner labels its workflows name — `proxmox` and `linux-ci`
  (`dependabot-merge.yml`), plus `proxmox-deploy` for the D1 `preview-d1.yml`
  template — so the shared workflow's required `caller-lint` job no longer fails
  a fresh app's first CI run with `label "proxmox" is unknown`
  (narduk-libs#778). The labels come from the same arrays the `runs-on:` blocks
  are written from, the file is a managed `upgrade` target like the workflows it
  describes, and a test re-runs actionlint's runner-label rule over every
  emitted workflow. Public apps name no self-hosted label and get no file.
- 0309559: Generated apps now route `@narduk-enterprises/*` to the anonymous
  `https://npm.nard.uk` mirror, drop the Dependabot `registries:` block, and
  install without a GitHub Packages token. `scripts/gh-packages-run.mjs` stays
  as opt-in break-glass and is unused by the default `cf:build` and CI paths
  (narduk-libs#568).
- 1dc62db: `upgrade` no longer reads an app as an `seo` app just because it
  depends on `nuxt-og-image` (narduk-libs#825). Since narduk-seo made
  `nuxt-og-image` an optional peer (#809), generated SEO apps pin
  `nuxt-og-image@6.8.0` beside `@narduk-enterprises/narduk-seo`, so the default
  `useSeo()` path still emits `/_og/` cards and the #316 packed-consumer proofs
  keep their `/_og/` assertions. That put a third-party package in the `seo`
  capability's package list. When an app has no `narduk.capabilities` block,
  `upgrade` works out its capabilities from its dependencies, and any match in
  that list counted, so an app with `nuxt-og-image` and no `narduk-seo` was read
  as `seo`. Now only `@narduk-enterprises/*` packages identify a capability.
- 4fda255: Generated private CI now ships a GitHub-hosted
  `Runner group onboarding` job so a repo missing fleet runner-group membership
  gets a workflow log and annotation instead of an indefinite `queued` with no
  output (narduk-libs#625).
- 427d98f: Add a Go slog.Handler adapter that emits the shared narduk-logging
  record contract (narduk-libs#206).
- b6a06b6: Clear the narduk-mapkit lint suppressions left by first-time
  eslint-config adoption (narduk-libs#138).
- a032e64: `rectBeside`, a leader overlay, and `hoveredId` for AppMapKit (design
  round 2, narduk-libs#517).

  `rectBeside(rect, frame, point, anchor, options)` on `./client` is pure camera
  math beside `refreshMapKitMapLayout`: it returns the visible map rect that
  places a coordinate beside a DOM rect, with a gap, a vertical target, and one
  extra zoom step when the station is clustered.

  `MapKitLeaderOverlay` follows an annotation's screen point on every region
  change, draws a line to an anchor element, and reports when the point is off
  screen. `<AppMapKit>` accepts the same overlay as the `leader` prop and emits
  `leader-offscreen`.

  `hoveredId` (`v-model:hovered-id`) sits beside `selectedId`. The matching pin
  host carries `data-mapkit-hovered`; hover never adds or removes annotations.

- 9cb7dbf: `narduk-app db migrate` starts far fewer wrangler processes
  (narduk-libs#704). On `--local`, every inspection read — the table list,
  ledger shape and rows, both legacy ledgers, the lock owner and adoption
  evidence — now goes to wrangler as one multi-statement `--command`, so an
  inspection is at most two processes whatever the history. A run that finds
  nothing to apply or adopt and no lock row now returns after that read, without
  taking the lock, and a run whose work another runner already finished skips
  the redundant post-apply read. Against real wrangler on a local D1 with 19
  migrations, a warm (no-op) run went from 20.1 s to 3.3 s. On `--remote` a warm
  run drops from 15 processes to 5, and no remote path starts more processes
  than before: statements are still sent one per process there, because that
  path's multi-statement reply is not proven here. Each migration file is still
  applied and recorded on its own, and a retained lock still fails the run.
- a07c87b: Add `NeCard`, `NeCardList` and `NeDetailView` (item 17, #264).

  The eslint-config and narduk-app-tools shared-component lists name those three
  plus `NeSearchInput` so the drift and item-13 tests match `narduk-shell`'s
  registry. Explorer inventory, catalog, and usage ship beside the components.

  `NeCard` wraps `UCard` with media, title, badge, stat rows and actions.
  `NeCardList` renders the same collection state as the table (`v-model:state`
  or `:collection`) with `NeStatePanel` and `NePager` built in, so one page
  toggles cards and table. `NeDetailView` is a key-value panel: label, value,
  format, unit, and an unavailable message that never looks like zero.

  The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately
  not hand-edited: `versions:check` requires it to equal narduk-shell's live
  `package.json` version, and `versions:sync` re-pins it when `release:version`
  runs.

- 1dc62db: `NeDataTable` owns its sideways overflow and floors width-less
  columns (narduk-libs#684, proven in operator-portal's `CollectionTable`).
  `UTable`'s root is now the named scroll box (`data-ne-data-table-scroll`), and
  it and the outer wrapper carry `min-w-0 max-w-full`, so one long unbreakable
  string scrolls the table, never the page, even inside a flex or grid parent.
  `NeDataColumn` gains an optional `width` (any CSS length, set on the header
  cell); once any shown column declares one, the table takes
  `min-width: max(100%, calc(<each width, or 200px for a width-less column> + …))`
  from `sm` up through `--ne-data-table-min`, so every width-less column keeps
  at least 200px and the box scrolls instead. A table that declares no widths
  renders as before; `stickyHeader: 'page'` keeps no scroll box and no floor.
- 9cb7dbf: `NeDataTable` now declares its slots (narduk-libs#780). A consumer's
  `<template #status-cell="{ row }">` type-checks under `vue-tsc` /
  `nuxt typecheck`, and `row` is the table's own row type, so the local typed
  wrapper apps wrote to get past TS2339/TS7053 can be deleted. The slot shape is
  exported as `NeDataTableSlots<T>` (with `NeDataTableCellSlotProps`,
  `NeDataTableGroupSlotProps` and `NeDataTableBreakSlotProps`) for a wrapper
  that forwards them.
- 1dc62db: Add `NeMeter` and the unreported treatment (#601, #602).

  `NeMeter` is one value against a known ceiling — a filled track with the
  figure beside it (`4,200 / 5,000`), in a `block` or `inline` variant. The fill
  is clamped to `[0, max]`; the figure and `aria-valuetext` always carry the
  real value, and a `max` of zero or less is a ceiling with no room rather than
  a division by zero. It is a plain element with token-read scoped CSS:
  `UProgress` is a `progressbar` whose `null` is the indeterminate "working on
  it" state, which is the wrong reading twice over.

  A figure with no producer now has its own look, distinct from zero and from
  stale. `theme.css` gains `--ne-hatch` and `--ne-hatch-soft` — 1px diagonal
  hatches derived from `--ne-ink-dimmed` and `--ne-line-strong`, declared in
  every scheme block — and the README documents the CSS contract under "The
  unreported treatment". `NeMeter` takes `:value="null"` and renders the hatched
  track, an em-dash and a `role="img"` named "…: not reported" (never
  `aria-valuenow="0"`). `NeKpiTile`'s existing `null` value now renders the same
  way: the em-dash on the soft hatch, named "Not reported", with
  `data-state="unreported"`. A reported `0` is unchanged in both.
  `isUnreported`, `NE_UNREPORTED_TEXT`, `NeMeterProps` and `NeMeterVariant` are
  exported from the package root.

  The styling-contract test now allows a `font-family` / `box-shadow` /
  `border-radius` declaration whose whole value is one `var(--ne-*)` or
  `var(--ui-*)` read, and still rejects raw values and `var()` fallbacks.
  Explorer inventory, catalog and usage ship beside the component.

- 8994b95: Add `NeSearchInput`: the debounced search field beside a collection
  (item 14, #261), the other half of `NeFilterBar`. Explorer inventory, catalog,
  and usage ship beside the component so the private showcase stays complete.

  `v-model` is the applied term, not the keystroke — the box updates as you type
  and the model updates after 250 ms, the same window `useCollection` uses for
  `q`. Bind `v-model="c.q"` with `:debounce="0"` so the two windows do not
  stack. The trailing clear empties the box and the model in the same tick; a
  reset that waited out the debounce would keep the previous term live after the
  reader asked it to stop. Length is the list-query contract's 200-character
  ceiling, so a `q` that cannot travel is never typed.

  The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately
  not hand-edited: `versions:check` requires it to equal narduk-shell's live
  `package.json` version, and `versions:sync` re-pins it when `release:version`
  runs.

- 408ad37: README only: point secret-backed local flows at nvault instead of
  Doppler, which is retired except the `ne` root store. `create-narduk-app`
  releases alongside because it pins both packages.
- 7ae3a16: Fill the SSR `__NUXT__` payload from Worker public bindings, so
  Workers Builds no longer ships an empty `gaMeasurementId` / `posthogPublicKey`
  when the Worker has the keys (buoys#133).

  Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`, and
  Nuxt's own request-time overlay only maps `NUXT_PUBLIC_*` names. Apps that
  wrote `process.env.GA_MEASUREMENT_ID || ''` shipped an empty page payload
  while `/api/runtime/public` was correct.

  **narduk-core**: a new `00-runtime-public` Nitro plugin runs
  `applyRuntimePublicOverlay(event)` on every page request (not `/api/` or
  `/_nuxt/`) before SSR. It writes the browser-only overlay keys
  (`RUNTIME_PUBLIC_SSR_KEYS`: analytics keys and PostHog flags,
  `allowGeolocation`, `twitterSite`, `seoSearchActionUrlTemplate`) onto the
  request's own `runtimeConfig.public` clone. `previewSafeMode`,
  `deploymentTarget`, the URLs and the auth keys keep their build values on the
  server, because the 5xx sanitizer and narduk-auth read them from the same
  object; the client plugin still applies the full overlay. Preview hosts still
  blank analytics, and `analyticsPrivacy: 'strict'` is untouched. The overlay
  also accepts `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
  `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` / `NUXT_PUBLIC_POSTHOG_HOST` after the short
  names, and the module seeds `gaMeasurementId` / `posthogPublicKey` so Nuxt's
  native `NUXT_PUBLIC_*` overlay has keys to fill.

  **narduk-analytics** seeds `posthogPublicKey` and accepts the same
  `NUXT_PUBLIC_*` aliases at build time. **narduk-platform** catalog notes,
  **narduk-app-tools** README and the **create-narduk-app** runbook document
  that `cf:runtime-var` is the contract and a `nuxt.config.ts` wrangler reader
  is not.

  **Upgrade (Buoys and any app with the same workaround):** bump
  `@narduk-enterprises/narduk-core` (and `narduk-analytics` if pinned), delete
  the app-local `wrangler.json` reader, drop `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
  `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` wrangler copies kept only as Nuxt aliases,
  and keep the short names in wrangler `vars`.

- 1dc62db: `@narduk-enterprises/narduk-seo/shared/hostAwareIndexing` exports
  `canonicalRobotsPolicy(hostname, canonicalHostname, options)`, which returns
  the full robots directive for a request host:
  `'index, follow, max-image-preview:large'` (exported as `hostAwareIndexRule`)
  on the canonical host and `'noindex, nofollow'` everywhere else. Options cover
  route-level `indexable: false`, `additionalCanonicalHostnames` for aliases
  such as `www.`, and overrides for both directive strings. Apps that carry
  their own `robotsForHostname` and hardcoded canonical hostname can use it
  instead (narduk-libs#836).
- 8affc4a: narduk-seo no longer hard-depends on nuxt-og-image. The package is an
  optional peer at 6.8.0. Static-card apps omit it and set
  `ogImage.enabled: false`. Runtime OG or build-time prerender cards
  (`ogImage.zeroRuntime: true`) add `nuxt-og-image@6.8.0` themselves --
  `zeroRuntime` still installs the module and only disables the request-time
  renderer. If the peer is missing, the layer skips `installModule`, registers a
  no-op `defineOgImage`, and `useSeo` falls back to the static image. A missing
  peer is a silent skip on the default/static path and when the app set only
  `ogImage.zeroRuntime: true`; the layer warns only when the app set
  `ogImage.enabled: true`. Generated SEO apps pin `nuxt-og-image@6.8.0` so the
  default `useSeo()` path still produces `/_og/` cards (narduk-libs#316).

  The three image-size highs that originally filed narduk-libs#170 are already
  gone at nuxt-og-image 6.8.0 (`image-size` is not in the lockfile). This change
  is the coupling half.

  On npm.pkg.github.com / npm.nard.uk the abbreviated packument drops
  `peerDependenciesMeta`, so an optional peer can still install as required
  (package-delivery#7). The module skip is what keeps a consumer that does not
  have the package able to build. Whether the install tree is actually free of
  nuxt-og-image depends on the registry's packument until the npmjs.org move.

- ca67c3f: Add tag-based E2E quarantine to
  `@narduk-enterprises/narduk-testkit/playwright/config`: `@quarantine` via
  `quarantineDetails`, `grepInvert` on the `pr` / `web` projects so a tagged
  spec is excluded from the PR project, a `quarantine` project that collects the
  tag, and `assertPlaywrightQuarantineCollection` so a vitest guard fails when
  Playwright collects an untagged or wrongly tagged file (narduk-libs#520).
  `create-narduk-app` is a companion patch so the generator pin moves with the
  testkit release.
- d7c1ace: The E2E `page` fixture now names the page URL and the mismatched node
  when Vue logs a hydration mismatch. An `addInitScript` wraps `console.warn`
  and serialises `location.pathname`, the node's `outerHTML`, and its parent as
  the warning fires, so a later `goto` cannot drop the details. Apps that build
  an E2E artifact can spread `VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE` into
  `vite.define` so production Vue keeps those node arguments
  (`__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`). `create-narduk-app` is a
  companion patch so the generator pin moves with the testkit release.
- f10064d: Add `@narduk-enterprises/narduk-testkit/playwright/config`, a
  Playwright preset with `setup` / `pr` / `web` projects, `fullyParallel: true`,
  and `workers: 2` (the measured default from the Buoys e2e-parallel-config
  experiment). Specs declare a tier in the filename so an undeclared file is not
  collected by every project. Viewport filtering is collection-time via project
  metadata. `create-narduk-app` is a companion patch so the generator pin moves
  with the testkit release.
- 4a3178b: `create-narduk-app upgrade` now writes only the top-level Workers
  Cache key on an existing `apps/web/wrangler.jsonc`. Bindings, routes and
  account stay app-owned. An explicit `cache.enabled: false` is left alone
  (narduk-libs#672).
- f84b7de: `verify --live --expect-sha` reads `x-build-version` from the health
  route when one is enabled. A prerendered smoke path (generated SEO apps
  prerender `/`) is a static asset and has no Worker header, so exact-SHA live
  proof no longer depends on that route (narduk-libs#781). `--no-health` still
  falls back to the smoke path.

## 0.13.4

### Patch Changes

- 1716307: Exclude the private Libs Explorer from the shared capability catalog
  so foundation coverage does not treat the showcase as an app-adoptable
  package.
- 42019f6: Pin SSR hydration for `NardukLineChart` and `ChartTooltip`. The
  components are unchanged; these are the first hydration tests in the package,
  added while narrowing riverstatus#204 — they server-render each component,
  hydrate that exact markup and assert that Vue raised no warning, which is the
  only place a hydration mismatch is visible.

  `create-narduk-app` releases alongside because it pins narduk-charts.

## 0.13.3

### Patch Changes

- dfa8d39: Fix three defects that made core's own components break in a
  consuming app, where core is installed as a module:

  - LayerAppFooter (`useSsrNow`), AppBreadcrumbs (`toRef`) and `useFormHandler`
    (`readonly`) called names the app runtime import bridge did not inject, so
    they threw `ReferenceError` during SSR and failed prerendering. The seo and
    analytics admin panels had the same gap for `useOgImagePreviewResolver`,
    `normalizeOgPreviewSections`, `useAdminGaOverview`, `useAdminGscPerformance`
    and `useAdminPosthogDashboard`. All are now bridged, and a test scans every
    bridged app file so the lists cannot drift again.
  - `main.css` now declares `@source` for core's `runtime/app`. Tailwind skips
    `node_modules`, so utilities used only by core components were never
    generated; LayerAppHeader's desktop nav (`hidden md:flex`) stayed hidden at
    every width.

## 0.13.2

### Patch Changes

- 1b14eaf: Add `nardukAnalytics.privacy: 'strict'` for apps whose pages hold
  private records. PostHog then runs with no autocapture, rage clicks, dead
  clicks, heatmaps, session replay, surveys, `/flags` request or remote
  extensions, and a final `before_send` hook reduces every URL, pathname and
  referrer property — including `$set`, `$set_once` and nested web-vitals
  payloads — to the matched route pattern, drops page titles and element text,
  and reports exception messages only in narduk-core's redacted form. GA4
  receives route patterns as `page_path`, `page_location` and `page_title`, with
  Google signals and ad personalisation off. The option is build-time and wins
  over an app's own `runtimeConfig.public.analyticsPrivacy`; the runtime-public
  overlay never carries it, so a Worker variable cannot switch a strict app back
  to standard. Standard apps see no change.
- e8a373e: Health checks can fail at `notice` severity: the entry publishes
  `result: 'fail'` with `notice: true` and its `detail`, and the report's
  `status` does not move, so a monitor matching `"status":"ok"` does not page.
  `registerFreshnessCheck` takes an optional `noticeAfter` below `warnAfter` for
  the aging band of a three-band freshness policy. The docs no longer describe
  `degraded` as something that does not take the app down: to a `"status":"ok"`
  monitor it pages like `error` (#414).
- 12f3294: `runAtomicBatch(db, statements)` runs a group of writes as one
  transaction on D1 (`batch()`) or better-sqlite3 (`$client.transaction`), so
  apps stop copying tenancy's dual-driver helper (#201).
- e87803e: `types/**/*.d.ts` joins Nuxt's generated app, server, shared and node
  tsconfigs, so a `nuxt/schema` runtime-config augmentation in `types/` types
  its keys instead of leaving them `unknown` with no error (#669). An
  augmentation that was inert before can now surface type errors it was hiding.
- d8aec20: narduk-seo no longer ships its own copy of `LayerAppFooter`
  (narduk-libs#743). It registers `LayerNetworkFooter` globally and adds it to
  `appConfig.nardukCore.footer.after`, so narduk-core's footer renders the
  network row. The footer an app sees is unchanged. This needs narduk-core
  2.11.0 or later, and the peer range now says so.

## 0.13.1

### Patch Changes

- 3f8eac8: The `/api/admin/**` GA, Search Console, Indexing and PostHog routes
  register only when the app has a database: an app declaring
  `nardukCore.databaseBackend: 'none'` (or `NUXT_DATABASE_BACKEND=none`) no
  longer ships routes `requireAdmin` could only ever refuse.
  `nardukAnalytics.admin` overrides either way (#524).
- 551e39a: The canonical-host redirect takes a host list:
  `CANONICAL_REDIRECT_HOSTS` (or `runtimeConfig.public.canonicalRedirectHosts`)
  redirects only the named hosts, such as `www`, to the canonical origin and
  serves every other host where it was asked, so `*.workers.dev` previews keep
  working. It needs no `ENFORCE_CANONICAL_HOST`, and a `*.workers.dev` entry is
  ignored (#515).

## 0.13.0

### Minor Changes

- e6c9263: `.github/dependabot.yml`'s npm update now splits into two groups by
  `update-types` over the same packages: `safe` (minor + patch) and `majors`
  (major), `open-pull-requests-limit: 2`. A new generated
  `.github/workflows/dependabot-merge.yml` merges the `safe` lane once CI is
  green on its exact PR head; `majors` and the `github-actions` lane stay a
  deliberate person/agent PR. This replaces the old single all-in `dependencies`
  group (gonogo#104, the reference shape): apps on the old canonical shape
  (`open-pull-requests-limit: 10`, ~10 groups) stacked roughly ten open PRs that
  all edited `pnpm-lock.yaml`, so merging any one conflicted the rest, and a
  single combined group let one breaking major hold every harmless patch bump
  red behind it (riverstatus#215).

  `create-narduk-app upgrade` delivers `.github/workflows/dependabot-merge.yml`
  to existing apps as a new whole-file managed target alongside the refreshed
  `.github/dependabot.yml`.

  `narduk-app-tools`' `foundation:check` gains an advisory-only print (not a
  `FoundationSubCheck`, since this framework has no warning tier) that flags a
  `.github/dependabot.yml` npm update reproducing the old stacking shape:
  `open-pull-requests-limit` above 2, or npm groups not split by `update-types`
  into a safe and a majors lane. It never affects the check's `score`, `result`,
  or `exitCode`.

### Patch Changes

- 8ec9bb9: Tooling carpool: the migration runner refuses a contract-owned D1
  database named by its `database_name` as well as its id (#637); foundation
  item 5.2 accepts the canonical Dependabot recipe, an npm update routed through
  a registry scoped to `@narduk-enterprises` (#241); a failed schema-adoption
  probe names the adoption, says the migration has no receipt yet, and says how
  to record it or correct the evidence (#600).
- 1bca010: `deployment.liveProof.healthAuth: "anonymous" | "authenticated"`
  (default `anonymous`). An authenticated health route stays declared,
  `deploy hotfix` and `development deploy` skip the anonymous health assertion,
  item 12.3 says so, and the adoption live read reports requirement 12 unknown
  instead of failing a 401 (#585).
- bad1b0d: Two foundation checks for the components-library plan
  (narduk-libs#260). `narduk-app foundation:check:no-local-copy` (item 13) fails
  when an app depends on a shared UI package and keeps its own copy of one of
  its components. `narduk-app foundation:check:list-routes` (item 14) fails when
  a GET server route reads pagination from its query without narduk-core's
  `parseListQuery`. Each writes its own JSON artefact and uses the usual exit
  codes: 0 pass, 1 fail, 2 unknown. The README documents both.
- ff26c60: `narduk-app doctor` warns when a worker whose `main` is Nitro's
  `.output/server` lacks `no_bundle`, `find_additional_modules` or `base_dir`.
  Without them, wrangler re-bundles the build and every server-rendered 404/500
  comes out empty (#245).
  `deploy versions-promote --wait-for-version <seconds> [--wait-interval <seconds>]`
  re-lists while the commit's version is absent, so a Workers Build that
  finishes after CI no longer turns an unbroken merge into exit 3 (#695). The
  default is 0, which keeps today's single look.
- 5747011: Three small narduk-core changes.

  - `readBoundedBody` and `readBoundedJson` are exported server utils
    (narduk-libs#565). They read an upstream body with a hard size ceiling,
    cancelling the stream once it passes `maxBytes`, and throw
    `BoundedBodyTooLargeError`, or your own error via `tooLarge`. The
    narduk-data client already read its bodies this way. The README documents
    it. An app with its own util of the same name gets a duplicate auto-import
    warning; delete the app's copy.
  - `x-build-version` reads `WORKERS_CI_COMMIT_SHA` before it asks `git`
    (narduk-libs#584). A Workers Build no longer depends on its checkout
    carrying `.git` to stamp the commit.
  - `defineRateLimitedHandler` given an async handler returns
    `EventHandler<Request, Promise<Response>>`, not `Promise<Promise<Response>>`
    (narduk-libs#653). Runtime behaviour is unchanged, and the cast in
    `definePublishedDataHandler` is gone.

- 02b6c1a: The CSP report route answers 204 without reading any body that is not
  `application/csp-report` or `application/reports+json`, and limits each client
  to 60 reports a minute (rate-limit key `csp-report`); a request of any other
  type is answered before the limiter and never counts against it (#444).
- b0dca25: `LayerAppFooter` has an extension point for extra rows
  (narduk-libs#743). It renders an `after` slot below its content, and by
  default that slot renders the global components listed in
  `appConfig.nardukCore.footer.after`. A module can now add a footer row without
  shipping its own copy of the footer. The README documents it.
- 45ea540: `consumeRateLimit(event, options, path?)`:
  `defineRateLimitedHandler`'s decision step as a non-throwing verdict, for a
  route the app cannot wrap, such as a module's token route (#413). The wrapper
  now calls it, so the two share one counter key, store, binding and override
  surface.

  `shared/utils/units` adds knots (`metresPerSecondToKnots`,
  `knotsToMetresPerSecond`), the inverse of every existing conversion, and
  `compassPoint16(degrees)` with `NE_COMPASS_POINTS_16` (#518).

- 02b6c1a: `upgrade` creates a missing `manifests:validate` script but no longer
  rewrites one an app has already given a body, so an app whose own proofs run
  under that name keeps them (#468).
- 85cd719: `narduk/no-csrf-exempt-route-misuse` and
  `narduk/require-csrf-header-on-mutations` take an `exemptPaths` option: the
  app's `nardukCore.csrf.exemptPaths`. A route it covers is CSRF-exempt to both
  rules, so it must verify a credential header rather than the browser CSRF
  header (#510).
- f395bd6: The shared imports block now sets `import-x/resolver-next` to
  eslint-plugin-import-x's own Node resolver (narduk-libs#562). With no resolver
  set, import-x fell back to its legacy `node` probe, which crashed
  `import-x/no-cycle` on a `vitest.config.ts` with "node with invalid interface
  loaded as resolver". An app that turned `import-x/no-cycle` off for its
  `vitest.config.ts` can drop that override. narduk-core and narduk-auth have
  dropped theirs.

## 0.12.5

### Patch Changes

- 1759259: Foundation check 12.7 now needs narduk-core **2.10.1** or later
  before an app turns on Workers Cache, up from 2.2.4. Cores from 2.2.4 to
  2.10.0 still let Cloudflare store a thrown JSON 404 as Nitro's `no-cache`
  (narduk-libs#493). An app with the switch on and an older core now fails 12.7;
  upgrade narduk-core or remove the `cache` block.

  New `docs/workers-cache.md`: the standard for turning Workers Cache on in an
  existing app (narduk-libs#435), with its preconditions, the wrangler change,
  the `verify --live --edge-cache-path` proof, purging and rollback.

- a7e08a4: Apps can brand the password setup and reset emails through the
  `narduk-auth:email` Nitro hook. A template that throws or drops the link falls
  back to the default email. `sendAuthEmail` sends an app's own account email,
  such as an invitation, from the configured sender.
  `registerLocalUserWithProvenEmail` and `confirmSessionEmailWithProof` create
  or confirm an account for an address the app has just proven by redeeming a
  single-use token it emailed there, so an invited person sets a password and is
  in without a second confirmation email.
- 0da668a: Core migration `0007_api_key_hash_index.sql` adds a unique index on
  `api_keys.key_hash` (#168). Every API-key authentication looks the key up by
  its hash, and without the index each one scanned `api_keys`, including a
  request presenting a well-formed but fabricated key. The D1 and Postgres
  schemas declare the same index. Apply it with the app's migrate script
  (`narduk-app db migrate`). A Postgres app adds it with its own DDL.
- 5ac629e: The seeded `@nuxt/icon` client bundle now includes `lucide:check`,
  `lucide:copy` and `lucide:link`, which `AppCopyButton` and `AppShareButtons`
  render. The build now warns when an app lists `@nuxt/icon` before narduk-core
  without setting `icon.fallbackToApi: false`: `@nuxt/icon` has then already
  installed with the Iconify API fallback, which an enforcing CSP refuses
  (narduk-libs#467). The README states the module order.
- 1759259: A thrown error answered as JSON now leaves `private, no-store`
  (narduk-libs#493). For an `/api/*` or `.json` path,
  `Accept: application/json`, a CORS fetch or curl, Nuxt hands the error to
  Nitro's own handler, which sent `Cache-Control: no-cache` on every 404 and
  bypassed the `error-cache` plugin. Workers Cache stores `no-cache`, so an app
  with `"cache": { "enabled": true }` stored its API errors. A new prepended
  Nitro error handler, `json-error-no-store`, answers those errors itself with
  Nitro's status and body and `private, no-store`, and strips any CDN headers a
  route set before it threw. HTML errors and `nuxt dev` are unchanged.
- 0da668a: New apps ignore `/foundation-check/`, where the root
  `foundation:check` script writes `foundation-check.json` (#652). A cold
  scaffold's first local run no longer leaves an untracked directory. The
  artefact stays at the same path, so a failed run can still be read. Existing
  apps add the line by hand; most already have.
- 0da668a: New apps get a strict `apps/web/lint-budget.json`,
  `{ "strict": true, "rules": {} }` (#713). A warning in a rule with no budget
  entry now fails `pnpm lint` in a fresh app, instead of being recorded as that
  rule's budget and passing. Adopt one on purpose with
  `narduk-lint --accept-new-rules`. Needs `@narduk-enterprises/eslint-config`
  2.2.0 or later, which the generator already pins (2.2.1). Existing apps are
  unchanged until they add the key.
- 2d25947: Generated apps now override `miniflare>undici` to `^7.29.1`.
  Miniflare pins undici exactly, and below 7.29.1 each D1 call a test makes
  through the testkit harness costs about 6.5ms instead of about 2ms. That is
  enough to push seed-heavy suites past their CI timeouts (narduk-libs#740). The
  testkit README documents the override for existing apps.

## 0.12.4

### Patch Changes

- 056105e: Bump `@nuxt/ui` from `4.8.1` to `4.11.1` everywhere the layer pins
  it: the `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest (following the same coordinated-pin pattern as 8f693b1).

  A consumer app already on `@nuxt/ui@4.11.1` (buoys#287) failed
  `nuxt typecheck` against narduk-core's `AppTabs.vue`:

  ```
  error TS2345: Argument of type '{ ... items: TabsItem[] | undefined; ... }' is
  not assignable to parameter of type '... items?: TabsItem[] | undefined; ...'.
    Type 'import(".../@nuxt+ui@4.8.1/.../Tabs.d.vue").TabsItem[] | undefined' is
    not assignable to type 'import(".../@nuxt+ui@4.11.1/.../Tabs.d.vue").TabsItem[]
    | undefined'.
  ```

  Two different `@nuxt/ui` installs (narduk-core's pinned `4.8.1` and the app's
  own `4.11.1`) produced structurally distinct `TabsItem`/`AvatarProps` types
  that TypeScript will not unify, even though both come from the same package
  name. Matching narduk-core's declared version to the app's removes the
  duplicate-copy mismatch.

  `nuxt typecheck` passes clean in narduk-core against `4.11.1` with no source
  changes; no other breaking change between `4.8.1` and `4.11.1` touched
  anything in this workspace.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.11.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy -- the duplicate-copy failure this release removes.

  Refs narduk-enterprises/buoys#287.

- e61a56d: `narduk-app doctor` now refuses a rate-limit `namespace_id` that is
  not a positive decimal integer, such as `"abc"`, `"0x1F"`, `"0120"`, `-5` or
  `1.5` (#509). Scaffold ids and ids declared twice were already refused,
  including across `env.*` overlays.

## 0.12.3

### Patch Changes

- bbe7a1a: Document a post-merge deploy assertion for apps whose Workers Build
  deploys directly: a job that runs
  `narduk-app verify --live --expect-sha "$GITHUB_SHA"` over a build-length wait
  and names the Workers Build on failure (narduk-libs#597).
- 0e1a1ee: `foundation:check:deployment` enforces the expand-only half of
  `deployment.migrations.compatibility: "expand-contract"` (#399). New sub-check
  12.9 fails an app-owned D1 migration that drops or renames a table, view or
  column, because `narduk-app deploy rollback` restores code, never a schema. A
  deliberate contract migration is declared under
  `deployment.migrations.contractMigrations` (`path`, `sha256`, `reason`),
  pinned to the checksum the migration ledger records, and the failure prints
  that entry. An app with such a migration in its history adopts the rule by
  listing it once.

  `deployment.rollback.mode` now defaults to `manual` in new apps. Nothing ever
  read `"auto"`, so a generated app was declaring an automatic safety net it did
  not have. New sub-check 12.10 fails `"auto"`; the value still parses, so older
  manifests do not stop the tools. The generated deployment doc now says what
  actually triggers a rollback: only the app's own promote step, after a
  completed promotion fails its live proof. A failed migration triggers nothing.

- 2a35b4e: `foundation:check:coverage` gives each shared capability one of three
  states: `absent`, `adopted` or `forked` (#620). A capability is `forked` when
  an app pins the package and also carries its own copy of the package's
  internals. It is reported with its files and line count, and it no longer
  counts as adopted. Item 9.1 names it but does not fail, because some forks are
  deliberate and tracked.

  The signal is opt-in per capability, through `forkStems` in the generated
  catalog. Today only `narduk-mapkit` declares one (`mapkit`). A file counts
  when a directory segment of its path, or its own name, equals the stem, and it
  imports no package named for that stem.

  Inventory rows gain `state` and `fork`. `adopted` is now true only for
  `state: "adopted"`.

- ca8f56f: Generated apps run `foundation:check:deployment` and
  `foundation:check:shared-ui-pinned` with `--checkout ../..`, the repository
  root. They used to pass `--checkout ..` from `apps/web`, which is `apps/`, and
  item 12 read that as "no deployment block, not applicable" with exit 0 (#679).

  The foundation checks now exit 1 when `--checkout` has no `package.json`,
  naming the directory and the fix, so the old path cannot pass quietly. This
  covers `foundation:check` and its `:shared-ui-pinned`, `:toolchain`,
  `:deployment` and `:coverage` variants. **An app scaffolded before this fix
  must change `--checkout ..` to `--checkout ../..` in `apps/web/package.json`**
  before it takes this version.

- 24805a6: `better-tailwindcss/no-unknown-classes` no longer reports classes the
  app defines itself (#55). `createAppLintConfig` collects class selectors from
  the Tailwind entry stylesheet and the `.css` files it imports, including
  `@narduk-enterprises/narduk-ui/tokens.css`, and from every Vue SFC `<style>`
  block under `appRootDir`. It passes them to the rule as one exact-match
  `ignore`. A typo, or a Tailwind variant on an app-defined class, is still
  reported.
- c67b585: The generated `docs/deployment/promote-d1.steps.yml` now starts with
  two credential-free steps. They run `foundation:check:deployment` on the exact
  SHA being promoted, and refuse to migrate unless sub-check 12.9 passes. Only
  12.9 is judged, so another sub-check's UNKNOWN does not block a promotion.
  Worker rollback restores code, never a schema, so automating rollback beside
  the migrate step is safe only with this check in front of it (#399). The
  deployment-migrations runbook specifies the same ordering. It also names the
  check as a precondition for any promote workflow that runs
  `narduk-app deploy rollback` automatically.

  Existing apps copied the template once. To adopt, paste the two new steps
  above the dry-run step.

- 671fbf3: Adds `useCurrentLocation()`, a consent-first "near me" location read
  (#385). Nothing is read until `locate()` is called from a user gesture. Each
  call is one `getCurrentPosition`: it never watches, polls or reports a
  coordinate, and server rendering is a no-op.

  It keeps four failure outcomes apart. `denied` means the person refused.
  `blocked` means the page's own Permissions-Policy forbids geolocation;
  Chromium reports that as a denial, and the composable tells the two apart.
  `unavailable` means no position could be had, and `timeout` means none arrived
  in time.

  Fixes `NUXT_PUBLIC_ALLOW_GEOLOCATION` having no effect with the
  `security.headers` preset on. Before this change only the legacy middleware
  read it, so the app reported `allowGeolocation: true` and still sent
  `geolocation=()`. The preset now grants `geolocation=(self)` from it at build
  time. An explicit `permissionsPolicy.geolocation` still wins.

## 0.12.2

### Patch Changes

- 3dce8b4: Foundation item 11.3 no longer fails a job that calls a shared
  workflow with no Node input, such as `cursor-review.yml`. It no longer tells a
  caller of a `node-version`-only callable to use `node-version-file`, an input
  that callable does not declare; 11.1 still holds that caller's literal to
  `.node-version`. Workflows are also evaluated per job, so one job's
  `node-version-file` no longer satisfies another job in the same file.
- e42c8c9: `narduk-app doctor` checks Cloudflare rate-limit namespace ids
  (#433). A `ratelimits` binding, top level or under `env.*`, fails if it uses a
  scaffold id (`1001`, `50110`, `50121`, `50300`), if its id is declared more
  than once, or if it has no `namespace_id`. `namespace_id` is unique per
  account, so any of those shares counters with another Worker or environment.
  An app with its own unique ids passes.

  `create-narduk-app` writes the new app's own namespace prefix into
  `wrangler.jsonc`, derived from the Worker name by narduk-core's scheme, beside
  a commented example binding. It still emits no binding, because the limiter
  needs none.

- 8943c9e: `narduk-lint` can now fail a warning in a rule that has no budget
  entry. A `lint-budget.json` carrying `"strict": true` gates every rule: a new
  rule's warnings exit non-zero, naming the rule and its locations, instead of
  being recorded as the rule's budget and passing (#673). Adopt a new rule's
  current count deliberately with `narduk-lint --accept-new-rules`, which
  refuses to run in CI or with `--no-write`. A budget file without `strict`
  keeps the old record-and-pass behaviour and now says so on every run.
  narduk-timeseries fixes the one warning that behaviour had let through.
- b47ddc7: `narduk-testkit/d1`: `createD1QueryHarness` now runs on Miniflare 5,
  which every Wrangler from 4.129 ships. It converts its options with
  Miniflare's own `convertV4MiniflareOptions` when that exists and passes them
  unchanged to Miniflare 4.

  `create-narduk-app`: generated apps pin `wrangler` 4.136.3 and
  `@cloudflare/workers-types` 5.20260922.1. The older Wrangler's Miniflare
  brought `sharp` and `undici` versions with high advisories.

- c541ef4: Add `waitForVueHydrated(page)`, a real hydration barrier. It waits
  until the Vue app has mounted and Nuxt's `isHydrating` is `false`.
  `waitForHydration` only ever waited for the document `load` event, which on a
  Nuxt page fires before hydration. It is now deprecated with unchanged
  behaviour, and `waitForPageLoad` is the same wait under an accurate name. The
  shared auth, notifications and user-profile contract suites, and the
  generator's e2e fixtures and audit spec, now use `waitForVueHydrated`.

## 0.12.1

### Patch Changes

- df7568d: Stop published server code from depending on a consumer-side
  runtime-config augmentation.

  `narduk-core` ships raw `.ts`, and a consumer's Nitro type program types
  `useRuntimeConfig(event)` as `@nuxt/schema`'s `RuntimeConfig`
  (`Record<string, unknown>`). `useHyperdriveConnectionString` indexed
  `hyperdriveBinding || 'HYPERDRIVE'`, which is `{} | string` there, so every
  consumer failed with TS2538 while this package's own `nuxt typecheck` stayed
  green (narduk-libs#656, the same gap as #649). The legacy security-headers
  middleware had the same shape on `public.appVersion` and the `csp*Src` keys: a
  truthiness guard narrows `unknown` to `{}`.

  Server code that reads a key the module actually writes now goes through
  `coreRuntimeConfig(event)`. The type names only those keys —
  `hyperdriveBinding` and the public version, CSP, and geolocation defaults from
  `src/module.ts` — and leaves everything else `unknown`. A
  `tsconfig.consumer-server.json` project, run from the package's vitest suite,
  compiles the shipped `runtime/server/**` against that unaugmented view and
  fails if the view stops rejecting a direct `hyperdriveBinding` index.
  `create-narduk-app` is a companion patch so the generator pin moves with core.

- 7aeacad: Add owner-enrolled development mode (company-hq#781).
  `narduk-app development` gains `deploy`, `status`, `enter`, `pin`/`unpin`,
  `exec`, `validate`, `handoff`, `resolve` and `exit`. The optional
  `deployment.development` capability declares targets. A host-private
  activation record grants custody. Deploys capture the checkout, dirty edits
  included, and gate, build, upload, promote and prove the exact build ID under
  a target lock shared with hotfixes. Entry holds classified workflows and
  Workers Builds triggers and restores them exactly on exit, after the merged
  release commit passes explicit validation. Existing apps are unchanged until
  an owner enrolls them. See `docs/development-mode.md`.

  create-narduk-app now emits a `deploy:dev` script, a private-app explicit
  validation caller (`.github/workflows/validate.yml`, `narduk-validation/**`
  pushes only) and a Development mode section in `docs/workers-builds.md`. It
  never declares the capability.

## 0.12.0

### Minor Changes

- ed86373: Scaffold a declared AI-crawler policy, and a `security.txt` only when
  the app supplies a contact.

  An app generated with the `seo` capability now writes `aiCrawlers: 'allow'`
  into its `narduk-seo` block. That is the value narduk-seo already defaulted
  to, so nothing about the served site changes; what changes is that the policy
  is visible in `nuxt.config.ts` instead of being an unstated default, which is
  where an app goes to tighten it to `'disallow'` or to a per-agent
  `{ allow, disallow }` split.

  The new `--security-contact <uri>` flag (and the `securityContact` option)
  adds an RFC 9116 `securityTxt` block. It has **no default on purpose**: a
  scaffold cannot know who receives a vulnerability report, and a published
  `/.well-known/security.txt` naming an address nobody reads is worse than no
  file at all, because a reporter believes they have reported. An app that
  passes the flag publishes the file; an app that does not publishes nothing.

  The value is checked rather than pasted through. A contact must be a
  `mailto:`, `https:` or `tel:` URI, or a bare address, and may not contain a
  line break -- `security.txt` is a line-oriented format, so an unchecked
  newline would let a value inject a second `Contact:` line. A contact passed
  without the `seo` capability is refused at the call, not silently dropped,
  because the option it would land in does not exist in that generated config.

  `create-narduk-app upgrade` does not touch either setting on an existing app:
  `apps/web/nuxt.config.ts` is not a managed target, so an app that has
  tightened its crawler policy or moved its security contact keeps both.

- 13115ca: A new app's `apps/web/wrangler.jsonc` enables Workers Cache
  (`"cache": { "enabled": true }`), so `setCacheProfile`'s `CDN-Cache-Control`
  and `Cache-Tag` bind at the edge instead of being inert headers advertising a
  TTL the app does not have (narduk-libs#435). Without the block Cloudflare
  invokes the Worker on every request and never stores the response, which is
  what Buoys shipped: correct cache headers and no `Cf-Cache-Status`.

  On by default is safe because the narduk-core this generator pins keeps
  uncacheable responses out of a shared cache: thrown 4xx/5xx/429 are
  `private, no-store` (narduk-libs#429), nonce-CSP SSR HTML is too, and a route
  that picks no profile at all is `private` rather than left to Cloudflare's
  heuristic. `foundation:check` item 12.7 fails the block against an older
  narduk-core, so an app that downgrades core is told rather than silently
  storing error pages. `cross_version_cache` is left unset: a deployment
  partitions the cache by Worker version, and sharing across versions wants an
  app-specific reason.

  Enabling storage is a repository fact, not a live one. Prove a real hit with
  `narduk-app verify --live <production-url> --edge-cache-path <route>`; a
  `*.workers.dev` preview cannot show one.

  Existing apps are unaffected: `apps/web/wrangler.jsonc` is not an `upgrade`
  managed target, so `create-narduk-app upgrade` does not add the block to an
  app that already exists. Item 12.7 reports those apps `not-applicable` and
  says the edge headers are inert.

### Patch Changes

- 07bde95: Stop the published server sources from depending on a consumer-side
  runtime-config augmentation.

  `narduk-analytics` ships raw `.ts`, so a consumer compiles `server/**` inside
  its own Nitro type program — where the runtime-config augmentation this module
  registers does not take effect. Every `runtimeConfig` key is `unknown` there,
  and a truthiness guard narrows `unknown` to `{}`, so `config.ownerTagSecret`
  flowing into a `string` failed in every consumer while this package's own
  `nuxt typecheck` stayed green.

  Server code now reads config through a package-owned
  `analyticsRuntimeConfig(event)` accessor whose `AnalyticsServerRuntimeConfig`
  type promises only what `src/module.ts` actually defaults, so the same types
  hold in this workspace and in a consumer. A new
  `tsconfig.consumer-server.json` project, run from the package's vitest suite,
  compiles the shipped `server/**` against a deliberately unaugmented ambient
  context so the gap cannot reopen silently.

- 62b7b79: Stop the unhandled `/api/_auth/session` SSR error in apps that have
  not configured auth (narduk-libs#540). `coreModules` still installs
  `nuxt-auth-utils` (dashboard chrome uses `useUserSession`), but passes the
  module's existing `auth.loadStrategy: 'none'` unless the app already set a
  strategy, has a session password (`NUXT_SESSION_PASSWORD`, `SESSION_PASSWORD`,
  or `runtimeConfig.session.password`), or lists `narduk-auth` /
  `nuxt-auth-utils` in `modules`. A no-auth fixture SSRs without that fetch and
  without an error log. `create-narduk-app` is a companion patch so the
  generator pin moves with core.
- c7a6b59: Declare `narduk-core` as a peer range instead of an exact-pinned
  dependency.

  Both packages carried `@narduk-enterprises/narduk-core` as `workspace:*` in
  `dependencies`, which publishes as an exact pin. An app upgrading narduk-core
  therefore kept a second, older copy alive underneath these two — and
  narduk-core is a Nuxt module that appends global CSS to `nuxt.options.css`, so
  which copy's stylesheet wins comes down to module resolution order rather than
  anything the app declares.

  `narduk-core` now sits in `peerDependencies` at `>=2.6.3 <3.0.0` with a
  `workspace:*` `devDependencies` entry for these packages' own builds and
  tests, matching `narduk-uploads`. The consuming app owns the single resolved
  version.

  Released as a minor rather than a patch because it changes the published
  manifest shape: an app that reached narduk-core only transitively through
  these packages must now resolve it itself. Every generated app already
  declares narduk-core directly — it is the first entry in the generator's Nuxt
  `modules` list — and pnpm and npm both auto-install a missing peer, so no
  estate app is expected to need a change.

- 62b7b79: New server util
  `definePublishedDataHandler(handler, { profile, tags?, vary?, fallbackMessage?, rateLimit? })`
  for public published-data reads (narduk-libs#514). It applies the cache
  profile only after the handler succeeds, so an error never advertises a
  cacheable posture. An internal failure without a `statusCode` is logged and
  answered with a sanitized 503, and a deliberate `createError` passes through
  unchanged. Rate limiting goes through `defineRateLimitedHandler` and is
  applied only when `rateLimit` is passed. It is auto-imported, so an app with
  its own `definePublishedDataHandler` in `server/utils` (Buoys) should replace
  its local copy when it adopts this release. `create-narduk-app` is a companion
  patch so the generator pin moves with this core minor.
- b672613: Fix two entries in the generated `.gitignore` that never matched what
  they were meant to ignore.

  `.narduk/recovery` contains an embedded slash before the trailing one, which
  git anchors to the directory holding the `.gitignore` — the repository root.
  `narduk-app` actually writes recovery artifacts under
  `apps/web/.narduk/recovery/`, which the anchored pattern never matched, so
  they landed in `git status` and could be staged by `git add -A`
  (narduk-libs#624, evidence in narduk-enterprises/austin-rising-runners#3).
  Replaced with the unanchored `.narduk/`, which matches at any depth.

  `@narduk-enterprises/narduk-testkit` writes visual-audit artifacts to a
  hard-coded `output/playwright/visual-audit`, and nothing in the generated
  `.gitignore` covered `output/` even though it ignores every other Playwright
  artifact root (`playwright-report`, `test-results`, `blob-report`,
  `all-blob-reports`). A visual audit run left PNG output staged and invisible
  to every gate (narduk-libs#630, evidence in
  narduk-enterprises/austin-rising-runners#10, merge c7d3e59 committing 2.8 MB
  of screenshots). Added `output` alongside the existing Playwright entries.

  Neither change touches an existing app's committed `.gitignore` — only apps
  generated after this release get the corrected patterns.

- 9452204: Document verified persona injection for local hotfix credentials
  whose registered nVault key names differ from Wrangler's environment variable
  names.

  Preserve runtime variables through generated Wrangler configuration so local
  hotfix uploads support Wrangler 4.90.1, whose versions-upload command does not
  yet accept the equivalent CLI flag.

- 7b99efb: `doctor --adoption --live` and `foundation:check:security-headers`
  now probe the paths the app declares in `deployment.liveProof`, instead of a
  hard-coded `/`, `/api/health` and `x-build-version`.

  Requirement 5 reads the build stamp from `liveProof.smokePath` under the
  header `liveProof.buildVersionHeader`, requirement 12 reads
  `liveProof.healthPath`, and requirement 8 points its header probe at the
  declared smoke path. With no `--path`, `resolveProbeUrls` now reads the base
  URL exactly as given rather than resolving `/` against it, so a
  `--base-url https://app.example/login` probes `/login`.

  `foundation:check:deployment` item 12.3 already requires those fields, so the
  declaration always existed and the tools simply did not read it. On an
  authenticated app -- one whose root correctly refuses an anonymous request --
  that reported a working delivery path as undecided (R5) and a working health
  contract as failing (R12), and rewarded an app that left its health route open
  to anonymous callers over one that did not. A required `unknown` blocks
  declaration, so this was not a cosmetic verdict.

  The old values remain the fallback for an app that declares no `liveProof`
  block, so an app declaring the defaults is unaffected. `DeploymentArtefact`
  gains `declaration.liveProof`, and `AdoptionLiveReading` gains `smokeUrl`,
  `healthUrl` and `buildVersionHeader` so a report names the routes it actually
  read.

- de5abe4: Add an explicit local incident hotfix command with a clean commit
  snapshot, offline frozen install, required app checks, isolated build
  credentials, confirmed production target, version promotion, live proof and a
  durable failure receipt. Ship the operator runbook and generator scripts.
  Existing deployment commands remain compatible.

  Prevent the shared live probe from forwarding caller-provided request headers,
  including Cloudflare Access credentials, through cross-origin redirects.

- 62b7b79: Point `homepage` and `bugs.url` at narduk-libs instead of the
  archived `narduk-enterprises/narduk-mapkit` repo (narduk-libs#540). The
  Changesets fixed group is empty and `narduk-mapkit-nuxt` stays ignored, so
  this patch does not pull the frozen adapter; the adapter's matching metadata
  is updated in tree without a release. `create-narduk-app` is a companion patch
  so the generator-owned mapkit pin moves with it.
- c574403: core: answer `HEAD` on file-based API routes

  h3's router matches the request method exactly, so a `*.get.ts` file route
  registers `handlers.get` and nothing else and every `HEAD` to an API path fell
  through to a 404 — including `/api/health`, the path apps enrol for uptime
  monitoring. A monitor probing with `HEAD`, the conventional choice for a
  liveness check, saw the app as down. RFC 9110 §9.3.2 requires `HEAD` to be
  identical to `GET` minus the body.

  A new server middleware answers `HEAD` on `/api` paths by re-entering the app
  with `GET` and returning that response's status and headers with no body, so
  the two cannot drift and a failing health check still surfaces as its real
  status rather than as a cheap `200`. Pages are untouched: the Nuxt renderer is
  bound to no method and already answers `HEAD`.

  The re-entering request carries the caller's identity. Headers already
  forwarded survive the hop untouched; a caller identified only by its socket
  has that address carried inward explicitly, because the inner request has no
  socket and would otherwise join every other `HEAD` in the single `'unknown'`
  rate-limit bucket. A client-chosen forwarded address is never promoted to the
  trusted identity header.

- 2671ccd: The production error sanitizer can no longer throw.
  `sanitizeProductionError` assigned `statusText` unguarded, and
  `'statusText' in error` is true for a getter with no setter, so the write
  threw in strict mode, escaped into Nitro's error handling, and turned a
  correct status into a 500 with the original error discarded. `message`,
  `statusMessage` and the `delete` of `data` and `cause` could fail the same
  way, with worse consequences.

  Every field is now scrubbed defensively, falling back to
  `Object.defineProperty` so an inherited accessor is shadowed by an own data
  property and the value is actually removed rather than merely not throwing.
  One field that resists both paths no longer aborts the rest of the pass.

- 0f43a24: Stop pinning `/_og/**` to `prerender: false`, so OG images for
  prerendered pages are actually generated (narduk-libs#170).

  `nuxt-og-image` emits an _unsigned_ `/_og/s/...` URL while a page is
  prerendered and relies on the prerender crawler to bake that image to a file.
  The pin stopped the file being produced, so the unsigned URL fell through to
  the runtime handler, which rejects it with `403 Missing URL signature` as soon
  as a signing secret is configured -- which every deployed build requires. SSR
  pages were never affected; they take the signed `/_og/d/...` branch.

  **This changes your build output.** Each prerendered page that renders a card
  now writes one image file into the app's static assets, counting against the
  Workers per-file size and total file-count ceilings, and build time grows with
  the number of such pages. A baked card is exactly as stale as the page it was
  built from, so a card that must track data moving between deploys does not
  belong on a prerendered route. Apps that ship only a static `defaultOgImage`
  are unaffected; set `ogImage.zeroRuntime: true` or `ogImage.enabled: false` as
  before.

- b672613: Declare `vue-router` as a peer dependency of narduk-core.

  `runtime/app/components/app/LayerAppHeader.vue` imports the type
  `RouteLocationRaw` from `vue-router`, and `runtime/` is in narduk-core's
  published `files`, so that bare specifier ships to every consumer. narduk-core
  declared `vue-router` nowhere — not in `dependencies`, not in
  `peerDependencies` — so it resolved only because `vue-router` is a dependency
  of `nuxt` (`^5.2.0` per `nuxt@4.5.2`'s own `package.json`), which every
  consumer has today. A pnpm install with a restricted `hoist-pattern`, or a
  `node-linker` setting that suppresses that hoist, would get
  `TS2307: Cannot find module 'vue-router'`.

  Same shape as the `@nuxt/schema` phantom dependency closed in #382 — it was
  found by that PR's published-surface scan and deliberately left out to keep
  that PR scoped (narduk-libs#383). The range mirrors what `nuxt@4.5.2` itself
  declares, so any Nuxt app already has a satisfying copy and this declaration
  adds no install.

  `@narduk-enterprises/create-narduk-app` moves in lockstep because it pins
  narduk-core's version in `PACKAGE_VERSIONS`.

  **Consumer impact.** `patch`, not `minor`: this declares a dependency that was
  already required at runtime for every consumer today (any app using
  narduk-core already brings in `nuxt`, which already brings in `vue-router` —
  narduk-core's own type import has always needed it to resolve), it does not
  add a new runtime requirement. A consumer already on `vue-router >=5.2.0` —
  which is every consumer today, since that is what `nuxt@4.5.2` itself pulls in
  — sees no change: no new install, no version bump forced on their lockfile, no
  new peer warning. A consumer on an older, unsupported `nuxt` that resolved a
  pre-5.2.0 `vue-router` would newly see a peer range warning on their next
  install, surfacing a version this package already silently depended on rather
  than creating a new one.

## 0.11.1

### Patch Changes

- 693f7d3: security.headers: let a first-party-only app opt out of the estate
  CSP baseline

  `security.headers.baseline` selects which third-party origins an app inherits
  before its own `allow` is applied. It defaults to `'estate'`, so no existing
  app's policy changes.

  `baseline: 'self'` inherits none of them: every directive is `'self'` plus
  whatever the app names in `allow`. It exists because `allow` can only add,
  which left an app reaching no third party unable to enforce the strict nonce
  policy without widening its CSP — trading `script-src 'unsafe-inline'` for the
  eleven `BASELINE_ALLOWLIST` origins, eight of them on `connect-src`.

  The nonce, `'strict-dynamic'`, HSTS, `frame-ancestors`, `form-action`,
  `object-src`, the report route and style-src's `'unsafe-inline'` are
  unchanged, and the resulting policy is a strict subset of the `'estate'` one.

  Closes #560.

- eb07a18: Declare who owns each D1 schema: `deployment.databaseOwnership`

  `deployment.migrations` had to cover **every** D1 binding exactly once, which
  is right for a database whose schema is its migration history and wrong for
  one whose schema is owned by a contract and applied by a refresh job. The only
  way such an app could declare migrations for the rest of its estate was to
  manufacture a migration baseline for a database nobody migrates -- a false
  claim that the ledger describes that schema.

  `Config/cloudflare-app.json`'s deployment block now accepts an optional
  `databaseOwnership` array giving every binding exactly one owner: `migrations`
  (resolving to an entry in `deployment.migrations.databases`) or `contract`
  (naming the schema contract file and the package script that proves it).
  Absent, nothing changes -- an app that migrates everything keeps working with
  no config edit.

  The load-bearing part is at the runner, not the validator:
  `migrationDatabase()` is the single function every migration path uses to
  reach D1, and it refuses a contract-owned binding before any provider call.
  `db migrate --database READ_MODEL`, `db status`, `db migrate-deployment`,
  baseline capture and baseline registration are all refused, as is a wrangler
  config pointing another binding name at the contract-owned database id. The
  contract-owned database is also absent from the minimal wrangler config the
  deployment runner is handed.

  `foundation:check:deployment` sub-check 12.8 now applies the same coverage
  rule from the same implementation -- a contract-owned binding passes without a
  source manifest, while an uncovered or doubly-owned binding still fails -- and
  `doctor --adoption` requirement 6 reads that sub-check.

## 0.11.0

### Minor Changes

- d3f91b4: feat(create-narduk-app): a fresh scaffold reaches a green first CI
  run

  Six independent defects sat between `create-narduk-app` and a green `main`,
  and four were invisible until after the first push (narduk-libs#617).

  **The scaffold failed the gate its own CI runs.** Generated CI calls the
  shared workflow with `foundation-check: true`, which fails the build on `FAIL`
  _or_ `UNKNOWN`. A fresh scaffold produced a decided FAIL on item 1.2 —
  `apps/web/wrangler.jsonc` exists but `Config/cloudflare-app.json` does not —
  plus UNKNOWNs on 1.4/3.1/3.2 for want of `access.exposureClass`, and a FAIL on
  1.1 once a build had run. The first CI run of every new app was red by
  construction and nothing inside the app could fix it. The generator now emits
  `Config/cloudflare-app.json`: schema version, product, worker, `access`
  (`public` or `authenticated-public`, from `--exposure`) and the bindings
  mirror. What it cannot know — `product.repository`, the account id, domains,
  the narduk-v1 `deployment` block — is absent rather than fabricated, the same
  rule `wrangler.jsonc`'s missing `account_id` already followed. Absent leaves
  the app NOT ADOPTED for deployment, which is the truth before onboarding.

  **`quality:static` was weaker than the gate that judges it.** It called
  `build`, where CI calls `build:ci`; on any `seo` app `build` throws on an
  empty `NUXT_OG_IMAGE_SECRET`, so the local gate went red where CI was green.
  It now builds with the script CI builds with.

  **The scaffold failed its own `quality:static` three ways.** Long free text —
  a display name, a description, a site URL — pushed `const X = '…'` past the
  generated Prettier `printWidth: 100`, so `format:check` failed on the
  generator's own output; the emitter now breaks those declarations exactly
  where Prettier breaks them, and the e2e heading assertion binds its name to a
  const so that line is fixed-width at any input length. `knip` reported
  `narduk-logging` (reached through `runtimeConfig`, no named import) and
  `eslint` (backing `narduk-lint` and `eslint.config.mjs`) as unused; both are
  now declared ignores.

  **`xaiApiKey` leaked into apps without the `ai` capability.** It was emitted
  unconditionally into `runtimeConfig`. `narduk-ai` declares that key itself
  with a validator, and under `defu` an app-side `''` is a defined value that
  _wins_ — so the line both advertised a key to capability sets that never asked
  for one and defeated the module's own validation for the sets that did.
  Removed.

  **The generated README now names the three gates** — `quality:static`
  (credential-free, offline, what you run), `foundation:check` (reads the
  registry, exits 2 on UNKNOWN, deliberately not chained), `quality` (adds the
  browser suite) — and, for a private app, warns before the first push that CI
  runs on self-hosted manifest-routed runners: without runner-group membership
  the first workflow run sits `queued` indefinitely with no error, no timeout
  and no log.

  A new end-to-end test in `narduk-app-tools` runs the real `foundation:check`
  against a real generated app, before and after a build, and asserts `PASS`
  with zero unknowns — the claim nothing in this repository previously made.

### Patch Changes

- e82eb47: Make a generated app's root `lint` run prettier as well as eslint.

  `lint` is the command a contributor or agent reaches for, and it was eslint
  only. The formatting gate CI fails on is a different script -- the root
  `format:check`, which the shared callable runs as the first entry in
  `extra-scripts` -- so a prettier-only diff passed locally and failed CI,
  costing a whole cycle for whitespace. Nothing a person naturally types ran
  both; only `quality:static` chained them.

  Root `lint` now composes the root `format:check`. The root one, not
  `apps/web`'s: only it reaches `.changeset/`, root Markdown and `.github/`.
  `lint:fix` and `quality:fix` are unchanged -- they already chain
  `prettier --write` through `format` -- and `quality:static` keeps its own
  explicit `format:check` first, so the fastest check still fails fastest and
  the chain does not depend on how `lint` happens to be composed today.

  narduk-libs#628.

## 0.10.12

### Patch Changes

- fa2f123: fix(narduk-core): put the base element styles in `@layer base` so an
  app's theme wins

  `main.css` is appended to `nuxt.options.css` after the consuming app's own
  stylesheets, and its `body` and `h1`–`h4` rules were unlayered. Unlayered CSS
  beats every layered rule regardless of source order, so those defaults could
  not be overridden by an app at all: measured on lakestat-us, the app's own
  `body { color: var(--gs-ink); background: var(--gs-page) }` lost, and the page
  computed `#fff`, slate-700 and Inter instead of the app's palette.

  Both rules now sit in `@layer base`, which is where Nuxt UI already ships the
  same body declarations. `.font-display` stays unlayered, because an app opts
  into that class by name rather than inheriting it.

## 0.10.11

### Patch Changes

- 9f6038a: Stop the `playwright-dev-port` suite asserting a hash property the
  dev-port derivation never had. Four worktree paths into a 1000-port span
  collide at the birthday rate (0.599%), which is the rate the old single-sample
  test failed at — it blocked the narduk-core 2.6.3 release on 2026-09-19. The
  suite now asserts what the implementation actually promises: derived ports
  spread widely enough that lanes are practically unable to collide, and a
  residual collision stays loud rather than silently attaching to another lane's
  dev server. Test-only; `resolveLocalDevPort` behaviour is unchanged.
  `create-narduk-app` moves only because it pins the testkit version it
  generates against.
- 159e762: Re-release so the generator's `@narduk-enterprises/narduk-shell` pin
  moves with that package's `NeFilterBar` release (0.4.0 → 0.5.0).

  The pin literal in `src/manifest.ts` is deliberately not hand-edited here:
  `versions:check` requires it to equal narduk-shell's **live** `package.json`
  version rather than a preview of its next one, so `versions:sync` re-pins it
  when `release:version` actually runs. This changeset is what makes that
  release happen in the same wave, which is what `release-plan:check` asks for.

## 0.10.10

### Patch Changes

- ecc731b: Pin generated apps to `@narduk-enterprises/narduk-core` 2.6.3, whose
  report-only security-headers preset no longer emits
  `upgrade-insecure-requests` — a directive browsers ignore in a report-only
  policy and Chromium logs a console error for on every document load.

## 0.10.9

### Patch Changes

- 2e5959d: Pin generated apps to `@narduk-enterprises/narduk-app-tools` 0.13.1,
  whose runner-ledger guard no longer refuses a migration for mentioning the
  bookkeeping tables in a comment.

## 0.10.8

### Patch Changes

- 52ab505: Add a reviewed D1 baseline process: immutable schema/ledger capture,
  full-schema comparison, explicit metadata-only registration for untracked
  schemas, and a shared disposable-local cutover proof. Preserve historical
  fixtures across package upgrades and stop rechecking superseded legacy schema
  probes after stable checksum adoption. Document app-owned review, data-proof
  limits and migration-before-promotion onboarding.

## 0.10.7

### Patch Changes

- 176cbaf: Decode vector tiles, off the main thread, behind a new
  `./vector-tiles` entry.

  `createMvtDecoder` reads Mapbox Vector Tiles with `@mapbox/vector-tile` and
  `pbf`, and `serveVectorTileDecoder` hosts it in a worker that
  `createWorkerDecoder` (in `./client`) talks to, correlating replies by id and
  transferring buffers both ways so nothing is copied. The protobuf dependencies
  are reachable only from `./vector-tiles`, so a consumer of `./client` never
  bundles a parser; a test walks the import graph and fails if that changes.

  A decoded tile is now columnar -- an `Int16Array` of coordinates plus two
  `Uint32Array` indexes -- rather than an object per point, which is the
  difference between a 256-tile cache retaining about a gigabyte and retaining
  about a hundred megabytes. `buildDecodedVectorTile` packs one,
  `decodedVectorTileBytes` and the new `cacheBytes` measure what is retained,
  and `vectorTileFeatureCount` reads the feature count back.

  Tile bytes are posted as a tight buffer, so a `Uint8Array` that views part of
  a larger allocation decodes correctly and its parent buffer is not detached.
  Requests for an address already in flight join that read instead of starting a
  second one, and `cacheBytes` now counts an estimate of the property payload
  rather than geometry alone.

- 1c64619: Answer a tap on a painted vector tile, and wire the overlay to a Vue
  scope.

  `source.hitTest({ coordinate, zoom, tolerancePx })` returns the nearest
  feature within a screen-pixel radius, with the properties the archive carried.
  It reads only tiles the cache already holds, so it is synchronous and can
  answer inside a gesture; a tap on an undrawn tile misses rather than fetching.
  Distance is measured to the nearest point on a segment, not to a vertex, and
  the probe reaches into neighbouring tiles when it lands within the tolerance
  of an edge -- wrapping at the antimeridian, stopping at the poles -- so a
  river drawn a pixel inside the next tile is still tappable.
  `projectToTilePoint`, `hitTestTile` and `hitTestNeighbours` are exported for
  callers that hold their own tiles.

  `useMapKitVectorTiles()` in the Nuxt module -- which this changeset cannot
  name, because the adapter is frozen at 2.0.x (narduk-libs#405, #421) -- builds
  the PMTiles reader and the overlay source, rebuilds them when the archive url
  changes, repaints a style change from the decoded tiles rather than
  refetching, and terminates the decoder worker with the Vue scope. The worker
  factory and the `pmtiles` reader stay the app's, because a published worker
  chunk is the one thing Vite, webpack and Nuxt do not agree on.

  Two client interfaces were also corrected against the browser types they stand
  in for: `VectorTileCanvasContext.strokeStyle` was too narrow for a real
  `CanvasRenderingContext2D`, and `VectorTileWorkerPort.postMessage` was
  declared so that a real `Worker` could not satisfy it. Both are now proven
  assignable by typecheck-time tests.

## 0.10.6

### Patch Changes

- 3a10f40: Gate narduk-v1 promotion and shared previews on compatible D1
  migrations. Add explicit deployment target selection, read-only
  checksum/history status, a per-database migration lock with conservative
  failure recovery, SQL-only preview bundles, foundation coverage checks, and
  one-shot workflow onboarding templates.
- 8cd6999: Refuse an existing D1 application schema with no recorded migration
  history, even when a source manifest contains no SQL. Require reviewed
  baseline evidence instead of reporting an untracked read model current or
  replaying its schema.
- d077c85: Add a vector-tile canvas overlay source to `./client`.

  `createVectorTileOverlaySource` paints decoded vector tiles to a canvas and
  returns the `imageForTile` function the async tile overlay and the layer
  registry already take, so a dense network stays off MapKit's overlay list.
  Decoded tiles are cached, so `setStyle()` repaints from memory without a
  refetch or a re-decode. The decode step is injected, which keeps this entry
  free of protobuf dependencies and lets an app decode in a worker.

  `createPmTilesTileSource` and `createPmTilesFetchSource` read a PMTiles
  archive over HTTP range requests, taking the reader and the `fetch` they use
  so tests need no network. A missing tile, an empty tile and a failed read all
  resolve to `null` and report through `onError`, instead of throwing into the
  map.

## 0.10.5

### Patch Changes

- e34b2da: `<AppMapKit>` now infers the app's item type in an SFC template
  (narduk-libs#573, K-1). The exported type keeps only the generic construct
  signature, so `create-pin-element`, `item-key`, `item-label`, `pin-geometry`
  and the `#callout` scope accept callbacks narrowed to the app's own item type
  without a cast. A vue-tsc template fixture in `tests/nuxt/template/` gates it.
- 20d72a9: `narduk-mapkit/nuxt` auto-imports `useMapKitView()` and
  `useMapKitFullscreen()`, lifted from buoys. `useMapKitView()` owns the map
  behind a map-first page's `<AppMapKit>` -- camera, frame, zoom tier, padding,
  basemap, the `./marks` layer and fullscreen -- and takes the scoped runtime
  from `map-ready` (K-10). A map-first app no longer copies buoys'
  `utils/mapkit/*` and view composables to draw marks. The `./testing` fake map
  now models `showsMapTypeControl`.

## 0.10.4

### Patch Changes

- 80dde89: Generated apps pin `@narduk-enterprises/narduk-app-tools` 0.11.0,
  whose `verify --live` can prove a host behind Cloudflare Access.
- ef39ebf: Add `@narduk-enterprises/narduk-mapkit/marks`, the point-map mark kit
  lifted from buoys (narduk-libs#517): the declutter engine, label placement,
  keyed mark layer, DOM pin builders, frame and camera math, and IQR overview
  framing. The Nuxt module gains an opt-in `marks` option that adds the marks
  stylesheet (`MAPKIT_MARKS_CSS`) after the host chrome.

## 0.10.3

### Patch Changes

- 81051b0: Narduk Data client: send `redirect: 'manual'` instead of `'error'`,
  which the Cloudflare Workers runtime rejects before any response arrives. A
  redirect is still an `http` failure and is never followed (#563).

## 0.10.2

### Patch Changes

- 448e86f: `createNardukDataClient` no longer re-downloads an unchanged release
  when its TTL lapses. If the manifest still names the same release and artifact
  checksum, the client keeps the cached value (and its object identity) and
  fetches only the manifest.
- 7142305: `useSsrNow(key, { tickMs })` also re-reads the browser clock when the
  page becomes visible again, so a viewer returning to a background tab sees
  current relative ages at once instead of after the next (throttled) tick. The
  listener is registered only for a ticking clock and removed on unmount. This
  closes the last gap between `useSsrNow` and the Buoys map clock it
  generalises. `create-narduk-app` is a companion patch so the generator pin
  moves with the core patch.

## 0.10.1

### Patch Changes

- 4599aa7: `createNardukDataClient` can now read a release's secondary
  artifacts, the ones the manifest lists in `artifacts[]` beside the primary
  `artifact`. Set the new `NardukDataProduct.entryPath` option to a
  release-relative path, for example
  `consumer/lakes/texas/canyon-lake/history-1y.json`.

  - The path may have several segments, each of which must be a plain name.
  - The entry is checked against its own listed SHA-256, with the usual timeout,
    retry, single-flight, memo, stale-if-error and freshness handling.
  - A release that does not list the entry fails with the new `NardukDataError`
    reason `'missing'`, so consumers can answer "not published" rather than
    reporting an outage. It never falls back to the primary artifact.

  Reads without `entryPath` are unchanged (#552).

- 4ba5d02: AppLightbox gains optional thumbnail rails (0–2 labelled rails, each
  with its own keyboard axis) and a `side` slot for per-picture details.
  `AppImage` wraps remote pictures with loading and failed states.
  `AppSnapStrip` is a horizontal scroll-snap strip with an en-dash position
  readout (narduk-libs#529). `create-narduk-app` is a companion patch so the
  generator pin moves with the core minor.
- c1c8b42: Add the narduk-shell data-table family — `NeDataTable` (UTable preset
  with column groups, units, tabular numerals, the missing dash, day/group rows,
  a pinned first column, the phone column-set switch, the break row, and
  loading), `NeSortHeader`, `NeCsvDownload`, plus `toCsv` / `parseSort` from the
  package root — and extend `NePager` with `pageSizes`, `mode` (`pages` | `more`
  | `auto`), `moreStep`, `maxLimit` and `update:limit`. narduk-timeseries gains
  `bucketReadings` (1h / 3h / 1d min/avg/max; missing is `null`, not `0`).
  create-narduk-app is patched because it pins narduk-shell (narduk-libs#528).
- dd1a7d9: `createConsoleTracker` accepts URL-scoped ignore rules
  (`{ text: RegExp; url?: RegExp }`) and records 4xx/5xx response URLs so an
  object rule's optional `url` matches the request that actually failed. Bare
  `RegExp[]` call sites stay unchanged (narduk-libs#134). `create-narduk-app` is
  a companion patch so the generator pin moves with the testkit release.

## 0.10.0

### Minor Changes

- 92835a1: Generated apps lint through `narduk-lint`: `apps/web`'s lint script
  is `nuxt prepare && narduk-lint` (no more `--max-warnings 0`), and the
  generator emits an empty `apps/web/lint-budget.json` (`{ "rules": {} }`).

## 0.9.9

### Patch Changes

- bb37590: Pin generated apps to the narduk-core release with `useSsrNow` and
  migration `0006_user_id_indexes.sql`, and the narduk-testkit release with the
  `./d1` query harness. A newly generated app applies `0006` with its first
  `db:migrate:local` / `cf:deploy`.
- 36d9e18: `./testing` fake: a second `mapkit.init()` while the first token
  exchange is pending, or after it succeeded, is now an idempotent no-op instead
  of throwing `FakeMapKitNotImplemented` (K-7, narduk-libs#522). No new token is
  requested, the first call's options stand, and the call is logged as `init`
  with detail `ignored`. A second `init()` after a failed exchange still runs a
  new exchange, so `retry()` stays testable. New conformance tests pin the rect
  camera (K-5: `visibleMapRect`, `setVisibleMapRectAnimated`, `MapRect` /
  `MapPoint` / `MapSize`, `Map.MapTypes`) against the Web-Mercator maths buoys'
  shim used, in vitest and through `fakeMapKitInitScript()`, so buoys can delete
  both shims.
- 36d9e18: The Nuxt module's `/api/mapkit-token` route now applies **no rate
  limit by default** (narduk-libs#485). Since #436 it limited every app to 30
  requests per 60 s per routed origin; that ceiling is now opt-in.
  `ModuleOptions.rateLimit` is optional and has no default: set
  `nardukMapKit: { rateLimit: { limit, windowSeconds } }` to keep a ceiling. A
  limiter an app mounts on `event.context.nardukMapKit.rateLimit` still wins,
  with or without the option. With per-client keying of the default no longer
  needed, narduk-libs#512 is moot.

  Logan's decision (askme, 2026-09-18 14:23 CT): "whatever the least restrcitive
  reasonable option is.....i do NOT want rate limits to come up again....its
  super annoying and not a problem".

  `create-narduk-app` picks up the generator-owned narduk-mapkit pin.

## 0.9.8

### Patch Changes

- 8da7e33: Generated apps pin the narduk-core release that keys IPv6 rate-limit
  callers by `/64`, adds `nardukCore.csrf.exemptPaths`, and documents
  account-unique `namespace_id`s.
- 05b3ef9: Pick up narduk-core's per-request header strip on shared-cacheable
  responses and narduk-app-tools' edge-cache proof (narduk-libs#412, #418, #435)
  in newly generated apps' pins.
- c16bdfd: `foundation:check` now reads the registry for sub-check 2.3 from the
  project's own `@narduk-enterprises` scope route (narduk-libs#498). The reader
  takes the last `@narduk-enterprises:registry=` line in the checkout's
  `.npmrc`, the same rule as the shared CI workflows. A repo that routes the
  scope to the `https://npm.nard.uk` mirror, or to any other registry that is
  not GitHub Packages, is read anonymously. The reader sends no `Authorization`
  header there, so it needs no `NODE_AUTH_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`.
  Repos with no route line, or a route to `npm.pkg.github.com`, keep the
  existing GitHub Packages Bearer read and its scope-probe 404 corroboration.
  Other scopes such as `@narduk-geo` stay on GitHub Packages.

  `create-narduk-app` takes a patch so generated apps pin the fixed
  `narduk-app-tools`.

- a82dc2d: Pick up the generator-owned pin bumps from narduk-logging 0.3.0 (the
  `QueryCounter` statement / round-trip counter, narduk-libs#325) and the
  dependents it re-releases.
- 49d2606: Pick up the generator-owned narduk-mapkit 2.2.0 pin (the Worker-safe
  token-route limiter export, narduk-libs#485).

## 0.9.7

### Patch Changes

- ad7a156: Give generated CI a committed test-only `NUXT_OG_IMAGE_SECRET` so
  `nuxt build` does not fail closed.

  narduk-seo now throws on a non-dev build when runtime OG is enabled and the
  secret is empty. Public `quality` / `browser` jobs set the Playwright
  placeholders as plain `env:` values (not repository secrets). The private
  reusable workflow cannot inherit caller env, so the same placeholders prefix
  `build:ci`. The Workers Builds runbook requires `NUXT_OG_IMAGE_SECRET` and
  `NUXT_SESSION_PASSWORD` as Build variables — Worker secrets are runtime-only.

- ad7a156: Ignore generated Wrangler `.dev.vars` secrets, and make `cf:build`
  authenticate before it installs.

  The scaffolded `.gitignore` now lists `.dev.vars` / `**/.dev.vars` /
  `.dev.vars.*` with a `!.dev.vars.example` carve-out, matching the existing
  `.env` pattern. Root `cf:build` runs a committed `scripts/gh-packages-run.mjs`
  (process-scoped temp userconfig from `GH_PACKAGES_READ`, then
  `pnpm install --frozen-lockfile`) so a Workers Builds dashboard that sets
  `SKIP_DEPENDENCY_INSTALL=1` actually has `node_modules` and registry auth
  before `nuxt build`. `narduk-app gh-packages-run` is the same helper for
  post-install callers.

## 0.9.6

### Patch Changes

- fe58c5f: SSR HTML is never shared-cache storable on an app that serves the
  nonce CSP (`nardukCore.security.headers` in `enforce` or `report-only` mode),
  because nuxt-security writes one per-request nonce into both the HTML and the
  CSP header and an edge cache would replay it to every visitor
  (narduk-libs#435). `setCacheProfile` refuses a cacheable profile on a page
  render with the new `nonce-csp-html` suppression reason, and a new
  `nonce-csp-cache` Nitro plugin pins `Cache-Control: private, no-store` on the
  final `text/html` response and strips `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`, `Expires`
  and `Age` however they got there. JSON API routes and Nuxt `_payload.json`
  responses keep their profile and stay edge-cacheable. In development, a page
  that asked for a cacheable profile logs one warning per path.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

- cf8e05e: `<AppMapKit>` no longer loads `mapkit.core.js` twice
  (narduk-libs#469). The SSR preload's `useHead()` now runs during the server
  render only. Through 2.1.2 it also ran on the client, where unhead's DOM
  renderer had to recognise the server's `<script>` by hashing every attribute
  on it. Under a nonce CSP (narduk-core `security.headers`) the browser hides
  the tag's nonce as `nonce=""`, the hash never matched, and unhead appended a
  second copy, which MapKit reports as `Mapkit namespace already exists`. On the
  client, Apple's `@apple/mapkit-loader` is now the tag's only owner: it adopts
  the server's tag on an SSR page load and injects the single tag on a
  client-side navigation.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-mapkit` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule). The
  generator's behavior does not change.

## 0.9.5

### Patch Changes

- 7ae9278: Thrown 4xx/5xx responses — including a 429 from
  `defineRateLimitedHandler` — now carry `Cache-Control: private, no-store` and
  drop `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`,
  `Cache-Tag`, `Expires` and `Age`, even when the route had already set a
  cacheable profile (e.g. `setCacheProfile(event, 'live')`) before throwing.
  Nitro's own error page otherwise ships `Cache-Control: no-cache`, which
  Cloudflare Workers Cache _stores_ and revalidates once an app turns on
  `"cache": { "enabled": true }`; `no-store` / `private` are the documented
  opt-out. This is a safe precondition for narduk-libs#435 (making
  `setCacheProfile`'s edge header actually hit) — do not enable Workers Cache in
  a consuming app until this release.

  The header-strip list that already backed the `preferences-cache` plugin
  (narduk-libs#386) moved to a new framework-free
  `runtime/shared/utils/shared-cache.ts` so the error path reuses it rather than
  duplicating it; `preferences.ts` re-exports the same names it always has, so
  no consumer import changes.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

## 0.9.4

### Patch Changes

- 766ce96: Fix the estate CSP baseline refusing GA4's Google-signals beacon
  (narduk-libs#472). A GA4 property with Google signals enabled sends a second
  `page_view` beacon straight to `https://www.google.com/g/collect` (not a
  `*.google-analytics.com` host), with an `<img>` fallback at the same origin
  when `fetch`/`sendBeacon` is unavailable. Both the strict nonce-CSP baseline
  (`runtime/shared/security-headers.ts` `BASELINE_ALLOWLIST`) and the legacy
  enforcing middleware (`runtime/server/middleware/securityHeaders.ts`
  `BASELINE_CONNECT_SRC`) now allow `https://www.google.com` on `connect-src`;
  the legacy middleware's `img-src` already carries an `https:` wildcard that
  covers the same host, so it needed no change. A property that runs with Google
  signals off never sends this beacon and does not need the host.

  create-narduk-app re-releases so its generated package pins follow the
  narduk-core patch and its dependents.

- 86bdb58: Make `deployment.previewBindings` real, so item 12.4 can pass with
  non-production branch builds on (narduk-libs#473, deployment-standard design
  §3.3 option A).

  **The build now isolates a preview.** A `previewBindings` entry may name its
  preview resource with wrangler's own fields: `id` for KV, `database_id` and
  `database_name` for D1, `bucket_name` for R2. On a Workers Build whose
  `WORKERS_CI_BRANCH` is not `productionBranch`,
  `narduk-app deploy versions-upload` writes `.wrangler.deploy.preview.json`
  with every D1, KV and R2 binding rebound, and uploads with it. The rebinding
  is all or nothing. When any binding lacks its preview resource, or names a
  production one, the build keeps `.wrangler.deploy.production.json` exactly as
  before and prints a `WARNING`. `deploy`, the production branch, runs outside
  Workers Builds, an explicit `--env` target and apps without a valid
  `narduk-v1` block are unchanged.

  **12.4 checks the config the build would upload.** It runs the same planner
  against the app's own wrangler config.

  - It reports `pass` when every binding is rebound to a resource that is not a
    production one.
  - It reports `fail` when a preview entry names no binding of its kind, or when
    a preview id, name or bucket is a production one in any scope.
  - It stays `unknown` for bare names, a D1 entry missing its id or name, a TOML
    app config, or bindings in a second Worker's config.

  The artefact gains `previewConfig`, and the summary prints a `preview` line.

  A binding listed twice in one `previewBindings` kind now makes the block
  invalid. Before this change, the second entry was silently shadowed by the
  first.

  `create-narduk-app` adds `.wrangler.deploy.preview.json` to the generated
  `.gitignore` and `.prettierignore`.

## 0.9.3

### Patch Changes

- 62c69e0: Bump the pinned `@narduk-enterprises/narduk-mapkit` version to 2.1.2,
  so a newly generated app starts on the release that builds a late-mounted
  `<AppMapKit>` rather than on 2.1.1. No generator behavior changes — this only
  keeps the generator's own release in step with the release-plan guard's
  generator-pin rule (`scripts/check-generator-release-plan.mjs`), which
  requires a companion release whenever a changeset moves a package the
  generator pins by version literal.

## 0.9.2

### Patch Changes

- 554ae27: Bump the pinned `@narduk-enterprises/narduk-mapkit` version to 2.1.1,
  so a newly generated app starts on the release that fixes the ten adoption
  defects (narduk-libs#422) rather than on 2.1.0. No generator behavior changes
  — this only keeps the generator's own release in step with the release-plan
  guard's generator-pin rule (`scripts/check-generator-release-plan.mjs`), which
  requires a companion release whenever a changeset moves a package the
  generator pins by version literal.

## 0.9.1

### Patch Changes

- fa41027: Bump the generated-app pin for `@narduk-enterprises/narduk-core` (and
  the workspace dependents Changesets will move with it) so a fresh scaffold
  gets the empty `colorMode.classSuffix` and the report-only CSP that omits
  `upgrade-insecure-requests`. The generator templates do not set `classSuffix`
  themselves.
- cbee698: Fix the generated deployment runbook's promote snippet, which told
  every new app to promote the wrong commit (narduk-libs#451 defect 2).

  The snippet passed `--sha "$GITHUB_SHA"`, but the promote job runs on
  `workflow_run`, where `GITHUB_SHA` is the default branch's head at trigger
  time rather than the commit whose run completed -- so a commit that never
  passed `ci / Required` could reach production. The runbook now shows a
  `workflow_run` workflow excerpt binding `VERIFIED_SHA` to
  `${{ github.event.workflow_run.head_sha }}`, uses it for both the promote and
  the live proof, and states why `$GITHUB_SHA` is wrong there. It also records
  that the `--sha` lookup is bounded by `--max-versions` rather than capped at
  ten, and that a lookup finding nothing exits 3 and must be a red job.

- a1efa4e: Patch release alongside the `@narduk-enterprises/narduk-uploads`
  patch (the upload byte cap is now enforced while the body is read) so
  `@narduk-enterprises/create-narduk-app` can refresh its pinned
  `narduk-uploads` version in `src/manifest.ts`.
  `scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version. No generator behavior changes.

## 0.9.0

### Minor Changes

- 6b17cdf: Add `narduk-app e2e-serve <port>`, the shared prebuilt-Worker
  Playwright launcher the estate `nuxt-cloudflare` callable assumes every
  narduk-app has (narduk-libs#447).

  It serves an already-built `.output/server/index.mjs` through the app's own
  `wrangler` (`unstable_startWorker`, watch off), binds 127.0.0.1 only, refuses
  to compile a fallback, and writes `[e2e-serve]` startup notes to stderr so a
  stalled start is visible in Playwright's webServer log. Real worker errors
  pass through; the only filtered stderr is workerd's client-abort
  `kj::getCaughtExceptionAsKj() … ::write(…): Broken pipe` /
  `Connection reset by peer` block, lifted with its tests from Buoys `5b040144`
  (buoys#124 / PR #128).

  `create-narduk-app` now scaffolds `playwright.config.ts` so
  `E2E_PREBUILT_ARTIFACT=1` runs `narduk-app e2e-serve <port>` and the default
  stays `nuxt dev`, and documents that path in the generated e2e guide.

## 0.8.0

### Minor Changes

- 2c9f995: Teach a newly generated app the Narduk deployment standard
  (company-hq#745, deployment-standard design §2.1/§3.2; Logan approved every
  recommended option on 2026-09-17).

  `docs/workers-builds.md` previously taught the pre-standard model: a
  production deploy command that **deploys**, and non-production branch builds
  enabled for trusted branches. Both are now wrong, and the second is a live
  safety hole.

  - Both Cloudflare deploy commands are now `pnpm run cf:deploy:preview`, which
    runs `narduk-app deploy versions-upload`: it uploads a version that serves
    no traffic. A production command that deploys puts a `main` push straight
    into production, which is the one thing the standard exists to prevent. The
    doc says why the two are the same command and that the name is historical.
  - Non-production branch builds now start **disabled**. A version captures its
    binding _configuration_ but not the state behind it, and
    `preview_database_id` / `preview_id` / `preview_bucket_name` apply to
    `wrangler dev` only, so a branch build of an app that binds production D1,
    KV or R2 reads and writes production data from every pull request. The doc
    states the hazard and the exit from it: create a preview resource per
    binding, list them under `deployment.previewBindings`, then turn branch
    builds on.
  - The runbook now carries the exact `deployment` block to paste into
    `Config/cloudflare-app.json` at onboarding, plus the promote, live-proof and
    rollback commands.
  - A new `foundation:deployment` script runs
    `narduk-app foundation:check:deployment --checkout ..`.

  The generator still does not create `Config/cloudflare-app.json` itself. That
  file records live Cloudflare facts a checkout cannot know, onboarding owns it,
  and this generator does not hold a continuing relationship with an app's
  configuration. It emits the block to paste and a check that reads it.

  ## Review round 1

  The `deployment` block the runbook tells a new app to paste was ~24 hand-typed
  string literals, and the only assertions on it were substrings. Adding one
  required key to the schema would have shipped a generator whose paste-this
  block fails the very check it tells you to run — discovered by the first app
  to try it, not by CI. The block is now serialized from a single object, and
  the generator test extracts the fenced block, parses it, and asserts it equals
  `narduk-app-tools`' committed `fixtures/default-deployment-block.json` — which
  that package's own suite pins to `defaultDeploymentBlock()` and to
  `readDeploymentBlock` accepting it. The pin is a fixture rather than an import
  because the published generator must require nothing at runtime, and because
  CI's per-package gates run `pnpm --filter <name>` without building a workspace
  sibling's `dist`. Add a required key to the schema and `narduk-app-tools` goes
  red; update its fixture and this generator goes red until it emits the new
  block.

### Patch Changes

- 49e249b: Repin the generator's `@narduk-enterprises/narduk-app-tools`
  dependency to the release carrying the deployment-standard promote, rollback
  and live-proof commands. No generator behaviour changes.
- 8e6c388: Generate a `playwright.config.ts` that resolves its local dev port
  through `@narduk-enterprises/narduk-testkit/playwright/dev-port` instead of
  `Number(process.env.PLAYWRIGHT_PORT) || <scaffolded port>`, and add
  `@narduk-enterprises/narduk-testkit` to the generated app's root
  devDependencies so the root config can resolve it.

  A linked worktree of a generated app now gets its own derived port and refuses
  to reuse a server it did not start, which is what stops two lanes on one
  machine from silently testing each other's branch (narduk-libs#417). The
  primary checkout and CI keep the scaffolded port, so no pipeline behaviour
  changes.

- 96d1d4b: Refresh the generator's `@narduk-enterprises/narduk-seo` pin for the
  security.txt / AI-crawler policy release.
- 0c4ddd9: Bump the pinned `@narduk-enterprises/narduk-testkit` version to track
  its new `server/handlers` handler test harness (narduk-libs#380). No generator
  behavior changes — this only keeps the generator's own release in step with
  the release-plan guard's generator-pin rule
  (`scripts/check-generator-release-plan.mjs`), which requires a companion
  release whenever a changeset moves a package the generator pins by version
  literal.
- 77945b9: Move the generator's pinned `@narduk-enterprises/narduk-core` version
  — and the dependent pins that follow it — to the release carrying
  `defineValidatedHandler`. The generator emits these versions as string
  literals, so Changesets cannot see the coupling and the release-plan gate
  requires the generator to move with them. No generator behaviour changes.
- cfa085f: Re-pin the generated app's layer versions so a newly generated app
  starts on the narduk-core release that carries the narduk-data product client.

  No generator behaviour changes: the templates, prompts and generated files are
  identical. This is the pin refresh `scripts/check-generator-release-plan.mjs`
  requires whenever a generator-owned package is released, so a generated app
  does not start life on a narduk-core older than the one the estate just
  shipped.

- 310121b: Add `@narduk-enterprises/narduk-mapkit/testing`: a deterministic,
  offline fake of MapKit JS v6 for component and end-to-end tests.

  The fake is modelled on a measured spike against real MapKit JS 6.0.128 rather
  than on the documentation alone. It covers `load()` with library gating,
  `init()` with the `configuration-change` and `error` events (Apple's seven
  `ConfigurationErrorStatus` values verbatim), scriptable authorization outcomes
  including the measured origin-mismatch shape (the same token retried three
  times, `authorizationCallback` invoked exactly once, then `Unauthorized`), an
  injected access-key clock, `mapkit.Map`, the three annotation classes, and the
  value types. Anything it does not model throws
  `FakeMapKitNotImplemented: <member>` instead of silently answering
  `undefined`.

  A separate inspection surface records an operation log with per-annotation
  add/remove counts, so a component test can assert a reconciliation budget --
  "updating 1 of 600 pins touched 1 annotation, not 600" -- rather than only a
  final-state outcome. `fakeMapKitInitScript()` serialises the whole fake for
  Playwright's `page.addInitScript`; it is one self-contained function, so there
  is no bundler step and no second implementation.

  `./testing` is a dev-time export: it carries no runtime dependency, and an
  import-graph test asserts no production entry point can reach it. The fake's
  public types are declared structurally, so the published `.d.ts` resolves
  without Apple's types installed, while a type-level conformance suite compares
  it member by member against `@types/apple-mapkit` v6 and fails typecheck on
  drift.

  `@narduk-enterprises/create-narduk-app` gets a patch release so it can refresh
  its pinned `narduk-mapkit` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.

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

- e8e6892: Patch release alongside the `@narduk-enterprises/narduk-logging`
  minor release (request ID `cf-ray` fallback, `Server-Timing` emitter,
  slow-route logging) so `@narduk-enterprises/create-narduk-app` can refresh its
  pinned `narduk-logging` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.
  `narduk-app-tools`, `narduk-realtime`, `narduk-shell`, and `narduk-testkit`
  release together with the generator per the workspace's own linked-release
  contract; none of them changed.

  `@narduk-enterprises/narduk-mapkit-nuxt` is deliberately **not** in that list.
  It is frozen at 2.0.x (`packages/modules/narduk-mapkit/docs/api-2.1.md` §a)
  and its source on `main` is now the 2.1 contract, so any release from `main`
  would publish a 2.1 adapter under a 2.0.x version number. The freeze is
  enforced by the Changesets `ignore` entry in `.changeset/config.json`; this
  changeset only stops naming it.

## 0.7.0

### Minor Changes

- 1af628c: Scaffold the single-source toolchain shape, and single-source the
  generator's own copy of it.

  A generated app now declares its Node version once, in `.node-version`, and
  its pnpm version once, in the root manifest's `packageManager`. Both workflows
  read those rather than restating them: `ci.yml` passes
  `node-version-file: .node-version` to the shared workflow (workflows#97),
  `copilot-setup-steps.yml` passes the same to `actions/setup-node`, and
  `pnpm/action-setup` drops its `version:` input so it resolves `packageManager`
  itself — the shape the shared `nuxt-cloudflare.yml`'s own pnpm step already
  uses. `engines.node` and `volta.node` stay as mirrors, because Volta and npm
  can read a version from a manifest and nowhere else. Node literals in a
  generated app fall from six sites to three; pnpm from three to one plus a doc
  row.

  **No `.nvmrc`.** Every consumer in this estate that reads it also reads
  `.node-version` (setup-node, fnm, mise); the only tool that reads `.nvmrc` and
  not `.node-version` is `nvm`, which is not the installed manager here — and
  Volta, which is, reads neither, only `package.json`. A second dotfile with no
  exclusive consumer is a drift site. `narduk-app foundation:check:toolchain`
  still accepts an app-kept `.nvmrc` as an optional mirror and fails only if it
  disagrees.

  Inside the generator, `24.21.0` appeared in four places and `10.33.4` in
  three, so a bump was a grep. `manifest.ts` now exports `NODE_VERSION`,
  `PNPM_VERSION` and `PACKAGE_MANAGER`, and every emission site — the manifest,
  the two workflows and the Workers Builds connection table — reads them.

  **The shared-workflow pin moves to `6f56678` (workflows#97).** This is not
  optional: a reusable workflow rejects an input it does not declare, so a
  caller passing `node-version-file` to the previous pin would fail at startup.
  That commit also adds an always-run required `caller-lint` job which
  actionlints the **calling** repository's own workflows and audits them for
  workflow-level concurrency, a top-level and a per-job `permissions:` block,
  per-job `timeout-minutes`, and 40-character SHA pins. Every job this generator
  emits now carries a job-level `permissions:` block for that reason (a
  job-level block replaces the workflow level rather than merging with it), and
  `tests/toolchain-single-source.test.ts` re-runs the gate's own rules over the
  generated output so the templates cannot drift back. The pin deliberately
  stops at `6f56678` rather than main's tip; #99 and #100 are separate
  decisions.

  `.node-version` is deliberately **not** a managed target of the `upgrade`
  codemod. A Node version is the same class of fact as a dependency pin, which
  `ownership.ts` already excludes on the grounds that D-TOOLCHAIN-1 gives
  Dependabot estate package currency — managing it would make the generator
  re-impose its own Node on every app it touched, the continuing sync
  relationship this repository's AGENTS.md forbids. `copilot-setup-steps.yml`
  stays managed whole-file, and is now safer for it: the file no longer carries
  a version literal at all, so re-applying it cannot move an app's toolchain
  behind its back.

- 7181db7: Add a `create-narduk-app upgrade [dir]` codemod that re-applies the
  units the generator still owns in an already-scaffolded app, as a reviewable
  diff (narduk-enterprises/company-hq#745). It is dry-run by default — printing
  a unified diff and exiting 1 when a managed unit has drifted, so CI can use it
  as a check — and `--write` applies exactly what the dry run printed. `--only`
  limits a run to one path and `--json` prints the machine-readable report.

  Ownership is explicit and deliberately narrower than "the generated file", so
  app-owned content is never clobbered: the shared-workflow **pin** inside an
  app-owned `.github/workflows/ci.yml`, the **whole** `copilot-setup-steps.yml`
  and `dependabot.yml`, the marker-delimited `narduk:router` **region** of
  `AGENTS.md` and `narduk:e2e-policy` region of `docs/e2e-testing.md`, and the
  named contract **script bodies** in the root `package.json` (`build:ci`,
  `foundation:check`, `manifests:validate`, and the `db:migrate:*` pair on an
  app with a database). Everything else the generator emits is seeded: written
  once and never read again. Any managed file can be disowned with a
  `narduk:unmanaged` header comment. The generator's `AGENTS.md` template now
  emits the router markers so new apps are opted in from scaffold.

  Also bumps two stale GitHub Action pins in the generated workflows —
  `actions/checkout` to v7.0.1 and `pnpm/action-setup` to v6.1.0, both verified
  tag-to-SHA upstream. Running the new codemod against the reference app is what
  surfaced them: the app was current and the template was a release behind.

- f0a74b3: Bring the generated scaffold to parity with the Buoys reference app
  shape (narduk-enterprises/company-hq#745): explicit `@nuxt/icon` module
  registration (fixes an `UNLOADABLE_DEPENDENCY` build failure), a pinned
  `nitro-cloudflare-dev` devDependency, a `copilot-setup-steps.yml` workflow, a
  corrected `.github/dependabot.yml` shape (single `directory`, `github-actions`
  ecosystem group), root `build:ci` / `foundation:check` / `manifests:validate`
  scripts plus the `@narduk-enterprises/narduk-app-tools` devDependency that
  back them, a generated `apps/web/scripts/validate-manifests.mjs` pre-deploy
  check, new `CONTRACT.md` and `docs/workers-builds.md` templates, a Playwright
  `setup`/`chromium` project split, and a generic `docs/e2e-testing.md` plus
  `apps/web/tests/e2e/visual-audit.spec.ts` skeleton built on narduk-testkit's
  `playwright/ui-quality` toolkit (`consoleTracker`, full-page and named-locator
  capture). Every generated file remains Prettier-canonical under the package's
  own format:check.
- 9051c12: Document the shared error page and exception capture in generated
  apps, and prove a generated app never shadows them.

  narduk-core supplies the error page through Nuxt's `app:resolve` hook only
  when the app has not provided one, so a generated `apps/web/app/error.vue` —
  even a placeholder — would silently take the estate page out of every new app.
  A generator test now asserts that no generated file is an `error.vue` and that
  no generated source registers a `vue:error`, `app:error` or Nitro `error`
  listener.

  New `docs/error-page.md` in the generated repository covers what the page
  shows, its E2E selectors, where exceptions are reported, how to subscribe
  another destination, and how to override or wrap the page; README links to it.

### Patch Changes

- cbaf741: Scaffold the estate E2E flake policy into new apps, so a flaky test
  cannot report green from the first commit.

  The generated `playwright.config.ts` now sets `retries` to 1 in CI (was 2) and
  enables `failOnFlakyTests` for push/default-branch runs: a test that fails and
  then passes on its retry FAILS the merge rather than being reported as
  flaky-but-green. Pull requests keep the single retry as a cheap defence
  against browser-pool noise — the merge to the default branch is where the
  suite has to be believed. `trace: 'on-first-retry'` is unchanged and is now
  the trace on the one retry that exists.

  The tier is resolved from `GITHUB_EVENT_NAME`, a GitHub Actions default
  environment variable exported into every step, so a reusable workflow does not
  have to forward it. The branch is fail-closed: anything not recognisably a
  pull-request event, including an unset variable, takes the strict path, so a
  missing variable can only make the gate harsher, never green. The generated
  config prints the policy it resolved (`[e2e] flake policy: ...`) once per run,
  from the runner process only, so which policy a run used is readable in the
  log instead of inferred.

  The scaffolded `docs/e2e-testing.md` gains a matching **Flake policy** section
  and a **Quarantine convention**:
  `test.fixme(<condition>, '<repo>#<issue> -- <YYYY-MM-DD> -- <owner>')`, why it
  is `fixme` rather than `skip`, and how a test leaves quarantine. A scaffold
  that ships `failOnFlakyTests` without telling anyone how to quarantine a flake
  teaches exactly the retry-hides-it habit the policy exists to end.

  `@narduk-enterprises/narduk-testkit` exports fixtures, contracts and
  UI-quality helpers but no Playwright config preset — there is no
  `defineConfig` in its source and no `./playwright/config` export — so the
  generator's scaffold is the only place in this repository that can own this
  policy today. Existing apps carry it in their own `playwright.config.ts`.

- b59907e: The scaffolded no-seo `nuxt.config.ts` head drops its `twitter:card`
  and `twitter:image` meta entries and keeps the full Open Graph set, including
  `og:image:width` / `og:image:height`. A fresh app therefore starts clean
  against the shared browser-console contract instead of emitting tags Unhead 3
  reports as deprecated (narduk-libs#349).
- 119042d: Move the optional `@opentelemetry/*` peer and dev ranges from the
  0.208 / 2.x-early line to `^0.222.0` / `^2.11.0`.

  The experimental `0.2xx` packages pin their stable siblings exactly, so
  `^0.208.0` forced `@opentelemetry/core@2.2.0` on every consumer that opts into
  the OTLP sink. That version carries GHSA-8988-4f7v-96qf (unbounded memory
  allocation in W3C Baggage propagation, medium), first fixed in
  `@opentelemetry/core@2.8.0`. `@opentelemetry/sdk-logs@0.219.0` is the first
  experimental release pinning `2.8.0`; `0.222.0` is the current matched line
  and resolves `@opentelemetry/core@2.11.0`.

  The generator is released alongside it because its manifest hard-codes the
  exact pins of the packages this release moves.

  The peers stay optional, so a consumer that never calls `createOtlpSink` is
  unaffected. The sink's API surface — `LoggerProvider({ processors })`,
  `OTLPLogExporter`, `SeverityNumber`, `ReadableLogRecord` — is unchanged across
  the move.

- 39c28ff: Raise the `sharp` runtime dependency from `^0.34.5` to `^0.35.4` in
  `narduk-app-tools` and `narduk-testkit`, and release the generator so its
  hard-coded pins for both packages move with them.

  `sharp` is a published runtime `dependencies` entry in both packages, so the
  fix only reaches consumers through a release. `0.35.4` closes two
  high-severity inherited advisories: GHSA-f88m-g3jw-g9cj (libvips
  CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591, fixed in
  0.35.0) and GHSA-rgj7-g3m4-5g8c (libheif GHSA-g89c-p67h-r497 and
  GHSA-2jg2-4ch7-h545, fixed in 0.35.4).

  `sharp@0.35` raises its Node floor to `>=20.9.0` and drops the `install`
  script, so a platform without a prebuilt `@img/sharp-*` binary must now fall
  back to WebAssembly or build libvips by hand. Neither package declares
  `engines`, and the estate runs Node 24, so no supported consumer loses a
  platform. The call sites — `metadata()`, `stats()`, `resize()`, `toFormat()`,
  `ensureAlpha().raw()`, `failOn` and `limitInputPixels` — are unchanged in
  0.35.x; the removed `failOnError` and `paletteBitDepth` APIs were never used.

## 0.6.3

### Patch Changes

- fc816c4: `foundation:check` sub-check 2.3 (narduk-core N-1 window) now raises
  the default registry-read timeout from 4000 ms to 20000 ms, overridable via
  `NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS`, and retries up to twice with backoff
  on timeout/network-error/5xx responses only -- never on 401/403/404. This
  fixes false-`unknown` (blocking) results on the on-prem runner's slow GitHub
  path (narduk-libs#341). Fail-closed semantics are unchanged: a genuinely
  unreachable registry still reports `unknown` after exhausting the retry
  budget.

  `@narduk-enterprises/create-narduk-app` gets a patch release alongside this to
  refresh its `narduk-app-tools` pin in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version); no generator behavior changes.

- 1cda2f5: Update the generator's pinned `@narduk-enterprises/narduk-testkit`
  version to the release that blocks, rather than empty-fulfils, optional
  telemetry in the console tracker's stub profile.

## 0.6.2

### Patch Changes

- 1fe3dde: Update the generator's pinned `@narduk-enterprises/narduk-testkit`
  version to the release that adds the console tracker's deterministic telemetry
  profile. Generated apps keep today's behavior: the profile is opt-in and the
  default stays `'live'`.

## 0.6.1

### Patch Changes

- 76aba10: Retire branding-based status-app classification. Keep subcheck 3.4 as
  explicitly not-applicable and continue checking actual web capabilities.
  Legacy status-runtime consumers remain supported; new apps do not need that
  package.

## 0.6.0

### Minor Changes

- 26c8d05: Scaffold apps with no database.

  `--no-database` (or `--database=none`, or `databaseBackend: 'none'` through
  the API) generates an app that declares
  `nardukCore: { databaseBackend: 'none' }`, so narduk-core's shared
  `/api/health` reports `database: "not_applicable"` and stays `ok` rather than
  degrading a publication-only app.

  - No D1 binding in `wrangler.jsonc`, no `server/database/schema.ts`, no
    `#narduk-db` alias, no `drizzle/` migrations and no
    `migrations.sources.json`.
  - No `db:migrate:local` / `db:migrate:remote` scripts, and `cf:deploy` deploys
    without a migration step.
  - `drizzle-orm` and `drizzle-kit` are left out of the generated manifests.
  - The `auth` capability is rejected with no database, because sign-in stores
    users, sessions and API keys in the app database.
  - The JSON report records the resolved `databaseBackend`.

  The default stays D1, and a D1 scaffold is byte-identical to the previous
  release.

### Patch Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.

- 8abb3c8: Update the generator's pinned `@narduk-enterprises/*` versions to the
  coordinated release that ships narduk-core 2 (Pinia 4 and `@pinia/nuxt` 1).
  Generated apps do not list `pinia` directly, so the generator's behavior does
  not change beyond the new pins.
- 8abb3c8: Run generated app CI on Node 24.21.0 and emit matching `.nvmrc`,
  `engines.node` and Volta declarations from one constant. This matches the Node
  24 minimum the shared ESLint configuration already requires. Correct that
  package's stale Node 22 documentation. The repository's own CI, release jobs
  and root runtime pin also move to Node 24.21.0; package JavaScript output
  targets retain their existing compatibility range.
- 8abb3c8: Retire the implicit Doppler execution in `narduk-app dev`
  (narduk-libs#321).

  **Breaking for existing callers of `narduk-app dev`.** The command used to run
  every child through `doppler run`, with `--project` / `--config` selecting a
  Doppler project and config — an implicit dependency on the retired app-secret
  store. It now runs one child process through an explicit credential route:

  - no `--credentials` (the default) runs the child directly, so an app whose
    local development needs no secrets has no secret-store dependency at all;
  - `--credentials nvault` requires a complete `--project` / `--environment` /
    `--config` selector and runs
    `nvault run -p <project> -e <environment> -c <config> -- <command>`, the
    registered local credential route, whose values stay process-local
    (company-hq `docs/SECRETS-MATRIX.md`, plane 4);
  - `--dry-run` prints the resolved command without running it.

  The retired invocation
  `narduk-app dev --project <app> --config dev -- <command>` now fails with a
  message naming both replacements, rather than silently starting a dev server
  without the environment it used to receive. `--credentials doppler` fails the
  same way. Doppler `ne/*` root provisioners remain a separately approved
  provider-root exception and are not an application development credential
  source.

  The exported `buildDopplerRunArgs` is replaced by `buildNvaultRunArgs`,
  `buildDevInvocation` and `formatDevInvocation`.

  Generated apps start Nuxt directly: the web `dev` script is now
  `nuxt dev --host 127.0.0.1`, and the generated README documents the nvault
  route an app adopts when it later needs credentials locally.
  `narduk-app deploy-local` is a different command and still reads Doppler
  `narduk/tokens`; it is unchanged.

- 8abb3c8: Stop overriding `nuxt-og-image` to 6.7.2 in generated SEO apps, so
  they use the release that `@narduk-enterprises/narduk-seo` pins. New apps now
  pin Nuxt 4.5.2, which supplies Unhead 3 for that module set's
  `treeShakeUseSeoMeta` transform, and Tailwind 4.3.2, whose Vite plugin
  supports Nuxt 4.5's Vite 8.

  Run the generated browser-test server with Nuxt's `TEST` flag so it excludes
  the interactive DevTools module. Normal `dev` keeps DevTools available.

## 0.5.2

### Patch Changes

- 2e9d424: Pin the narduk-core and narduk-auth releases that add
  `databaseBackend: 'none'` and registered health checks.

## 0.5.1

### Patch Changes

- 994551d: Read only the parsed HTML head during social-preview crawler checks,
  retaining the head byte limit and all metadata checks without downloading
  unrelated SSR payloads.

## 0.5.0

### Minor Changes

- 6d7d26d: Make Workers Builds preview exposure explicit and independent of
  repository visibility. Public apps receive workers.dev and version-preview
  defaults; authenticated apps keep both closed. Generated SEO and runtime
  configuration mark branch builds as previews, and onboarding documents the
  required Git connection and binding isolation.

## 0.4.1

### Patch Changes

- 45ff93c: Refresh the generator's pinned `@narduk-enterprises/narduk-shell`
  version to pick up the package-root import-protection fix (narduk-libs#295).
  No generator behavior changes beyond the pinned version bump.

## 0.4.0

### Minor Changes

- 3578eef: Scaffold a `.github/dependabot.yml` with one Dependabot group
  (`narduk-libs`, patterns `@narduk-enterprises/*`) using
  `directories: ['/', '/apps/*']` so the update covers the root lockfile and the
  `apps/web` manifest that holds the estate pins (components-library-plan.md §2
  item 6, narduk-libs#253). Generated apps now carry one bot config:
  `renovate.json` is no longer scaffolded (D-TOOLCHAIN-1 prefers Dependabot;
  item 5.2 already accepts either). `@narduk-enterprises/narduk-auth` is dropped
  from `pnpm.overrides`: nothing in the estate depends on narduk-auth, so the
  override could never collapse a second copy, and Dependabot does not update
  that field. The estate overrides that ARE load-bearing are covered in a
  separate changeset. The registries block reads the org-level Dependabot secret
  `NARDUK_PLATFORM_GH_PACKAGES_READ`. A live Dependabot run against a generated
  app is not possible from the PR VM; empirical proof is a follow-up.
- 1a7a036: Generator: lint packs and narduk-shell by default
  (components-library-plan.md §2 item 4, narduk-libs#251).

  - Adds the `design-system` and `nuxt-ui` capability packs to the four already
    hardcoded (`core`, `correctness`, `complexity`, `formatting`) in both
    `apps/web/eslint.config.mjs` (`createAppLintConfig`) and the root
    `eslint.config.mjs` (`composeSharedConfigs`), so every new app starts on the
    Nuxt UI element discipline, the Tailwind v4 token tier, and the three
    legacy-API guardrails from day one.
  - `@narduk-enterprises/narduk-shell` joins the default module list
    (`nuxt.config.ts`) and the default runtime `dependencies`, unconditionally
    and not behind a capability flag — the same way narduk-core always ships —
    with an exact pin. The pin is `0.0.0`: narduk-shell has never been published
    (item 1 shipped the skeleton without a release, and every wave-2 component
    item since has left its changeset unconsumed), and the pin has to equal the
    package's live on-disk version for `versions:check`, not a preview of its
    next release.
  - Adds a `charts` capability that pins `@narduk-enterprises/narduk-charts`,
    the one existing capability package that is not itself a Nuxt module (no
    `nuxt` peer, no `module.ts`) — it is excluded from the generated
    `modules: [...]` array for that reason, and added to the generated app's
    `knip.json` `ignoreDependencies` because nothing in the scaffold imports
    from it directly yet.
  - Extends the narduk-libs `packed-consumer-smoke` fixture
    (`scripts/release-packages.mjs`) so the generated release-smoke app renders
    `<NeStatusBadge>` alongside `LayerAppHeader`, and asserts its label is
    visible in a real browser via Playwright — proof that the packed
    narduk-shell tarball registers and renders a component, not just that
    `nuxt build` succeeds. `@narduk-enterprises/narduk-shell` is added to
    `assertExactGeneratedPackagePins`'s required-package set alongside the other
    always-shipped packages.

  No override entry is added to the generated app's `pnpm.overrides` for
  narduk-shell: it has no runtime `@narduk-enterprises/*` dependency of its own,
  and nothing else in the workspace ships it as a `workspace:` **runtime**
  dependency today (`design-system-build` depends on it only as a devDependency,
  which `tests/workspace-override-safety.test.ts` deliberately excludes) — so
  there is no second copy an override could collapse.

- 09b35f7: Generated apps collapse every workspace-published estate pin, and run
  `foundation:check:shared-ui-pinned` (narduk-libs#282 review).

  - **`pnpm.overrides` regains `@narduk-enterprises/narduk-core` and gains
    `narduk-logging`, `narduk-platform` (always) and `narduk-mapkit` (mapkit
    capability).** pnpm replaces a `workspace:` specifier with the _exact_
    version of that workspace package at publish time, so a published estate
    package carries a hard pin on whatever its sibling's version was that day.
    Two different exact pins on one package in one tree is two installed copies
    — for a Nuxt module two registrations and two `useRuntimeConfig` namespaces,
    for a contracts package two copies of the zod schemas its consumers are
    supposed to share. Two shapes produce that second pin: **one publisher plus
    the app's own direct pin** (`narduk-core` ships
    `narduk-logging: workspace:*`; `narduk-mapkit-nuxt` ships
    `narduk-mapkit: workspace:*`), and **two or more publishers with no direct
    pin at all** — `narduk-platform` is a runtime `workspace:*` dependency of
    `narduk-core`, `narduk-ai` _and_ `narduk-auth` while a generated app names
    it nowhere. `narduk-core` is both at once (four publishers and a direct
    pin). A package with one publisher and no direct pin needs no override and
    gets none, which is why `narduk-app` (shipped by `narduk-auth` alone) is
    absent; `@narduk-enterprises/narduk-auth` is absent because nothing in the
    estate depends on it, so its override was inert. The accepted cost is that
    Dependabot does not update `pnpm.overrides`, so a grouped bump resolves back
    to the override until it is bumped by hand: a stale single copy is
    recoverable, two live copies are not. An override also asserts the estate is
    mutually compatible at the pinned versions; `versions:sync` keeps those pins
    on the workspace versions, which is the set built and tested together. A new
    test derives the whole set from the live workspace manifests — publishers
    counted over the installed closure, direct pins intersected, devDependency
    edges excluded because a published package's devDependencies are never
    installed by its consumers — so a new `workspace:` edge cannot reopen the
    hole silently.
  - **New scripts `foundation:shared-ui-pinned` (root and `apps/web`), wired
    into `quality:static`.** The command reads manifests only and needs no
    registry credential, so it runs where the generated install step has already
    dropped the GitHub Packages token. narduk-libs' own `packed-consumer-smoke`
    job expands the generated `quality` chain, so the check also runs against a
    really-installed generated app on every narduk-libs PR. The generated CI for
    a **private** app calls the shared `nuxt-cloudflare.yml` workflow rather
    than `quality:static`, so `foundation:shared-ui-pinned` is named in its
    `extra-scripts` too — otherwise that half of the fleet would ship the script
    and never run it.

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

### Patch Changes

- 699b5da: Refresh the generator's pinned `@narduk-enterprises/narduk-auth`
  version so new apps pick up the Auth* suite-bar docs and tests. No generator
  behavior changes beyond the pinned version bump.
- 54577ac: Refresh the generator's pinned `@narduk-enterprises/narduk-core`
  version to pick up the `getClientIp` export (`server/utils/client-ip`). No
  generator behavior changes beyond the pinned version bump.
- 837c1eb: Refresh the generator's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps pick up the
  AppMapKit suite-bar docs and tests. No generator behavior changes beyond the
  pinned version bump.

## 0.3.7

### Patch Changes

- 3c0a608: Refresh the generator's pinned `@narduk-enterprises/narduk-app-tools`
  version to pick up item 5.2's `.github/dependabot.yml` acceptance
  (narduk-libs#233). No generator behavior changes beyond the pinned version
  bump.

## 0.3.6

### Patch Changes

- b69913a: Bump the package's own toolchain to the estate baseline (company-hq
  D-TOOLCHAIN-1, 2026-09-10): `typescript` `~6.0.3` (was `^5.9.3`),
  `@types/node` `^24` (was `^22.19.19`), and every `@typescript-eslint/*` plus
  `typescript-eslint` dependency to `^8.70.0` (was `^8.65.0`). `engines.node`
  moves to `>=24.0.0`.

  No public API or config-output change. `tsconfig.json` gains
  `"ignoreDeprecations": "6.0"` because `tsup@8.5.1` injects a deprecated
  `baseUrl` into its own DTS build program under TypeScript 6 regardless of this
  package's own tsconfig (TS5101); `"types": ["node"]` was already present, so
  the TS6 Node-builtins issue (TS2591) that the same migration hit on the
  superseded v1 `narduk-eslint-config` line did not recur here.

  Consumers pinning `engines.node: >=24.0.0` on install must be on Node 24;
  anyone still on Node 22 who picks up this version will hit
  `ERR_PNPM_UNSUPPORTED_ENGINE` (a warning under this repo's default
  `engine-strict: false`, but a hard failure under a consumer's own
  strict-engine setting).

  `create-narduk-app` is a generator-owned package whose `src/manifest.ts`
  hardcodes the exact `@narduk-enterprises/eslint-config` version newly
  scaffolded apps pin (`scripts/sync-generator-package-versions.mjs` keeps it in
  sync with each package's own `package.json` version at release time).
  Releasing eslint-config `2.0.2` without a matching create-narduk-app release
  would leave that pin stale, so this changeset bumps create-narduk-app too -- a
  metadata/version sync only. No source, template, or toolchain change to
  create-narduk-app itself; it still targets TypeScript 5.9/Node 22 and is
  unrelated Wave 1 work.

## 0.3.5

### Patch Changes

- d66fe65: Release the app generator with the updated analytics package pin.

## 0.3.4

### Patch Changes

- 05515cd: Add the required `mapkit_js` scope to dynamically signed MapKit JS
  tokens so Apple accepts the token at its JavaScript bootstrap endpoint.

## 0.3.3

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- 37c03e2: Publish the server-only module package Nuxt config fragment once as
  `@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
  from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/`
  tree and sets no explicit `srcDir` keeps the package root as srcDir, so
  `nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
  sources of `@narduk-enterprises/eslint-config` into the type project
  (narduk-libs#176).

  Pin `create-narduk-app`'s own `prettier` devDependency to the one workspace
  version (`3.9.4`). Its published manifest declared the exact `3.8.3`, so a
  consumer installing it from the packed artifact — outside the workspace where
  `pnpm.overrides` applies — resolved a prettier that formats a multi-member
  union differently from CI, re-creating narduk-libs#175 one hop out.

## 0.3.2

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.

## 0.3.1

### Patch Changes

- 1cdd600: Run the generator when its CLI path contains spaces or resolves
  through a symlink, including macOS `/tmp`. Keep programmatic imports inert.

## 0.3.0

### Minor Changes

- 6297a08: Route core logging through the shared Narduk Logging package while
  retaining old imports, calls, scopes and legacy verbosity. New generated apps
  configure service identity, info-level logging and request completion
  summaries explicitly.

## 0.2.9

### Patch Changes

- 6197f80: Refresh generated app manifests alongside the upcoming shared runtime
  releases so their package pins include the new core media-CSP support.
- 1b3e90f: Regenerate application dependency pins for the media CSP release of
  narduk-core and its dependent packages.

## 0.2.8

### Patch Changes

- b342b11: Generate three Chromium shards for private and public apps. Require
  public static checks, browser shards and merged reports to succeed; retain
  failure screenshots and videos alongside retry traces. Preserve the pinned
  shared workflow and separated private runner routes introduced in #181.
- 48e71ca: Add opt-in browser authorization for native clients using one-time
  S256 PKCE codes, rotating opaque credentials, and revocable D1 sessions.
  Persist optional local email verification proof for consumers that bind
  invitations to verified addresses. Existing consumers retain their current
  behavior until enabling the features after applying the additive migration.

## 0.2.7

### Patch Changes

- ef064f2: Generate pinned CI with bounded concurrency and timeouts. Private
  apps use the shared Nuxt workflow with separate Linux and isolated-browser
  routes; public apps remain GitHub-hosted. Preserve every quality gate and
  clean temporary registry auth.

## 0.2.6

### Patch Changes

- 8b11738: Fix three generated-app defects that made a fresh scaffold fail its
  own quality gate (narduk-libs#172 and siblings).

  - `apps/web/nuxt.config.ts` emitted a `site: { name, url }` block for every
    capability set, but `site` is a nuxt-site-config key that only reaches the
    app through `@nuxtjs/seo`. A core-only or auth-only scaffold failed
    `nuxt typecheck` with TS2353 on its first run. The block, and the
    `routeRules` prerender entry beside it, are now emitted only for the `seo`
    capability.
  - The committed `.npmrc` carried
    `//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}`. pnpm 10 warns
    `Failed to replace env in config` whenever the variable is absent and pnpm
    11 does not expand environment variables in a project `.npmrc` at all, so
    the line is now dropped entirely: the committed file is scope routing only.
    The generated CI workflow instead writes the org secret to a `umask 077`
    userconfig under `$RUNNER_TEMP` and points `NPM_CONFIG_USERCONFIG` at it for
    the install step alone. The generated README documents that path and no
    longer mentions the retired Doppler fallback.
  - New `apps/web/server/tsconfig.json` extending
    `../.nuxt/tsconfig.server.json`. The shared eslint config's type-aware pack
    resolves each file through the nearest `tsconfig.json`, and
    `apps/web/tsconfig.json` extends `.nuxt/tsconfig.json`, whose `include`
    excludes `server/**` — so the first server directory an app added
    (`server/durable/`, `server/tasks/`, ...) failed lint with "was not found by
    the project service".

## 0.2.5

### Patch Changes

- 46c9165: Restrict self-serve password links to requests whose origin matches a
  configured loopback app URL. Public deployments fail before issuing a token
  when the development shortcut is enabled. Local Nuxt and Wrangler fixtures
  remain supported.

## 0.2.4

### Patch Changes

- 5e35fae: Generated auth-capable apps now carry
  `pnpm.peerDependencyRules.allowAny` for `@simplewebauthn/browser` and
  `@simplewebauthn/server`.

  narduk-core depends on `nuxt-auth-utils`, whose **optional** passkey helpers
  still declare `@simplewebauthn/*@^11` — a range upstream has not moved
  since 2024. narduk-auth implements WebAuthn itself against its own
  exact-pinned v13 and never calls those helpers, so the two versions never meet
  at runtime. Without this rule, every auth-capable app's first `pnpm install`
  reports an unmet peer for a feature it does not use.

  This also releases the generator alongside the narduk-auth minor so its pinned
  `@narduk-enterprises/narduk-auth` version moves with it
  (`scripts/check-generator-release-plan.mjs`).

## 0.2.3

### Patch Changes

- fbc9504: Bump the generated app's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps scaffold onto the
  release that actually fixes the package's publish-time build (the prior pin
  bump shipped alongside a version that failed to publish).

## 0.2.2

### Patch Changes

- 8b48dba: Companion release for the narduk-core patch that moves
  `@narduk-enterprises/eslint-config` from a runtime dependency to an optional
  peerDependency (narduk-libs#154). No generator behavior change; this bumps the
  generator alongside its pinned `@narduk-enterprises/narduk-core` version per
  `scripts/check-generator-release-plan.mjs`.
- 74ca377: Bump the generated app's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps scaffold onto the
  release that fixes the package's publish-time build.
- cc5bbbb: Release alongside the `narduk-app` minor bump (the new HTTP error +
  requestBody contract). `@narduk-enterprises/narduk-auth` depends on
  `@narduk-enterprises/narduk-app` via `workspace:*`, so Changesets'
  `updateInternalDependencies: "patch"` policy cascades a patch release to
  narduk-auth — which is itself a generator-owned pinned package
  (`create-narduk-app`'s `PACKAGE_VERSIONS`). This keeps the generator's pin in
  sync with that cascaded release. No behavior change in the generator itself.
- 0f2262a: Release alongside the `narduk-core` minor bump
  (`readApproximateLocation`) so the generator's `PACKAGE_VERSIONS` pin for that
  package ships at the version it is synced to. `create-narduk-app` writes that
  pin verbatim into every scaffolded app's `package.json`, so a release that
  moves the pinned package without republishing the generator leaves new apps
  pinned to a version the generator no longer names. No behavior change in the
  generator itself.
- 1721a1c: Pick up the `@narduk-enterprises/narduk-auth` minor release (opt-in
  `AUTH_LOCAL_PROVIDERS` advertisement for the local auth backend) in the
  generator's pinned package versions. No generator behavior changes.

## 0.2.1

### Patch Changes

- ee7452c: Bump the generated app's pinned `@narduk-enterprises/narduk-auth`
  version so new apps scaffold onto the release that consolidates the package's
  same-origin redirect guards.
- e5a0b33: Release alongside the `narduk-mapkit` / `narduk-mapkit-nuxt` patch
  bumps so the generator's `PACKAGE_VERSIONS` pins for those two packages ship
  at the versions they are synced to. `create-narduk-app` writes those pins
  verbatim into every scaffolded app's `package.json`, so a release that moves
  the pinned packages without republishing the generator leaves new apps pinned
  to a version the generator no longer names. No behaviour change in the
  generator itself.
- 927f7e3: create-narduk-app: pick up the `@narduk-enterprises/narduk-app-tools`
  minor release (`foundation:check`, D-WEBFOUND-2 Q5(a)/Q9(a)) so a freshly
  scaffolded app pins the version that ships the new command. No generator
  behavior changes; this is the release-plan companion changeset required
  whenever a generator-owned package pin moves (company-hq#628).
- d6e098e: Make the scaffolded `playwright.config.ts` port overridable via
  `PLAYWRIGHT_PORT`, flowing into `baseURL`, the `webServer` url, and the
  `webServer` command's `PORT` env. Previously the port was a fixed literal, so
  when two or more agent lanes (or a lane plus the developer) worked the same
  generated repo concurrently in separate worktrees, the second Playwright run
  would silently attach to the first lane's dev server and test the wrong build
  — with a green result (narduk-libs#62).

## 0.2.0

### Minor Changes

- 0fd5ee9: create-narduk-app: fix the `mapkit` capability to scaffold the live
  `@narduk-enterprises/narduk-mapkit` / `@narduk-enterprises/narduk-mapkit-nuxt`
  packages at `2.0.0` instead of the dead `@narduk-geo/narduk-mapkit*` scope
  pinned at `1.0.0` (narduk-libs#123). The `@narduk-geo` scope has not published
  since 1.1.1 and cannot publish again (narduk-mapkit#17); narduk-mapkit
  republished under `@narduk-enterprises` at `2.0.0` on 2026-08-28. A freshly
  scaffolded mapkit app previously installed a frozen, unpatchable dependency
  from a scope that no longer resolves for new consumers.

  The generated `.npmrc` now routes only `@narduk-enterprises/*` to GitHub
  Packages — the `@narduk-geo:registry=...` line is dropped, since every scoped
  package a generated app depends on now lives under `@narduk-enterprises`. The
  generated README note and the generated Renovate `matchPackageNames` group are
  updated to match.

### Patch Changes

- 7883246: create-narduk-app: stop scaffolding a health-check stub that shadows
  narduk-core's real one.

  Every generated app includes `@narduk-enterprises/narduk-core` as an implicit
  module (`moduleList()`), which registers a real DB-probing `/api/health` route
  via `addServerScanDir`. The generator also wrote an app-local
  `apps/web/server/api/health.get.ts` returning a trivial `{ ok: true }` stub —
  Nitro resolves an app-local `server/api/*` route before a module's scanned
  contribution with the same path, so every scaffolded app silently lost the
  real auth-table/D1/Postgres health check behind a stub that always says OK
  (company-hq#453 R4 audit finding). The generator no longer emits that file;
  narduk-core's own health route is now what a generated app actually serves.
  Patch: removes generated output only, no exported API changed.

## 0.1.15

### Patch Changes

- db8b0de: Generate the committed `.npmrc` auth line in the plain
  `${GH_PACKAGES_READ}` interpolation form.

  npm does not implement `${VAR-default}` substitution: it leaves the whole
  reference unsubstituted and sends the literal string as the token, so the
  generated `${GH_PACKAGES_READ-UNCONFIGURED}` line returned
  `401 ... cannot be authenticated with the token provided` even when the
  variable was set correctly. pnpm does implement the default form, which is how
  the shape passed review twice -- the estate tests on pnpm. A committed file
  has to work under whichever client runs it, so the plain form is the only
  correct one. The generator test pinned the broken string, asserting the defect
  rather than catching it; it now pins the plain form.

  Closes #93.

## 0.1.14

### Patch Changes

- 6575caf: Refresh the generated app's `@narduk-enterprises/narduk-testkit` pin
  to the release that adds the deterministic-capture, request-accounting and
  fixture-server subpaths. Generator behaviour is unchanged; this is the pin
  refresh `release-plan:check` requires when a generator-owned package version
  moves.

## 0.1.13

### Patch Changes

- 71340c8: Generate one packages-read credential name instead of three. The
  generated CI no longer sets a redundant `NODE_AUTH_TOKEN` alias, and no longer
  gives `actions/setup-node` the `registry-url`/`scope` inputs that made it
  write a competing userconfig `.npmrc` against that alias with
  `always-auth=true`. The committed `.npmrc` already routes both scopes and
  reads `GH_PACKAGES_READ`, so CI now maps the org secret into that single name.
  The generated README states both halves of the pair.

## 0.1.12

### Patch Changes

- 1d017c7: Persist sealed user-session cookies for 30 days by default so mobile
  browsers do not discard authentication when the browser is backgrounded or
  reclaimed. Callers can still provide a shorter or longer `maxAge` override.

## 0.1.11

### Patch Changes

- fa7670b: Render provider-aware login copy so email-only applications do not
  advertise Sign in with Apple.

## 0.1.10

### Patch Changes

- 8adb1ec: Add an opt-in local email/password setup and recovery pathway
  informed by the reusable PACC TRAC and Harvest Tracker patterns: digest-only,
  email-bound, single-use links; explicit redemption; safe local redirects;
  generic request responses; and persistent lockout. This is additive to local
  auth, leaves the Supabase pathway unchanged, and explicitly does not replace
  or bypass Cloudflare Access as an app's outer gate.

## 0.1.9

### Patch Changes

- 048670e: Track the @narduk-enterprises/eslint-config patch (the Tailwind theme
  override now requires the design-system capability pack) in generator-owned
  package pins.

## 0.1.8

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

## 0.1.7

### Patch Changes

- d22cd3d: Import Nuxt runtime helpers explicitly in packaged analytics plugins
  so consumer builds hydrate without relying on ambient package-source
  auto-import transforms.

## 0.1.6

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 0.1.5

### Patch Changes

- 256c696: seo: make the Narduk network directory endpoint injectable with no
  default

  The network directory endpoint is now supplied by the consuming app through
  `nardukSeo.networkDirectoryUrl` (or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
  at runtime) and has **no built-in default**. When it is unset the feature
  disables itself: `/api/narduk-network/sites` performs no outbound fetch,
  `useNardukNetworkDirectory()` skips its request, `/narduk-network` renders an
  empty directory, and `LayerNetworkFooter` omits the directory link. Failing
  quiet is deliberate — the directory is a marketing cross-link surface, not a
  gate.

  Previously the endpoint was derived from a package-owned catalog hostname, so
  every app installing this package polled a host it never chose. A published
  library must not pin its consumers to one origin.

  BREAKING CHANGES:

  - `NARDUK_DEFAULT_CATALOG_BASE_URL` is no longer exported.
  - `resolveNardukNetworkDirectoryUrl(value)` now takes the full directory URL
    (not a catalog base URL) and returns `null | string` instead of `string`.
  - `resolveNardukCatalogBaseUrl(value)` returns `null | string` instead of
    falling back to a hardcoded hostname.
  - `/api/narduk-network/sites` responses gained `configured: boolean`, and
    `catalogUrl` / `directoryUrl` may now be `null`.
  - Apps that want `/narduk-network` populated must set the new option;
    upgrading without setting it turns the directory off rather than repointing
    it.

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

## 0.1.4

### Patch Changes

- 0783806: Track the @narduk-enterprises/narduk-seo minor (host-aware runtime
  indexing) in generator-owned package pins.
- 0783806: Restore a warning-free packed consumer install after upstream Nuxt
  4.5 drift.

  `nuxt-og-image` moves from 6.7.2 to 6.7.4. 6.7.2 pinned `oxc-parser@^0.138.0`,
  which cannot satisfy the `oxc-parser@>=0.140.0` optional peer that `unctx@3`
  declares once `@nuxt/kit@4.5.0` is resolved, so a Nuxt-less external consumer
  install emitted an unmet-peer warning.

  The generated app now pins `@nuxt/kit` to its exact `nuxt` version, and pins
  `nuxt-og-image` to the 6.7.2 release built for that `@nuxt/kit`. The generator
  pins `nuxt` exactly while the Narduk modules depend on `@nuxt/kit@^4.0.0`, so
  before this the app resolved a `@nuxt/kit` newer than its own `nuxt` as soon
  as upstream published a Nuxt minor, and inherited that kit's transitive
  dependency block instead of the one its pinned Nuxt was built with.

## 0.1.3

### Patch Changes

- a783f18: Ignore stale package-manager entrypoints and fall back to the
  executable installed in `PNPM_HOME`, keeping repeated migration runs
  independent of `PATH`.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.2

### Patch Changes

- 435cc56: Run Wrangler through the package manager entrypoint that launched
  `narduk-app`, avoiding PATH-dependent migration failures on repeated CI
  invocations.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.1

### Patch Changes

- 7848187: Publish the generator with the exact neutralized package versions
  produced by this release.
