# @narduk-enterprises/narduk-testkit

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
