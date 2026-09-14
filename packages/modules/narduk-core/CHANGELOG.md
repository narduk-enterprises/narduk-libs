# @narduk-enterprises/narduk-core

## 1.24.0

### Minor Changes

- 54577ac: Export `getClientIp` from `server/utils/client-ip` so consuming apps
  attribute rate limits, lockouts and audit rows to the same address the layer's
  own rate limiter uses, instead of re-implementing it (or, as mybo-at-v2#30
  did, reaching for h3's `getRequestIP`, which never reads `cf-connecting-ip`
  and with `xForwardedFor: true` trusts the first forwarded entry — the one
  Cloudflare leaves as the client wrote it).

  Order: `cf-connecting-ip`, then the first `x-forwarded-for` entry **only when
  `trustForwardedFor` is set**, then h3's own view of the socket. `rateLimit.ts`
  now calls it with `trustForwardedFor: true` so its behaviour is unchanged; new
  consumers get the safe default.

- 0f45d4b: Add the shared list-query contract and its h3 helpers, so every list
  route in the estate parses the same query shape and answers with the same
  response shape.

  **narduk-platform** gains a new `./list-query` subpath (also re-exported from
  the package root, matching the package's convention):

  - `listQuerySchema({ sortable, filters, maxLimit, mode, defaultLimit, defaultSort, maxQueryLength, searchable, strict })`
    builds a zod object accepting `limit` (positive integer, clamped to
    `maxLimit`), `sort` as `'<key>:<asc|desc>'` with the key drawn from
    `sortable`, `q` (trimmed, length-bounded, `null` when blank), the caller's
    own `filters` object flat on the query string, and either `offset` (integer
    ≥ 0) in `mode: 'offset'` or `cursor` (opaque non-empty string) in
    `mode: 'cursor'`.
  - `LIST_QUERY_STATEMENT_CEILING` is 2 (one page `SELECT` plus one optional
    `COUNT(*)`). The schema cannot count SQL; route tests that wrap the D1
    binding enforce the ceiling.
  - An unknown key is never silently **stripped**. A typo'd or renamed parameter
    that reads as "no filter" is the riverstatus bug class this contract exists
    to close: the page silently came back unfiltered. By default the key is
    **tolerated**: the request still succeeds and the ignored key comes back on
    `unknownKeys` (see the tolerate-and-warn amendment below); pass
    `strict: true` to reject it outright with a 400.
  - `searchable: false` closes the same hole from the other side: a route that
    does not implement free-text search rejects a non-empty `q` instead of
    accepting it and quietly returning an unnarrowed page.
  - `ListQuery<TFilters, TKey>` and `ListResponse<TItem, TMode>` —
    `{ items, total: number | null, limit, sort, q }` plus `offset` or
    `nextCursor` — with `formatListSort()` rendering the parsed sort back to its
    wire form.
  - `zod` is now a runtime dependency of narduk-platform, at the same `^4.4.3`
    range narduk-core uses.

  **narduk-core** gains `server/utils/listQuery`:

  - `parseListQuery(event, options)` reads the h3 event's query, validates it
    through the narduk-platform schema, and on failure (a bad value for a
    declared key, or any unknown key when `strict: true`) throws `createError`
    with **400** (never a 500) and a stable machine-readable `data` payload —
    `{ code: 'invalid_list_query', fields, issues, unknownKeys }` — naming the
    offending keys and fields. When an unknown key is tolerated instead, it logs
    one structured warning per request naming it.
  - `listResponse(items, { total, query, nextCursor })` builds the matching
    `ListResponse`, echoing the query's `limit`, `sort` and `q`.
  - Both are documented under "List routes: parseListQuery + listResponse" in
    the narduk-core README and in narduk-platform's new README.

  **Amendment (tolerate-and-warn, Logan 2026-09-11):** an unknown query key
  shipping as a rejected 400 by default was compatibility-narrowing for live
  fleet callers, not an approved breaking change. `strict` now defaults to
  `false` — an unknown key is tolerated and warned on, not rejected — for one
  release; the next major flips the default to `true`. See
  `.changeset/list-query-tolerate-unknown-keys.md`.

  Refs narduk-libs#247.

### Patch Changes

- 548fa01: Deprecate `AppEmptyState`; it is removed in the next major.

  Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
  (narduk-libs#254, components-library backlog item 7; standing decision D4,
  Logan 2026-09-11: "Deprecate, remove next major").

  `AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
  **zero**, which is the distinction its callers actually need and the bug class
  behind operator-portal#183, #162, #100 and #21. `NeStatePanel` carries five
  readings — `empty`, `loading`, `error`, `blocked`, `absent` — gives each the
  right ARIA role by construction, and never signals the reading with colour
  alone.

  The empty-state markup, props and rendered output are unchanged, so nothing
  breaks on this release. A one-time, dev-only `console.warn` points at
  `NeStatePanel`; production stays silent. The `@deprecated` JSDoc and the
  README section carry the one-for-one migration mapping (`description` becomes
  `message`, the default slot becomes `#action`, and the panel takes an explicit
  `state="empty"`).

- 960479a: Amend the `AppEmptyState` and `AppConfirmModal` deprecation warnings
  to say their `@narduk-enterprises/narduk-shell` replacements (`NeStatePanel`,
  `NeConfirmDialog` / `useConfirm()`) are currently pre-1.0, so a consumer can
  weigh the migration honestly against a hard "removed in the next narduk-core
  major" commitment (narduk-libs#282 review). Behaviour, the once-per-process
  warning guard, and the dev-only production silencing are unchanged.

  Also consolidates the package README's two separate deprecation sections
  ("Deprecated components" near the top, "Deprecations" near the bottom) into
  one "Deprecated components" section at the end of the document, so both
  `AppEmptyState` and `AppConfirmModal` migration guidance is discoverable in
  one place instead of split around unrelated Media security policy, Database
  alias contract, and List routes sections.

- fdb9c15: Tolerate an unknown list-query key for one release instead of
  rejecting it with a 400 (Logan, 2026-09-11). `.strict()` unknown-key rejection
  shipped as a `minor` in the list-query contract (narduk-libs#257) but is
  compatibility-narrowing for live fleet callers that were sending an extra
  query parameter which used to be silently ignored — that is not an approved
  breaking change, so this restores the previously-accepted behaviour for one
  release with a warning attached, and keeps the stricter behaviour reachable
  for a route that wants it today.

  **narduk-platform** (`./list-query`):

  - `listQuerySchema()` gains a `strict` option, default `false`. With
    `strict: false` (the default) an unknown query key no longer fails parsing:
    the request still succeeds with the known keys parsed exactly as before, and
    the caller-sent keys this route does not declare come back on the parsed
    result's new `unknownKeys: string[]` field (`[]` when there are none, or
    when `strict: true` rejected them before this field would ever be produced).
    `strict: true` restores exactly today's `.strict()` behaviour — a 400 naming
    the offending keys.
  - The next major flips the `strict` default to `true`, so a route that wants
    today's rejection behaviour to survive that flip unchanged should pass
    `strict: true` now rather than relying on the current default.

  **narduk-core** (`server/utils/listQuery`):

  - `parseListQuery` forwards `strict` to the schema unchanged.
  - When an unknown key is tolerated, `parseListQuery` logs one structured
    `warn` per request through narduk-logging (`useLogger(event)`, not a
    dev-only `console.warn`, so it reaches a fleet operator's normal log
    aggregation in production) naming every ignored key and stating they will be
    rejected with a 400 once `strict` defaults to `true` in the next major. The
    warning never fires when there are no unknown keys. That warning call is
    also wrapped so a logging failure can never turn a tolerated request into
    a 500.
  - `server/utils/logger.ts` no longer statically imports `nitropack/runtime`.
    That package's entry point is a barrel file that also re-exports an internal
    module referencing a build-time-only Nitro virtual specifier, so the static
    import made any module reaching `logger.ts` — including, transitively,
    `listQuery.ts` once it started calling `useLogger` — unloadable outside a
    booted Nitro server, breaking narduk-ai's and narduk-auth's plain-vitest
    list-route unit tests. `useRuntimeConfig` is now resolved lazily via a
    cached dynamic import: behaviour inside a real Nitro server is unchanged,
    and every existing caller already treated "runtime config unavailable" as an
    expected, handled case.

  **Compatibility.** This is a fix to the `.strict()` `minor` shipped in
  narduk-libs#257/#282, not a new breaking change: a caller relying on today's
  400-on-unknown-key behaviour keeps it by passing `strict: true`; every other
  caller regains the pre-`.strict()` tolerance. narduk-auth's
  `GET /api/admin/users` and `GET /api/notifications`, and narduk-ai's
  `GET /api/admin/system-prompts`, all use the default (non-strict) mode, so an
  unknown query key sent to any of them now answers 200 with a logged warning
  again, matching `.changeset/list-routes-migrated.md`'s "previously-accepted
  query keys stay accepted" framing, which this text now restates accurately
  instead of contradicting.

  Refs narduk-libs#247, narduk-libs#257.

- 3a2b7b0: Deprecate `AppConfirmModal`; removed in the next major.

  Superseded by `NeConfirmDialog` / `useConfirm()` in
  `@narduk-enterprises/narduk-shell` (components-library backlog item 16,
  narduk-libs#263; decision D4, 2026-09-11: deprecate now, remove in the next
  narduk-core major).

  No behaviour change and no removal. The component gains an `@deprecated` JSDoc
  block and a one-time, dev-only `console.warn` pointing at `NeConfirmDialog` /
  `useConfirm()`. The call-site migration mapping — `v-model` → `v-model:open`,
  `confirmColor="error"` → `tone="danger"`, `loading` → `pending`, the default
  slot → `#body`, and the `icon` prop dropped — is in this package's README
  under "Deprecations".

- d606e70: Add `NeForm`, `NeFormSection` and `NeSettingsPage`
  (components-library backlog item 19, narduk-libs#266; backlog
  narduk-libs#247), and deprecate `narduk-core`'s `AppSettingsProfile`.

  `NeForm` wraps Nuxt UI's `UForm` with a save bar that does not lie, closing
  three named bug classes by construction:

  - **Double-submit (stonx#37).** A capture-phase `submit` listener on a real
    DOM ancestor of `UForm`'s `<form>` drops a second submit while the first is
    still in flight, so two rapid submits issue exactly one `onSubmit` call.
  - **A save bar that lies about dirtiness (stonx#36).** `Unsaved changes` is
    driven by `UForm`'s own `dirty` state, which only clears once `onSubmit`'s
    promise resolves — a rejected save leaves it dirty, with no optimistic
    "saved" flash to walk back.
  - **Errors that do not scroll into view (stonx#350).** A schema (or
    `validate`) failure blocks submission and focuses the first invalid field,
    scrolled into view.

  `UButton`'s own `loading-auto` drives the save button's spinner and disabled
  state for the duration of the `onSubmit` promise — no ref to wire.
  `NeFormSection` is a titled group of fields (a thin wrapper around
  `NeSectionHeader`); `NeSettingsPage` composes `NePageHeader` with a `NeForm`
  whose save bar is sticky by default, for a full settings screen built from one
  or more sections.

  Supersedes `narduk-core`'s `AppSettingsProfile`, deprecated in the same
  release (D4, Logan 2026-09-11: "Deprecate, remove next major"). No behaviour
  change and no removal: the component gains an `@deprecated` JSDoc block and a
  one-time, dev-only `console.warn` pointing at `NeSettingsPage`. The migration
  mapping is in narduk-core's README under "Deprecated components".

- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
  - @narduk-enterprises/narduk-platform@2.1.0

## 1.23.2

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

## 1.23.1

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.

## 1.23.0

### Minor Changes

- 6297a08: Route core logging through the shared Narduk Logging package while
  retaining old imports, calls, scopes and legacy verbosity. New generated apps
  configure service identity, info-level logging and request completion
  summaries explicitly.

## 1.22.0

### Minor Changes

- def589f: Add an opt-in cspMediaSrc configuration for video and audio origins,
  including blob-backed MSE playback, while retaining same-origin media by
  default.

## 1.21.0

### Minor Changes

- 0f2262a: Add `readApproximateLocation(event)`
  (`@narduk-enterprises/narduk-core/server/utils/approximateLocation`),
  narduk-libs#76 Wave 2's "Cloudflare approximate IP location helper".

  Reads the visitor's approximate location from whichever Cloudflare signal the
  runtime exposes — Nitro's `cloudflare_module` request-`cf` object (preferred;
  always populated on a real Cloudflare deployment) or the `cf-ip*` request
  headers a zone adds only when "Add visitor location headers" is enabled — and
  returns the same `{ label, lat, lon, source: 'ip' }` shape either way, or
  `null` when neither signal carries usable coordinates.

  Extracted from riverstatus `server/api/v1/location/approximate.get.ts`
  (`readCloudflareLocation`, request-`cf` reader) and borderwaitstat-us
  `server/api/geo/ip.get.ts` (`cf-ip*` header reader); the borderwaitstat-us
  version's Vercel-header fallback is app-specific migration cruft and was not
  carried over. This is the library half only — an app's own
  `server/api/.../*.get.ts` route still owns its URL path and response envelope
  and now calls this helper instead of reading Cloudflare signals itself;
  consumer migrations are tracked as follow-ups, not included in this change.

### Patch Changes

- 8b48dba: Move `@narduk-enterprises/eslint-config` out of narduk-core's runtime
  `dependencies`. Since 1.20.2 it was pinned there at `workspace:*`, which
  publishes as the current eslint-config major, so a patch bump of narduk-core
  silently dragged consumers from eslint-config v1 onto v2 and broke `lint` for
  anyone who hadn't migrated yet (narduk-libs#154, surfaced by been-sober-for PR
  #96).

  narduk-core re-exports `eslint-app-config.mjs` and
  `eslint-nuxt-flat-fragments.mjs`, which import from
  `@narduk-enterprises/eslint-config`, as public subpath exports for consumers'
  own ESLint configs, so it is not a pure `devDependency` — it is now an
  **optional peerDependency** (`>=1.2.17 <3`), matching the range of
  eslint-config majors the re-exported fragments are known to work with. It also
  stays a `devDependency` for narduk-core's own `lint`/`build`. Consumers who
  don't use those re-exported fragments no longer get eslint-config forced onto
  them at all; consumers who do must bring their own compatible eslint-config
  version instead of receiving whatever major narduk-core last published
  against.

## 1.20.5

### Patch Changes

- d6e098e: Fix two small bugs from the W2 hardening batch (narduk-libs#124):

  - `useAppFetch()` threw `useRequestFetch is not defined` when called from a
    consuming app, because it relied on a Nuxt auto-import that never resolves
    from `node_modules`. It now imports `useRequestFetch` explicitly from
    `#imports`, matching the pattern every other composable in this package
    already uses (narduk-libs#59).
  - Removed the orphaned `showcaseAuthLoginTest` rate-limit policy. Its only
    consumer, `useAuthApi().loginAsTestUser()`, was removed from narduk-auth in
    an earlier correctness pass, and the `/api/auth/login-test` endpoint it
    guarded has never existed in this repo (narduk-libs#96).

## 1.20.4

### Patch Changes

- 1d017c7: Persist sealed user-session cookies for 30 days by default so mobile
  browsers do not discard authentication when the browser is backgrounded or
  reclaimed. Callers can still provide a shorter or longer `maxAge` override.

## 1.20.3

### Patch Changes

- Updated dependencies [048670e]
  - @narduk-enterprises/eslint-config@2.0.1

## 1.20.2

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
  - @narduk-enterprises/eslint-config@2.0.0

## 1.20.1

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-platform@2.0.0
