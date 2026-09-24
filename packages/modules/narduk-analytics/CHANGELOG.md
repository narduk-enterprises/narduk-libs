# @narduk-enterprises/narduk-analytics

## 1.25.1

### Patch Changes

- 8f4a177: Scope admin PostHog session recordings to `POSTHOG_DOMAIN` so a
  shared project cannot list another app's replays, and include the domain in
  the recordings cache key.
- 70168be: Standard-mode analytics now strips fragments, sensitive query keys
  and page text without enabling strict privacy; IndexNow submit keeps URLs on
  the site host; the env catalog treats INDEXNOW_KEY as unique per app.
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

## 1.25.0

### Minor Changes

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

## 1.24.0

### Minor Changes

- 3f8eac8: The `/api/admin/**` GA, Search Console, Indexing and PostHog routes
  register only when the app has a database: an app declaring
  `nardukCore.databaseBackend: 'none'` (or `NUXT_DATABASE_BACKEND=none`) no
  longer ships routes `requireAdmin` could only ever refuse.
  `nardukAnalytics.admin` overrides either way (#524).

## 1.23.1

### Patch Changes

- 5747011: narduk-analytics turns `narduk/prefer-shared-collection` off for its
  admin panels (narduk-libs#744). The rule is app-tier, and a module sits below
  narduk-shell, so the panels keep plain `<UTable>`s. Only the package's lint
  configuration changed; the published output is the same.

## 1.23.0

### Minor Changes

- 5ac629e: The build now fails when narduk-core is registered with `app: false`
  while narduk-analytics' client half is on (narduk-libs#663). narduk-core
  registers the runtime-public overlay only when its `app` option is on, so that
  shape passed the "is narduk-core installed" guard and ran the analytics client
  plugins with no PostHog key, GA id or deployment target. The result was no
  analytics and no signal. The guard reads the `nardukCore` key and inline
  `[narduk-core, options]` module tuples. To fix a failing build, turn
  `nardukCore.app` back on, or set `nardukAnalytics.app: false` to keep only the
  server routes.

## 1.22.1

### Patch Changes

- e61a56d: `meta.compatibility.nuxt` now says `>=4.0.0`, matching the `nuxt`
  peer range these modules already declare (#444). Before, the module metadata
  still claimed `>=3.16.0`, so a Nuxt 3 app got no compatibility warning from
  Nuxt and failed later instead. Nuxt 4 apps see no change.

## 1.22.0

### Minor Changes

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

## 1.21.13

### Patch Changes

- Updated dependencies [693f7d3]
  - @narduk-enterprises/narduk-core@2.7.0

## 1.21.12

### Patch Changes

- Updated dependencies [fa2f123]
  - @narduk-enterprises/narduk-core@2.6.4

## 1.21.11

### Patch Changes

- Updated dependencies [ecc731b]
  - @narduk-enterprises/narduk-core@2.6.3

## 1.21.10

### Patch Changes

- Updated dependencies [81051b0]
  - @narduk-enterprises/narduk-core@2.6.2

## 1.21.9

### Patch Changes

- Updated dependencies [448e86f]
- Updated dependencies [7142305]
  - @narduk-enterprises/narduk-core@2.6.1

## 1.21.8

### Patch Changes

- Updated dependencies [4599aa7]
- Updated dependencies [4ba5d02]
  - @narduk-enterprises/narduk-core@2.6.0

## 1.21.7

### Patch Changes

- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [92835a1]
  - @narduk-enterprises/narduk-core@2.5.0

## 1.21.6

### Patch Changes

- Updated dependencies [bb37590]
- Updated dependencies [bb37590]
  - @narduk-enterprises/narduk-core@2.4.0

## 1.21.5

### Patch Changes

- Updated dependencies [8da7e33]
- Updated dependencies [05b3ef9]
  - @narduk-enterprises/narduk-core@2.3.0

## 1.21.4

### Patch Changes

- Updated dependencies [fe58c5f]
  - @narduk-enterprises/narduk-core@2.2.4

## 1.21.3

### Patch Changes

- Updated dependencies [7ae9278]
  - @narduk-enterprises/narduk-core@2.2.3

## 1.21.2

### Patch Changes

- Updated dependencies [766ce96]
  - @narduk-enterprises/narduk-core@2.2.2

## 1.21.1

### Patch Changes

- Updated dependencies [fa41027]
- Updated dependencies [fa41027]
  - @narduk-enterprises/narduk-core@2.2.1

## 1.21.0

### Minor Changes

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

- 8186003: Stop serving `POSTHOG_OWNER_DISTINCT_ID` to anyone who forges
  `narduk_owner=true`.

  `GET /api/owner/posthog-bootstrap` now requires the httpOnly HMAC proof cookie
  minted by `POST /api/owner-tag` (`OWNER_TAG_SECRET` via `crypto.subtle`). The
  unsigned `narduk_owner` flag stays client-readable for `posthog.client`.
  Clearing the tag deletes both cookies. Bootstrap uses the existing owner-tag
  rate-limit policy.

  The proof is `iat.hex(HMAC-SHA256(secret, narduk-owner-proof:v2:iat))`. Verify
  is constant-time on the signature, fail-closed when the secret is missing, and
  rejects a token older than `OWNER_PROOF_MAX_AGE_SECONDS` (one year).

  `POST /api/owner-tag` now compares the submitted `OWNER_TAG_SECRET` with the
  same constant-time helper instead of `!==`, so the mint path no longer exits
  on the first differing byte. The helper compares length first, so it hides the
  secret's contents but not its length.

  ## Operator action

  Old-format proofs (the static 64-hex HMAC of `narduk-owner-proof:v1`) are
  rejected. Owner devices must re-run `POST /api/owner-tag` once to mint a v2
  proof cookie. `OWNER_TAG_SECRET` rotation remains the emergency kill.

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

## 1.20.0

### Minor Changes

- 9051c12: Report exceptions to PostHog by subscribing to narduk-core's
  `narduk:exception` seam. This module registers a destination and installs no
  error listeners of its own; the capture sites belong to narduk-core.

  Reporting goes through `posthog.captureException()`, PostHog's own documented
  API, which emits the same `$exception` event exception autocapture emits — so
  PostHog's Error tracking UI works with no further setup.

  `capture_exceptions` autocapture is deliberately not used. It is an
  _externally loaded_ extension
  (`loadExternalDependency(instance, 'exception-autocapture', …)`) and that
  loader refuses to run whenever `disable_external_dependency_loading` is set,
  which is this module's default posture whenever session replay is off —
  exactly the gap `$web_vitals` hit. Enabling it would be a switch that silently
  does nothing; `captureException()` is bundled in the main module and works
  under that posture unchanged.

  `$exception` carries the matched route _pattern_ (never a raw path), the
  source, status code, fatal flag, redacted message, build version and request
  id. Nothing is reported when analytics never initialized — no key,
  `previewSafeMode`, localhost, `analyticsLoadStrategy: 'off'` — or when the
  visitor has opted out.

- 0a5be8d: Report Core Web Vitals to PostHog, behind a new opt-in
  `posthogWebVitalsEnabled` flag (`POSTHOG_WEB_VITALS_ENABLED`), off by default
  like every other PostHog capture feature in this module.

  This is PostHog's own `$web_vitals` autocapture rather than a second pipeline.
  `posthog-js` already ships a `webVitalsAutocapture` extension that buffers
  LCP/CLS/FCP/INP and emits one `$web_vitals` event, switched on with
  `capture_performance: { web_vitals: true }` — so PostHog's built-in Web Vitals
  dashboard works with no further setup.

  The extension does not bundle the measurement code, though: it fetches
  `/static/web-vitals.js` from the PostHog host unless
  `window.__PosthogExtensions__.postHogWebVitalsCallbacks` is already populated,
  and that fetch is refused whenever `disable_external_dependency_loading` is
  set — this module's default whenever session replay is off. So
  `posthog.client` now publishes those callbacks itself from the pinned
  `web-vitals` package (the same library, and the same object PostHog's own
  asset publishes) before calling `posthog.init`. No extra network request, and
  the module's external-dependency posture is unchanged.

  A `before_send` hook enriches `$web_vitals` events — and only those events —
  with the matched `route` pattern (never a raw path, so record ids stay out of
  PostHog), the deployed `build_version` SHA, and connection/device class where
  the browser exposes it. The app id already rides along as the existing `app`
  super property.

  `capture_performance.web_vitals` is also pinned explicitly to `false` when the
  flag is off, so a PostHog project-side `capturePerformance` remote config can
  no longer start collecting vitals for an app that has not opted in. Every
  existing analytics gate still applies first: nothing is captured in preview
  safe mode, without a PostHog key, on a local host, or with
  `analyticsLoadStrategy: 'off'`.

  `POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED` switches to the
  `web-vitals/attribution` build for regression investigations; it is off by
  default because it roughly doubles that lazily-imported chunk.

  TTFB is not included: `SupportedWebVitalsMetrics` in `posthog-js` is exactly
  `LCP | CLS | FCP | INP`, and adding TTFB would mean a second, parallel event
  stream.

### Patch Changes

- Updated dependencies [9051c12]
- Updated dependencies [97b0ac3]
- Updated dependencies [fff943d]
- Updated dependencies [57ba098]
- Updated dependencies [b94ac04]
- Updated dependencies [894cd17]
- Updated dependencies [57ba098]
  - @narduk-enterprises/narduk-core@2.1.0

## 1.19.36

### Patch Changes

- Updated dependencies [8f693b1]
- Updated dependencies [8abb3c8]
  - @narduk-enterprises/narduk-core@2.0.0

## 1.19.35

### Patch Changes

- Updated dependencies [2e9d424]
  - @narduk-enterprises/narduk-core@1.25.0

## 1.19.34

### Patch Changes

- Updated dependencies [548fa01]
- Updated dependencies [960479a]
- Updated dependencies [54577ac]
- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
- Updated dependencies [3a2b7b0]
- Updated dependencies [d606e70]
  - @narduk-enterprises/narduk-core@1.24.0

## 1.19.33

### Patch Changes

- d66fe65: Deduplicate PostHog pageviews across Nuxt hydration and query-only
  route callbacks, and skip failed navigations.

## 1.19.32

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- e202cfd: Send GA4 pageviews with manual events after the initial route and
  successful SPA path changes. The Google tag is now configured once without
  automatic pageview emission, preventing repeated configuration from dropping
  SPA views.
- Updated dependencies [e202cfd]
- Updated dependencies [37c03e2]
  - @narduk-enterprises/narduk-core@1.23.2

## 1.19.31

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.
- Updated dependencies [aaf5549]
  - @narduk-enterprises/narduk-core@1.23.1

## 1.19.30

### Patch Changes

- Updated dependencies [6297a08]
  - @narduk-enterprises/narduk-core@1.23.0

## 1.19.29

### Patch Changes

- Updated dependencies [def589f]
  - @narduk-enterprises/narduk-core@1.22.0

## 1.19.28

### Patch Changes

- Updated dependencies [0f2262a]
- Updated dependencies [8b48dba]
  - @narduk-enterprises/narduk-core@1.21.0

## 1.19.27

### Patch Changes

- Updated dependencies [d6e098e]
  - @narduk-enterprises/narduk-core@1.20.5

## 1.19.26

### Patch Changes

- Updated dependencies [1d017c7]
  - @narduk-enterprises/narduk-core@1.20.4

## 1.19.25

### Patch Changes

- @narduk-enterprises/narduk-core@1.20.3

## 1.19.24

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

## 1.19.23

### Patch Changes

- d22cd3d: Import Nuxt runtime helpers explicitly in packaged analytics plugins
  so consumer builds hydrate without relying on ambient package-source
  auto-import transforms.

## 1.19.22

### Patch Changes

- Updated dependencies [e030789]
  - @narduk-enterprises/narduk-core@1.20.1

## 1.19.21

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

## 1.19.20

### Patch Changes

- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
