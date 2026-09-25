# @narduk-enterprises/narduk-testkit

## 1.8.1

### Patch Changes

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

## 1.8.0

### Minor Changes

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

### Patch Changes

- ca67c3f: Add tag-based E2E quarantine to
  `@narduk-enterprises/narduk-testkit/playwright/config`: `@quarantine` via
  `quarantineDetails`, `grepInvert` on the `pr` / `web` projects so a tagged
  spec is excluded from the PR project, a `quarantine` project that collects the
  tag, and `assertPlaywrightQuarantineCollection` so a vitest guard fails when
  Playwright collects an untagged or wrongly tagged file (narduk-libs#520).
  `create-narduk-app` is a companion patch so the generator pin moves with the
  testkit release.

## 1.7.1

### Patch Changes

- 2d25947: Generated apps now override `miniflare>undici` to `^7.29.1`.
  Miniflare pins undici exactly, and below 7.29.1 each D1 call a test makes
  through the testkit harness costs about 6.5ms instead of about 2ms. That is
  enough to push seed-heavy suites past their CI timeouts (narduk-libs#740). The
  testkit README documents the override for existing apps.
- 5ac629e: The package's `volta.node` pin moves from 22.22.3 to 24.21.0, the
  Node the workspace root and CI run (narduk-libs#647). No runtime change: the
  pin only selects the Node that Volta runs for commands inside the package
  directory. It now matches the ABI of the native modules that the root install
  builds.

## 1.7.0

### Minor Changes

- c541ef4: Add `waitForVueHydrated(page)`, a real hydration barrier. It waits
  until the Vue app has mounted and Nuxt's `isHydrating` is `false`.
  `waitForHydration` only ever waited for the document `load` event, which on a
  Nuxt page fires before hydration. It is now deprecated with unchanged
  behaviour, and `waitForPageLoad` is the same wait under an accurate name. The
  shared auth, notifications and user-profile contract suites, and the
  generator's e2e fixtures and audit spec, now use `waitForVueHydrated`.

### Patch Changes

- b47ddc7: `narduk-testkit/d1`: `createD1QueryHarness` now runs on Miniflare 5,
  which every Wrangler from 4.129 ships. It converts its options with
  Miniflare's own `convertV4MiniflareOptions` when that exists and passes them
  unchanged to Miniflare 4.

  `create-narduk-app`: generated apps pin `wrangler` 4.136.3 and
  `@cloudflare/workers-types` 5.20260922.1. The older Wrangler's Miniflare
  brought `sharp` and `undici` versions with high advisories.

## 1.6.2

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

## 1.6.1

### Patch Changes

- dd1a7d9: `createConsoleTracker` accepts URL-scoped ignore rules
  (`{ text: RegExp; url?: RegExp }`) and records 4xx/5xx response URLs so an
  object rule's optional `url` matches the request that actually failed. Bare
  `RegExp[]` call sites stay unchanged (narduk-libs#134). `create-narduk-app` is
  a companion patch so the generator pin moves with the testkit release.

## 1.6.0

### Minor Changes

- bb37590: New `./d1` export: a Miniflare D1 query harness for Vitest.
  `createD1QueryHarness({ migrations })` applies a migration list or directory
  and returns `{ db, raw, statements, reset(), clearData(), dispose() }` with
  every statement prepared on `db` recorded. `expectStatementBudget` fails above
  a statement ceiling, `expectQueryPlan` fails on `SCAN <table>` in
  `EXPLAIN QUERY PLAN`, and `scaleMatrix` runs a history × live matrix, fails
  unless the statement count is constant, and returns per-cell statements, bytes
  and results. It proves query shape, not latency. `miniflare` is a new optional
  peer dependency, loaded only when a harness is created.

## 1.5.0

### Minor Changes

- 0c4ddd9: Add `@narduk-enterprises/narduk-testkit/server/handlers` — a fake H3
  event plus in-memory Cloudflare KV, R2 and D1 fakes for unit-testing route
  handlers without a real Worker runtime.

  **The gap.** Every package that ships Nitro route handlers has been
  hand-rolling its own `IncomingMessage`/`ServerResponse` pair to build an
  `H3Event`, and its own ad-hoc canned KV/D1 stubs, scattered across
  `narduk-core`, `narduk-app` and `narduk-auth` tests (see "Follow-ups" below).
  This harness centralizes that in one tested, documented place, exported from
  its own subpath so Playwright-only consumers of this package don't pull it in.

  **`createFakeEvent` / `readFakeEventResponse`.**
  `createFakeEvent({ method, path, query, params, headers, body, cookies, context })`
  builds a real `H3Event` on top of h3's own
  `createEvent(IncomingMessage, ServerResponse)` — the same construction
  narduk-core's tests already use by hand — so it works with h3's own
  `getQuery`, `readBody`, `getRouterParam`, `getHeader`, `setResponseStatus` and
  `setHeader` rather than a hand-rolled event shape.
  `readFakeEventResponse(event, handlerResult?)` reads back the status, headers
  and (JSON-decoded when possible) body a handler wrote, falling back to the
  handler's return value when nothing was written directly.

  **`createFakeKVNamespace`.** An in-memory `KVNamespace` —
  `get`/`put`/`delete`/ `list`, `expiration`/`expirationTtl` (backed by an
  injectable clock for deterministic tests) and `metadata`.

  **`createFakeR2Bucket`.** An in-memory `R2Bucket` — `get`/`head`/`put`/
  `delete`/`list` with prefix filtering, cursor pagination and a real MD5 etag.

  **`createFakeD1Database`.** A `D1Database` backed by `node:sqlite` (a Node
  built-in — no new dependency; the package now declares `engines.node

  > =
  > 22.22.0`for it), so`prepare().bind().first()/all()/run()/raw()`, `batch()`and`exec()`actually execute SQL.`batch()`runs inside a real`BEGIN`/`COMMIT`/`ROLLBACK`
  > transaction, so a failure partway through rolls back every statement in the
  > batch, matching D1's own all-or-nothing guarantee as far as this fake can
  > promise it.

  **Fidelity over permissiveness.** Every fake was diffed against a real binding
  (workerd, via miniflare) and each place SQLite or an in-memory map would have
  been _more permissive than production_ is enforced instead, because a fake
  that accepts what production rejects turns a broken handler into a green test:
  D1 rejects a `bind()` with the wrong number of values rather than binding
  NULL, `first(column)` throws `D1_COLUMN_NOTFOUND` for a column the result set
  lacks, `run()` returns rows for a row-returning statement (D1's `run()` and
  `all()` share one shape), BLOB columns come back as D1's plain byte arrays,
  and `exec()` counts statements by line; KV stores bytes rather than a UTF-8
  string (so a binary value survives a round trip) and enforces the key rules
  and the 60-second expiration floor; R2 honours `range`, gates `list`'s
  metadata maps behind `include`, and makes a body single-use.

  **`callHandler`.** `callHandler(handler, eventOptions, { env })` wires the
  fakes (or any object) into `event.context.cloudflare.env`, calls the handler,
  converts a thrown `H3Error` into the response Nitro's own error handling would
  send, and returns the same `{ status, headers, body }` shape as
  `readFakeEventResponse`.

  **What these fakes do NOT emulate**, spelled out in the README: D1's real
  network latency, multi-region consistency and read-replica sessions
  (`withSession()` throws); KV's real eventual consistency and its
  value/metadata size limits; R2's multipart uploads and conditional (`onlyIf`)
  requests — `get` throws on `onlyIf` rather than quietly ignoring it; and the
  deprecated D1 `dump()` API (also throws).

  `h3` and `@cloudflare/workers-types` are now declared as optional peer
  dependencies: the published `server/handlers` entry imports `h3` at runtime
  and its `.d.ts` files use the Cloudflare ambient globals, neither of which a
  `devDependencies`-only declaration gives a consumer.

  **Follow-ups (not done in this PR, to avoid touching narduk-core from this
  lane).** This harness is now capable of replacing several ad-hoc fakes
  elsewhere in the monorepo:

  - `packages/modules/narduk-core/tests/kv-cache.test.ts`'s local `createKV()`
  - `packages/modules/narduk-core/tests/auth-api-key-d1.test.ts`'s local
    `createApiKeyDb()` canned D1 stub
  - the repeated `createEvent(request, new ServerResponse(request))` pattern in
    `narduk-core/tests/{request-correlation,database-none,exception-capture, logger,user-session}.test.ts`,
    `narduk-app/tests/request-body.test.ts`,
    `narduk-auth/tests/{native-auth-boundary,local-email-runtime}.test.ts` and
    `narduk-logging/tests/adapters.test.ts`

- 8e6c388: Add `@narduk-enterprises/narduk-testkit/playwright/dev-port`:
  `resolveLocalDevPort`, `shouldReuseExistingServer`,
  `assertLocalDevPortAvailable`, `isLinkedWorktree`, `isPortInUse` and
  `normalizePort`.

  One scaffolded local dev port per app was one port per machine: every worktree
  of the app shared it, so Playwright's `reuseExistingServer` attached to
  whichever worktree's `nuxt dev` got there first and the suite silently tested
  the wrong branch (narduk-libs#417). A linked git worktree now derives its own
  port from a stable hash of the checkout path, and does not reuse a server it
  did not start. The primary checkout and every CI run keep the declared port
  unchanged, so muscle memory, bookmarks and localhost allowlists still work;
  `PLAYWRIGHT_PORT` (then `NUXT_PORT`) still overrides everything.

  Subpath-only, like `e2e/fixture-server`: it is imported from a Playwright
  config before the runner exists, so it stays out of the root barrel.

### Patch Changes

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

## 1.4.0

### Minor Changes

- 7c96708: Add `expectAccessible`, the estate accessibility bar: zero
  serious/critical axe violations on the routes a PR is gated on (Logan,
  2026-09-17, "Zero serious/critical in the PR subset"). Moderate and minor
  findings are recorded and do not fail.

  `playwright/accessibility` previously only asserted a scan the app had already
  built against a recorded baseline. That ledger answers "did this change move
  the debt?" and deliberately tolerates known debt, so it is not a shipping gate
  — and because each app built its own `AxeBuilder`, the tag set and any
  disabled rules were per-app and free to drift.

  `expectAccessible` owns the scan instead, so the rule set is the estate's:
  `WCAG_2_1_AA_TAGS` (2.1 AA, the level the products claim, rather than the 2.2
  set the ledger uses) plus `ESTATE_DISABLED_AXE_RULES`. That list ships EMPTY
  and the empty list is the position — a disabled rule is permanent silence on
  every route of every app, so an entry must show the rule is wrong on this
  stack and carry a reason and a link. The rules such a list usually exists for
  (`region`, `landmark-one-main`, `page-has-heading-one`, `heading-order`) are
  best-practice-tagged and never reach the gate.

  A failure carries both halves of the evidence: one line per blocking violation
  in the message (rule id, impact, first selector, help URL), and the full
  violations JSON at every impact attached to the Playwright test, because the
  sub-threshold findings are the inventory the next piece of work is planned
  from. The helper returns that report so a spec can aggregate routes.

  Also exported for composition and testing: `AXE_IMPACT_ORDER`,
  `isImpactAtOrAbove` (fails closed on a missing or unrecognised impact),
  `partitionViolationsByImpact`, `summarizeViolation`, `countViolationsByImpact`
  (rules AND nodes — one rule over sixty nodes is a day of work),
  `buildAccessibilityReport`, `runEstateAxeScan`, `analyzeWithAxeBuilder` and
  `resolveAxeBuilder`.

  `@axe-core/playwright` remains an OPTIONAL peer and this package still does
  not import it: the load is a dynamic import behind a `string`-typed specifier,
  so an app using only the ledger helpers installs no scanner, and an app
  calling `expectAccessible` without the peer gets a sentence naming the package
  instead of a module-resolution stack trace.

  `AxeViolation` gains optional `helpUrl` and `description`, and
  `AxeViolationNode` an optional `html`; all three are additive.

### Patch Changes

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

## 1.3.2

### Patch Changes

- 1cda2f5: Block optional-telemetry requests in `createConsoleTracker`'s
  `telemetry: 'stub'` profile instead of answering them with an empty `204`.
  Cloudflare injects its RUM beacon with an `integrity` attribute, so the empty
  body 1.3.1 supplied failed Subresource Integrity, and Chromium reports that
  failure against the document rather than the beacon — an error no
  origin-scoped filter can attribute to telemetry. Measured against a real
  deployment, the `204` traded three `ERR_CONNECTION_REFUSED` errors for six
  unattributable SRI errors. An aborted request is never integrity-checked and
  its `ERR_BLOCKED_BY_CLIENT` console entry carries the telemetry URL, so the
  origin filter catches it.

## 1.3.1

### Patch Changes

- 1fe3dde: Add an opt-in deterministic telemetry profile to
  `createConsoleTracker`. `telemetry: 'stub'` fulfils optional-telemetry
  requests (Cloudflare Insights, Google Tag Manager, Google Analytics, PostHog,
  plus caller-supplied `extraTelemetryHosts`) with 204 and drops those origins'
  resource-load console and `pageerror` entries, so a console-cleanliness
  assertion measures the app rather than whether the machine running it can
  reach an analytics CDN. The default stays `'live'`, and first-party errors,
  hydration warnings, and every other console error remain fatal in both modes.
  The second argument still accepts a bare `RegExp[]`.

## 1.3.0

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

## 1.2.0

### Minor Changes

- c53456f: Add `playwright/accessibility`: axe-driven WCAG 2.2 AA conformance
  asserted against a recorded baseline rather than against zero.

  The baseline is a two-directional ledger. A rule that fires and is not listed
  fails, so new debt cannot land silently; a listed rule that no longer fires
  also fails, asking for the entry to be removed, so debt cannot be re-accrued
  behind a stale allowance. A gate that demands zero on an app's first axe run
  gets disabled by the first person it blocks, and one that only reports teaches
  nothing — this is the shape that survives contact with real debt.

  Ships three checks axe has no rule for: text zoom, state-not-by-colour-alone,
  and reduced motion, which asserts transitions are removed rather than merely
  shortened.

  The text-zoom check scales the ROOT font size rather than the viewport, and
  then proves the text actually grew before it trusts the layout assertion. Both
  halves are load-bearing. Zooming a viewport out passes while real 200% text
  still overflows — but so does raising the root font size on a page whose
  typography is declared in px, because nothing moves and therefore nothing
  overflows. That second failure is the dangerous one: the check reports 1.4.4
  conformance for a page that has none, and gets cited as evidence. The
  judgement is exposed as `textScalingVerdict` so it is unit-tested rather than
  locked inside a browser call, which is how the vacuous version survived
  review.

  `@axe-core/playwright` is an OPTIONAL peer. The helpers take axe results
  rather than building the scan, so the app keeps control of its `AxeBuilder`
  options and this package never imports axe — apps using the other testkit
  families are not made to install a runtime they never call.

## 1.1.0

### Minor Changes

- 6575caf: Three new subpaths for e2e suites that commit evidence, extracted
  from a Cloudflare Worker app's Playwright suite where each one was
  load-bearing.

  **`playwright/deterministic-capture`** — `prepareDeterministicPage`,
  `freezePageClock`, `emulateReducedMotion`, `waitForVisualQuiescence`,
  `captureStableScreenshot` and `expectRepeatableCapture`. It carries three
  measured findings that each cause silent, hard-to-attribute screenshot churn
  on `playwright@1.61.1`:

  - `page.clock.setFixedTime()` replaces `window.performance` with a plain
    object stub, so `getEntriesByType('resource')` returns zero entries on a
    page that just fetched four API responses. Nothing throws; any request or
    performance budget built on Resource Timing simply starts passing for the
    wrong reason. `freezePageClock` patches `Date.now` and `new Date()` through
    a Proxy and leaves the performance timeline alone.
  - `use: { reducedMotion: 'reduce' }` resolves into `project.use` and is then
    dropped on the way to the browser context — the page answers
    `no-preference`, and an app that reads the media query renders a different,
    sometimes differently sized tree. `emulateReducedMotion` applies it on the
    page, where it takes effect.
  - Playwright's `fullPage` capture is not repeatable: six consecutive calls
    against a settled page produced hashes A B A B A B, the same 23 pixels
    flipping one 8-bit step along a rounded border. `captureStableScreenshot`
    grows the viewport to the document instead, which is one paint and is stable
    — and stops stranding `position: fixed` chrome partway down a tall page.

  `captureStableScreenshot` also photographs twice and requires byte equality —
  retrying the pair (re-settling between attempts, three times by default) so
  that a loaded CI runner slipping one paint into the gap is not a red test,
  while a screen that never comes to rest still fails and says so.
  `expectRepeatableCapture` takes any capture closure, so a suite can prove the
  app _boots_ to the same pixels twice. Masks carry a mandatory `reason`.

  **`playwright/request-accounting`** — `expectRequestCounts` and
  `readResourceRequests` assert the exact number of times each endpoint was
  requested during a navigation, read from the document's own Resource Timing
  entries. Exact rather than "at most": the pattern this generalises from was
  catching a duplicated pair of ~90 KB JSON responses on every cold load. With a
  `scope`, an unbudgeted request inside it is also a failure.

  **`e2e/fixture-server`** — `startStaticFixtureServer` serves an app's built
  output with recorded responses standing in for its API, for the non-Nuxt app
  (Cloudflare Worker, Vite SPA) that the existing Nuxt-shaped fixtures do not
  cover. Extensionless paths are rewritten to the HTML entry so deep links
  behave as they do behind a real static host; an unrecorded path inside the API
  scope is answered 501 rather than a plausible empty body; the port is
  ephemeral by default. It is deliberately not re-exported from the root barrel,
  because it is imported from a Playwright config, which is evaluated before the
  runner exists.

## 1.0.1

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
