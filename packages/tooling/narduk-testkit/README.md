# @narduk-enterprises/narduk-testkit

Dev-only Vitest factories, Playwright fixtures/contracts, and UI-quality tools
for Narduk apps. The published package contains built ESM and declarations; it
has no Nuxt layer, Nuxt configuration, auto-merged files, or aliases.

The root, `e2e/*`, and `playwright/*` exports belong to the Playwright runner.
The `server/kit/*` exports belong to the Vitest runner. Import each family only
from its owning test process because both runners install their own matcher
globals.

Apps own their Vitest and Playwright configuration. Import a factory from an
explicit subpath and call it from a thin app-local test wrapper:

```ts
import { registerCanonicalHostMiddlewareTests } from '@narduk-enterprises/narduk-testkit/server/kit/canonical-host'

registerCanonicalHostMiddlewareTests(
  () =>
    import('@narduk-enterprises/narduk-core/server/middleware/00-canonical-host'),
)
```

Playwright discovery wrappers can import the fixture, contract, and spec
subpaths directly:

```ts
import { defineSharedAuthContract } from '@narduk-enterprises/narduk-testkit/e2e/contracts/auth'
import { test } from '@narduk-enterprises/narduk-testkit/e2e/fixtures'

defineSharedAuthContract({ appName: 'my-app' })
void test
```

### Waiting for hydration

`waitForVueHydrated(page)` resolves once the Vue app has mounted and Nuxt has
finished hydrating (`__vue_app__.$nuxt.isHydrating === false`). Use it before
asserting on anything the client changes after the server render. The shared
contract suites use it.

`waitForHydration(page)` is deprecated. It waits only for the document `load`
event, which on a Nuxt page fires **before** hydration (#697). It keeps that
behaviour so existing suites do not all change at once. `waitForPageLoad(page)`
is the same wait under an accurate name.

### Hydration mismatch failures

The shared `page` fixture fails any test whose console logs a Vue hydration
mismatch. Production Vue logs only `Hydration completed but contains mismatches`
— no URL, no element — so a consumer CI line used to name nothing.

The fixture installs an `addInitScript` that wraps `console.warn` and, as the
warning fires, serialises `location.pathname`, the page URL, the mismatched
node's `outerHTML`, and its parent (truncated). Those strings are appended to
the warning so Playwright's `msg.text()` already carries them. A
`page.on('console')` handler that `await`s `arg.evaluate` loses the handle as
soon as the test navigates again, which is the back-to-back `goto` pattern that
exposes these bugs.

Production Vue strips the node arguments unless the E2E or CI preview artifact
is built with `vite.define.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = 'true'`.
That flag is never for the production deploy. Import the helper from the
config-safe subpath — not from `e2e/fixtures`, which registers Playwright
fixtures at module scope:

```ts
import { VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE } from '@narduk-enterprises/narduk-testkit/e2e/hydration-mismatch'

export default defineNuxtConfig({
  vite: {
    define: {
      ...(process.env.NARDUK_E2E === '1'
        ? VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE
        : {}),
    },
  },
})
```

With the flag on, Vue prints the server node and the client expectation on the
first mismatch; the fixture then names the page those arguments belonged to.

Apps whose users endpoint is not the default `/api/admin/users` can configure
the reusable API spec without copying it:

```ts
import { registerUsersApiSpec } from '@narduk-enterprises/narduk-testkit/e2e/specs/users-api'

registerUsersApiSpec({ apiPath: '/api/users' })
```

## Reproducible screenshots

`playwright/deterministic-capture` is for a suite that commits screenshots and
is tired of them churning. Three things make the same source produce different
pixels, and each has its own helper:

```ts
import {
  captureStableScreenshot,
  expectRepeatableCapture,
  prepareDeterministicPage,
} from '@narduk-enterprises/narduk-testkit/playwright/deterministic-capture'

// In a fixture or beforeEach, BEFORE the first navigation.
await prepareDeterministicPage(page, { now: '2026-08-28T14:00:00.000Z' })

// Waits for the page to stop moving, photographs it twice, and fails if the two differ.
await captureStableScreenshot(page, { fullPage: true, path: 'shots/home.png' })

// The stronger gate: prove the app BOOTS to the same pixels twice.
await expectRepeatableCapture(async () => {
  await page.goto('/')
  return captureStableScreenshot(page, { fullPage: true })
})
```

Three findings are baked in, each measured on `playwright@1.61.1` and documented
at the call site:

- **`page.clock` breaks Resource Timing.** `setFixedTime()` replaces
  `window.performance` with a plain stub whose `getEntriesByType('resource')`
  returns nothing, so any request or performance budget silently passes.
  `freezePageClock` patches only `Date.now` and `new Date()` instead.
- **`use: { reducedMotion: 'reduce' }` never reaches the page.** It resolves
  into `project.use` and is dropped on the way to the context; the page still
  answers `no-preference`. `emulateReducedMotion` applies it for real.
- **Playwright's `fullPage` capture is not repeatable.** Consecutive calls on a
  settled page alternate between two rasterisations. `fullPage: true` here grows
  the viewport to the document and takes one ordinary capture.

## Accessibility

`playwright/accessibility` asserts a WCAG 2.2 AA claim against a recorded
baseline instead of against zero. An app that has never run axe almost always
has debt on its first run — usually contrast on state colours a design system
produces, which is a token change and often a design decision rather than an
engineering one. A gate that demands zero on day one gets disabled by the first
person it blocks; a gate that only reports teaches nothing.

So the ledger is asserted in both directions: a rule that fires and is not in
the baseline fails, so new debt cannot land silently; and a rule in the baseline
that no longer fires also fails, asking for the baseline to be lowered, so debt
cannot be re-accrued behind a stale allowance. The file only ever shrinks.

```ts
import AxeBuilder from '@axe-core/playwright'
import {
  WCAG_2_2_AA_TAGS,
  assertAgainstAccessibilityBaseline,
} from '@narduk-enterprises/narduk-testkit/playwright/accessibility'

import baseline from './accessibility-baseline.json' with { type: 'json' }

test('has no new AA violation', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_2_2_AA_TAGS])
    .analyze()
  assertAgainstAccessibilityBaseline(test.info(), results, baseline, {
    baselinePath: 'tests/e2e/accessibility-baseline.json',
  })
})
```

The helpers take axe RESULTS rather than building the scan, so the app keeps
control of `AxeBuilder` options and this package never imports axe —
`@axe-core/playwright` is an optional peer for exactly that reason.

Three properties axe has no rule for ship alongside it, each one a promise a
design system can silently lose: `expectNoOverflowAtTextZoom` (scales the ROOT
font size, because zooming a viewport out passes while real 200% text still
overflows), `expectStateNotCarriedByColourAlone`, and
`expectNoTransitionsUnderReducedMotion` — which asserts transitions are REMOVED
rather than shortened, since a 40ms animation still animates and the people the
setting exists for are the ones a shorter one does not help.

Axe settles the mechanical half: contrast, accessible names, landmark and
heading structure, invalid ARIA, form labelling. It cannot judge whether a
reading order makes sense, whether an accessible name is useful, or whether a
person using a screen reader can complete a task. A conformance claim resting on
this alone should say so.

### The estate bar: zero serious/critical on the PR subset

The ledger above answers "did this change move the debt?". It tolerates known
debt by design, which is what lets it be pointed at an app on day one. It is not
a shipping gate.

`expectAccessible` is the gate. It runs the scan itself — estate tag set, estate
disable list — and fails on any violation whose impact is `serious` or
`critical` (Logan, 2026-09-17: "Zero serious/critical in the PR subset").
Moderate and minor findings are recorded and do not fail:

```ts
import { expectAccessible } from '@narduk-enterprises/narduk-testkit/playwright/accessibility'

test('/map is accessible', async ({ page }) => {
  await page.goto('/map')
  await expectAccessible(page, { key: '/map' })
})
```

Unlike the ledger helpers, this one owns the scan, and that is the point: the
tag set and the disable list are the _estate's_, so an app cannot quietly lower
the bar in its own spec file. It asserts against **WCAG 2.1 AA**
(`WCAG_2_1_AA_TAGS`) rather than the 2.2 set the ledger uses — a gate that fails
a PR should fail it against the level the product actually claims.

A failure gives you both halves of the evidence:

- **the message** carries one line per blocking violation — rule id, impact, the
  first selector, the Deque help URL — because that is what fits in a CI log and
  is usually enough to start the fix;
- **the attachment** (`accessibility-<route>.json` on the Playwright test)
  carries _every_ violation at _every_ impact, because the moderate and minor
  findings that did not fail this run are the inventory the next piece of work
  is planned from. A gate that discards them makes the app look cleaner than it
  is.

`expectAccessible` returns that report, so a spec sweeping several routes can
aggregate them into an inventory of its own.

**`ESTATE_DISABLED_AXE_RULES` is empty, and the empty list is the position.** A
disabled rule is permanent silence on every route of every app and it outlives
the component that justified it, so the bar for adding one is that the rule is
_wrong_ on this stack — not that it is inconvenient here. "The component library
emits it" is not grounds: that makes the library the owning layer and the fix
belongs there. "It is noisy" is not grounds either: noise below the threshold
already fails nothing. The rules a list like this usually exists for — `region`,
`landmark-one-main`, `page-has-heading-one`, `heading-order` — are
best-practice-tagged and never reach the gate at all. An entry that does earn
its place carries a reason and a link, so a later reader can retire it once
upstream fixes it.

`@axe-core/playwright` stays an optional peer: the import is dynamic, so an app
that uses only the ledger helpers never installs a scanner it does not run, and
an app that calls `expectAccessible` without it gets a sentence naming the
package rather than a module-resolution stack trace.

### Adding the bar to an app's PR subset

The gate belongs on the deterministic routes a PR is already gated on, at the
two widths where the layout actually differs — not on a crawl, which turns a
blocking check into a flaky one.

1. **Install the runner** in the app: `pnpm add -D @axe-core/playwright`.
2. **Reuse the PR project's route list rather than writing a second one.** If
   the app already runs a visual audit over a fixed list, export that list and
   import it here; two lists drift, and the day they disagree is the day the
   gate stops covering the route someone actually changed.
3. **Add one spec in the PR project**, iterating routes at one desktop and one
   mobile width:

   ```ts
   import { expect, test } from '@playwright/test'
   import { expectAccessible } from '@narduk-enterprises/narduk-testkit/playwright/accessibility'

   import { PR_SUBSET_ROUTES } from './routes'

   const VIEWPORTS = [
     { height: 900, name: 'desktop', width: 1280 },
     { height: 844, name: 'mobile', width: 390 },
   ]

   for (const viewport of VIEWPORTS) {
     for (const route of PR_SUBSET_ROUTES) {
       test(`a11y ${viewport.name} ${route}`, async ({ page }) => {
         await page.setViewportSize({
           height: viewport.height,
           width: viewport.width,
         })
         await page.goto(route)
         await expectAccessible(page, { key: `${viewport.name} ${route}` })
       })
     }
   }
   ```

   Pass a `key` that names both the route and the width. It is what the failure
   message and the attachment filename are keyed off, and `page.url()` alone
   cannot tell two widths apart.

4. **Wait for the page to settle before scanning.** Axe photographs the DOM at
   the moment it is called; a route whose content arrives after hydration should
   `await expect(page.getByRole(...)).toBeVisible()` first, or the scan grades a
   skeleton and passes.
5. **Fix what it finds in the layer that owns the markup.** A violation in a
   shared component is a `narduk-libs` change, not an app-local override — one
   fix there clears it for every consumer, and an app-local patch leaves the
   next consumer to rediscover it.
6. **Do not silence a rule to get green.** If a finding is genuinely wrong, the
   entry goes in `ESTATE_DISABLED_AXE_RULES` with its reason and link, where
   every app can see it and someone can retire it later.

## Request accounting

`playwright/request-accounting` pins what a page costs, read from the browser's
own Resource Timing entries rather than argued from the code:

```ts
import { expectRequestCounts } from '@narduk-enterprises/narduk-testkit/playwright/request-accounting'

await page.goto('/map')
await expectRequestCounts(
  page,
  { '/api/map-context': 1, '/api/overview': 1 },
  { scope: '/api/' },
)
```

Counts are exact, and with `scope` set a request that matches no budget entry is
also a failure — so a page that starts fetching a fifth thing on boot has to say
so.

## Console tracking and optional telemetry

`playwright/ui-quality`'s `createConsoleTracker` collects console errors,
console warnings and `pageerror`s for the run and asserts the page produced
none:

```ts
import { createConsoleTracker } from '@narduk-enterprises/narduk-testkit/playwright/ui-quality'

const consoleTracker = createConsoleTracker(page, {
  ignoredPatterns: [/^\[build\]/],
})
// ... navigate, capture, assert ...
await consoleTracker.expectClean()
```

An object rule scopes that ignore to a failed HTTP response. The tracker records
4xx/5xx URLs from `page.on('response')` and matches `url` against those, not
against the console line's `location().url` — Chromium often attributes a failed
resource load to the document. Each ignore consumes one matching failed URL, so
a later first-party failure with the same console text is still reported:

```ts
const consoleTracker = createConsoleTracker(page, [
  { text: /Failed to load resource/, url: /\/api\/mapkit-token/ },
])
```

`telemetry: 'stub'` is for the suite that has to pass on a machine whose network
is not the internet's:

```ts
const consoleTracker = createConsoleTracker(page, {
  extraTelemetryHosts: [process.env.POSTHOG_HOST ?? 'https://p.nard.uk'],
  ignoredPatterns: [/^\[build\]/],
  telemetry: 'stub',
})
await consoleTracker.ready // before the first navigation
```

It blocks every request to an optional-telemetry origin before it reaches the
network, the way a content blocker does — Cloudflare Insights, Google Tag
Manager, Google Analytics, PostHog, and any host in `extraTelemetryHosts` — and
drops the console and `pageerror` entries those origins produce. Use it when a
suite runs against a real deployment and the question it is meant to answer is
about the app, not about whether this laptop can reach an analytics CDN: a
tailnet resolver answering `0.0.0.0` for `static.cloudflareinsights.com`
otherwise turns `expectClean()` into a test of the operator's DNS, and the only
available fix is to stop asserting console cleanliness at all.

**What stays fatal, in both modes**: every first-party console error, including
a first-party request that fails; Vue and Nuxt hydration warnings; every console
error with no source URL; and any `pageerror` whose topmost stack frame is not
itself telemetry code. Requests are matched by ORIGIN rather than by message
text on purpose — `Failed to load resource` is the same sentence whether the
resource was an analytics beacon or the app's own API, so an allowlist written
against that text would hide the second along with the first.

The requests are **aborted rather than answered** with an empty `204`, which is
what this option shipped as in 1.3.1. Cloudflare injects its RUM beacon with an
`integrity` attribute, so an empty body is a body that fails Subresource
Integrity, and Chromium reports that failure against the DOCUMENT rather than
the beacon — which is to say, as an error no origin-scoped filter can attribute
to telemetry. Measured against a real deployment, the `204` traded three
`ERR_CONNECTION_REFUSED` errors for six unattributable SRI errors. An aborted
request is never integrity-checked, and the `ERR_BLOCKED_BY_CLIENT` entry it
leaves does carry the telemetry URL.

`extraTelemetryHosts` exists because an app's own analytics host is not knowable
from here. The Narduk fleet proxies PostHog under a per-app `POSTHOG_HOST`
(`runtimeConfig.public.posthogHost`), and this package has no runtime dependency
on the app or on `@narduk-enterprises/narduk-analytics` to read it from. Entries
accept a bare hostname or the configured URL, and match that host and its
subdomains.

## Fixture server

`e2e/fixture-server` serves an app's BUILT output with recorded responses
standing in for its API. It is for the app that is not a Nuxt app: a Cloudflare
Worker, a Vite SPA, anything whose `dist/` is static files plus a JSON API.

```ts
import { startStaticFixtureServer } from '@narduk-enterprises/narduk-testkit/e2e/fixture-server'

const server = await startStaticFixtureServer({
  assets: 'dist/client',
  buildCommand: 'pnpm run build',
  fixtures: 'tests/e2e/fixtures',
  routes: {
    '/api/overview': { file: 'overview.json' },
    '/api/routes/': ({ url }) => ({
      file: `route${url.pathname.split('/').pop()}.json`,
    }),
  },
})
```

Every extensionless path is rewritten to the HTML entry, so deep links behave
the way they do behind a real static host. A path inside `scope` (default
`/api/`) with no recorded fixture is answered **501**, not a plausible empty
body — a spec that navigates somewhere the recording does not cover fails loudly
instead of asserting against an empty state the product does not have. The port
is ephemeral by default so parallel suites cannot collide.

This subpath is deliberately absent from the root barrel: it is imported from a
Playwright _config_, which is evaluated before the runner exists, and the barrel
registers Playwright fixtures at module scope.

## Local dev port

One scaffolded dev port per app is one port per _machine_: every worktree of the
app shares it, so `reuseExistingServer` attaches to whichever worktree's
`nuxt dev` got there first and the suite silently tests the wrong branch
(narduk-libs#417).

```ts
import {
  assertLocalDevPortAvailable,
  resolveLocalDevPort,
  shouldReuseExistingServer,
} from '@narduk-enterprises/narduk-testkit/playwright/dev-port'

const devPort = resolveLocalDevPort({
  rootDir: process.cwd(),
  declaredPort: 51952,
})
const reuseExistingServer = shouldReuseExistingServer({ resolution: devPort })
if (!reuseExistingServer) assertLocalDevPortAvailable({ resolution: devPort })
```

`rootDir` is any directory inside the checkout — the resolver walks up to the
nearest `.git`, so `process.cwd()` is enough. Prefer it to `import.meta.url`:
Playwright transpiles a TypeScript config to CJS unless something
(`--import tsx`, `"type": "module"`) says otherwise, and `import.meta` is a
syntax error there.

A **linked git worktree** derives `declaredPort + hash(checkout path) % 1000`,
so two lanes on one machine cannot collide with no environment variable set, and
the port is the same on every run of that worktree. The **primary checkout** and
every **CI** run keep the declared port, so muscle memory, bookmarks and any
localhost allowlist (OAuth callbacks, map-token origins) still work.
`PLAYWRIGHT_PORT`, then `NUXT_PORT`, overrides both.

A derived port is not reused: `shouldReuseExistingServer` returns `false` there,
so a residual collision — a hash clash, or an unrelated process — fails loudly
via `assertLocalDevPortAvailable`, which names the port and the override,
instead of becoming another silent wrong-branch pass.
`PLAYWRIGHT_REUSE_SERVER=1` opts back in for a lane driving its own long-lived
`nuxt dev`.

Like `e2e/fixture-server`, this subpath is deliberately absent from the root
barrel — it is imported from a Playwright config, before the runner exists.

## Playwright `pr` / `web` tier preset

`playwright/config` is the estate Playwright config: a cheap `pr` project for
pull requests and a full `web` project for push/main. Spread it. Do not invent a
third `chromium`-only project — that is how an undeclared spec is collected
twice and a 10-test PR suite becomes 36 (narduk-libs#434).

```ts
import { defineConfig, devices } from '@playwright/test'

import { createNardukPlaywrightPreset } from '@narduk-enterprises/narduk-testkit/playwright/config'
import {
  assertLocalDevPortAvailable,
  resolveLocalDevPort,
  shouldReuseExistingServer,
} from '@narduk-enterprises/narduk-testkit/playwright/dev-port'

const devPort = resolveLocalDevPort({
  rootDir: process.cwd(),
  declaredPort: 51952,
})
const reuseExistingServer = shouldReuseExistingServer({ resolution: devPort })
if (!reuseExistingServer) assertLocalDevPortAvailable({ resolution: devPort })

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  ...createNardukPlaywrightPreset({
    baseURL: `http://127.0.0.1:${devPort.port}`,
    browserUse: devices['Desktop Chrome'],
    testDir: './apps/web/tests/e2e',
  }),
  webServer: {
    command: `PORT=${devPort.port} pnpm --filter web run dev:test`,
    url: `http://127.0.0.1:${devPort.port}/api/health`,
    reuseExistingServer,
  },
})
```

The preset is `fullyParallel: true` and `workers: 2`. That worker count is the
measured default from Buoys' `e2e-parallel-config` experiment (2026-09-17): 1 is
Playwright's `CI` default and is why 2-vCPU and 8g slots both ran serial; 2 cut
local web median 69s → 39s; 4 workers were slower on one workerd. Do not raise
`e2e-shards` — a second pool slot recreates the queue storms.

A file that must not contend with another heavy file on that one workerd
(visual-audit, a 44-scan a11y file) opts out **per file**, not by flipping the
preset:

```ts
test.describe.configure({ mode: 'serial' })
```

### Spec → tier

A spec declares its tier in the filename. Collection uses `testMatch`, so an
undeclared file is in **no** project — and
`createNardukPlaywrightPreset({ testDir })` throws if one still exists, so it
cannot hide.

| File                       | Collected by                       |
| -------------------------- | ---------------------------------- |
| `home.pr.spec.ts`          | `pr`                               |
| `visual-audit.web.spec.ts` | `web`                              |
| `headers.pr-web.spec.ts`   | `pr` and `web` (explicit dual-run) |
| `orphan.spec.ts`           | none — config load throws          |
| `global.setup.ts`          | `setup` only                       |

Dual-run is the `.pr-web.` name, an explicit reviewable choice. CI selects the
tier with `--project=pr` on pull_request and `--project=web` on push. Pass
`chromiumAlias: true` to register a `chromium` project that collects the same
specs as `web`, so `--project=chromium` still runs the web tier. The alias is
off by default: a bare `playwright test` would otherwise run every `.web` /
`.pr-web` spec twice.

`specFiles` is an extra assertion list, not a replacement for the `testDir`
scan. When both are passed, undeclared files still under `testDir` fail config
load.

### Quarantine (`@quarantine`)

A flake leaves the PR gate with a Playwright tag, not `test.skip` and not
`test.fixme`. `pr` and `web` set `grepInvert: /@quarantine/`, so a tagged spec
is not collected there. The `quarantine` project sets `grep: /@quarantine/` so
the same spec still has a home (`--project=quarantine`).

```ts
import { test } from '@playwright/test'
import { quarantineDetails } from '@narduk-enterprises/narduk-testkit/playwright/config'

test(
  'flaky checkout',
  quarantineDetails({ issue: 'app#12', date: '2026-09-24', owner: 'logan' }),
  async ({ page }) => {
    /* … */
  },
)
```

A quarantine with no issue is not a quarantine. The vitest guard is checked
against what Playwright actually collected (`playwright test --list`), so an
untagged test in `quarantine` or a tagged test still collected by `pr` fails the
unit suite. Default `--list` titles omit `{ tag: '@quarantine' }` from
`quarantineDetails`, so pass `readSource`. The source check uses the listed
`file:line:col`, so one quarantined test does not quarantine its siblings.
`readSource` does not see `test.describe(..., quarantineDetails(...), …)` — tag
the test itself, or use JSON `--list --reporter=json`, which fills `tags`
including describe-inherited ones.

```ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  assertPlaywrightQuarantineCollection,
  parsePlaywrightListOutput,
} from '@narduk-enterprises/narduk-testkit/playwright/config'

const listed = execFileSync('pnpm', ['exec', 'playwright', 'test', '--list'], {
  encoding: 'utf8',
})
assertPlaywrightQuarantineCollection({
  collected: parsePlaywrightListOutput(listed),
  readSource: (file) => readFileSync(file, 'utf8'),
})
```

### Collection-time viewports

Viewport slice lives on project metadata (`metadata.visualAuditViewports`).
Filter at collection so a skipped viewport never constructs a `page` fixture —
in-body `test.skip` still pays setup.

```ts
import {
  createNardukPlaywrightPreset,
  viewportsAtCollection,
} from '@narduk-enterprises/narduk-testkit/playwright/config'

const preset = createNardukPlaywrightPreset({
  testDir,
  prViewports: ['desktop'],
})
const prProject = preset.projects.find((project) => project.name === 'pr')!
const viewports = viewportsAtCollection(ALL_VIEWPORTS, prProject)
for (const viewport of viewports) {
  test(`a11y ${viewport.name}`, async ({ page }) => {
    /* … */
  })
}
```

`pr` defaults to `desktop` + `mobile`. `web` defaults to those plus `tablet` and
`wide`. Pass `prViewports` / `webViewports` to change the slice. Pass the
project from the preset — not `{ name: 'pr' }` — so collection uses that custom
slice.

This subpath is config-safe: `import` and `require` both resolve, and it is
absent from the root barrel.

The UI-quality analyzer is also available as a small binary:

```sh
narduk-testkit ui analyze output/playwright/visual-audit
```

Playwright and Vitest are peer dependencies so each app controls its test runner
version. The analyzer uses `sharp` as a package runtime dependency.

## Readiness setup test (`e2e/readiness`)

`createNardukPlaywrightPreset` declares a `setup` project matching
`global.setup.*` that `pr` and `web` depend on. `registerReadinessSetup` is the
body of that file (narduk-libs#1000), so no spec file needs its own
`beforeAll(waitForBaseUrlReady + warmUpApp)` guard — the spec files that forget
it are the ones that flake.

```ts
// tests/e2e/global.setup.ts
import { registerReadinessSetup } from '@narduk-enterprises/narduk-testkit/e2e/readiness'

registerReadinessSetup()
```

It registers one test, `app is ready for e2e navigation`, which:

1. waits for the base URL to answer (`waitForBaseUrlReady`);
2. polls `GET /api/health` until it answers 200 with JSON whose status (the
   narduk-core `{ data: { status } }` envelope, or a bare `{ status }`) is `ok`
   or `degraded`, then runs `expectHealth`;
3. loads each warm path once (`warmUpApp`), outside any test clock.

| Option           | Default         | Meaning                                                             |
| ---------------- | --------------- | ------------------------------------------------------------------- |
| `healthPath`     | `'/api/health'` | Health route; `false` skips the health read.                        |
| `acceptDegraded` | `true`          | `false` requires `status: 'ok'`.                                    |
| `expectHealth`   | none            | `(body) => void`; throw to fail (e.g. a publication check).         |
| `warmPaths`      | `['/']`         | Routes to compile before any test; the first cold load can take 8s. |
| `timeoutMs`      | `150_000`       | Budget for base URL + health; warm loads get their own time.        |

An app not on the preset adds a `setup` project matching `global.setup.ts` and
lists it in its projects' `dependencies` by hand. With a setup project, a
failing health check skips every test instead of failing them one by one. An app
that keeps its own setup test can call
`runReadinessChecks({ baseURL, browser }, options)` for the same sequence.

## Browser setup and the e2e runner (`narduk-testkit e2e`)

`narduk-testkit e2e` replaces the `scripts/setup-playwright-browsers.mjs` and
`scripts/run-web-e2e.mjs` copies the retired narduk-template left in apps
(narduk-libs#997). Point the app's scripts at it:

```json
{
  "test:e2e": "narduk-testkit e2e run",
  "test:e2e:setup": "narduk-testkit e2e setup"
}
```

| Command                                   | Does                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `narduk-testkit e2e check`                | Launches Chromium headless with the app's `@playwright/test`. Exit 1 with the setup hint if it cannot. |
| `narduk-testkit e2e setup [-- <args>]`    | `playwright install chromium` (plus `<args>`, e.g. `--with-deps`) into the ambient or shared cache.    |
| `narduk-testkit e2e run [opts] [-- args]` | `check`, then `playwright test`. Arguments it does not own go to Playwright.                           |

`run` options: `--config <path>` (default: the first of `playwright.config.ts`
and `apps/web/playwright.config.ts` that exists, else Playwright's own
discovery; a `--config`/`-c` in the Playwright args wins),
`--default-project <name>` (default `web`) and `--no-default-project`.

The rules it enforces, each the fix for a drift found across the copies:

- **One browser cache per machine.** A non-empty ambient
  `PLAYWRIGHT_BROWSERS_PATH` (isolated CI guests export one) is used exactly;
  otherwise Playwright's shared default cache. It never picks a per-checkout
  `.cache/ms-playwright`, which downloaded ~500 MB per worktree.
- **The check launches the browser.** A binary that exists can still fail to
  start (missing shared libraries, a quarantined binary); the hint quotes the
  launch error.
- **`--project=web` only when you chose no project.** Playwright accumulates
  repeated `--project` flags, so `pnpm test:e2e --project=pr` with an
  unconditional default would run `pr` **and** the whole `web` tier and still
  report success.
- **`--import tsx` once**, added to `NODE_OPTIONS` only when the app has `tsx`
  installed.

An app that keeps its own runner imports the same rules from
`playwright/config`:

```ts
import {
  resolveBrowserCachePath,
  withDefaultProject,
} from '@narduk-enterprises/narduk-testkit/playwright/config'

resolveBrowserCachePath(process.env) // ambient path, or undefined = Playwright's shared cache
withDefaultProject(process.argv.slice(2), 'web') // adds --project=web only if none was chosen
```

App-specific pre-steps (a `db:ready`, a config somewhere else) stay in the app's
script, chained before `narduk-testkit e2e run`.

## D1 query harness

`@narduk-enterprises/narduk-testkit/d1` runs code under test against a real
Miniflare D1 database (the workerd SQLite the platform runs) created from your
own migration files, and records every statement it executes. It is a Vitest
helper; it installs no matchers and fails by throwing.

It proves query **shape**: how many statements a route emits, whether that count
holds as data grows, which index SQLite picks, and how many bytes the response
carries. It does **not** prove latency. Miniflare runs on the test machine with
no network hop, no replica and no production load, so its timings mean nothing,
and none of these helpers measures one.

`miniflare` is an optional peer dependency: add it to the app's
`devDependencies`. It is loaded only when a harness is created, so importing the
subpath never requires it. Miniflare 4 and 5 both work from 1.6.3. Keep
`miniflare` on the major your `wrangler` ships: every `wrangler` from 4.129
ships 5.

Resolve `undici` 7.29.1 or later under Miniflare, or every harness statement is
about three times slower. Miniflare pins its `undici` exactly (7.28.0 in
4.20260708, 7.29.0 in 5.20260921.0-alpha), and on either of those one awaited D1
call from a test costs about 6.5ms; on 7.29.1 it costs about 2ms, measured on
both Miniflare majors (narduk-libs#740). A test that seeds a few hundred rows
one `await` at a time crosses a 60s timeout on the CI pool at the slower rate.
Apps generated by `create-narduk-app` carry the override; an older app adds it
to the root `package.json`:

```json
"pnpm": { "overrides": { "miniflare>undici": "^7.29.1" } }
```

```ts
import { drizzle } from 'drizzle-orm/d1'
import {
  createD1QueryHarness,
  expectQueryPlan,
  expectStatementBudget,
  scaleMatrix,
} from '@narduk-enterprises/narduk-testkit/d1'

const d1 = await createD1QueryHarness({ migrations: 'drizzle' })
// afterAll(() => d1.dispose())

const db = drizzle(d1.db) // recorded: hand this to the code under test
await d1.raw.prepare('INSERT INTO users (id) VALUES (?)').bind('u1').run() // unrecorded: seeding

// At most one page query plus one count query.
const { result, statements } = await expectStatementBudget(
  d1,
  () => listUsers(db),
  { max: 2 },
)

// Fails on `SCAN api_keys`; passes on `SEARCH api_keys USING INDEX …`.
await expectQueryPlan(d1, 'SELECT * FROM api_keys WHERE user_id = ?', ['u1'], {
  forbidFullScanOf: ['api_keys'],
})

// Same statement count in every cell, or it throws with the per-cell counts.
const cells = await scaleMatrix(d1, {
  axes: { history: [0, 1_000], live: [1, 50] },
  seed: async ({ history, live }) => seedRows(d1.raw, { history, live }),
  run: () => loadLiveView(db),
})
expect(cells.find((c) => c.history === 1_000 && c.live === 50)?.result).toEqual(
  cells.find((c) => c.history === 0 && c.live === 50)?.result,
)
expect(Math.max(...cells.map((c) => c.bytes))).toBeLessThan(64_000)
```

| Export                                                        | Does                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createD1QueryHarness({ migrations, compatibilityDate? })`    | Applies `migrations` (a list of `.sql` paths, or one directory whose numbered files are applied in lexical order, skipping utility SQL such as `seed.sql` — the discovery `narduk-app db migrate` uses). Returns `{ db, raw, statements, reset(), clearData(), dispose() }`.                   |
| `expectStatementBudget(harness, fn, { max })`                 | Resets the recorder, runs `fn`, throws if it executed more than `max` statements. Returns `{ result, statements }` so a test can also pin the exact count.                                                                                                                                     |
| `expectQueryPlan(harness, sql, params, { forbidFullScanOf })` | Runs `EXPLAIN QUERY PLAN` and throws on a `SCAN <table>` step for any named table (including `SCAN … USING COVERING INDEX`, which still reads every entry). Returns the plan lines. Tables match the name the plan prints, which is the alias when the query aliases one.                      |
| `scaleMatrix(harness, { axes, seed, run })`                   | For each `history` × `live` cell: `clearData()`, `seed(cell)`, then `run()` recorded. Throws unless every cell executed the same number of statements. Returns `{ history, live, statements, bytes, result }[]`; `bytes` is the UTF-8 size of a string/bytes result, or of its JSON otherwise. |
| `splitSqlStatements(sql)`                                     | Strips `--` and `/* */` comments and splits on `;`. It does not parse SQL: a `;` inside a string literal or a trigger body is not supported.                                                                                                                                                   |

A statement is recorded when it runs, not when it is prepared (narduk-libs#922):
each `first()`/`all()`/`run()`/`raw()` on `db`, each member of `db.batch()`, and
each `db.exec()`. A per-item loop over one reused prepared statement, which is
what a drizzle `.prepare()`d query does, therefore counts once per item, so the
budget and the scale matrix catch that N+1 too.

`statements` is emptied in place by `reset()`, so a held reference stays live.
`clearData()` deletes every row of every migrated table in one batch with
foreign keys deferred, and keeps the schema.

Inside narduk-libs, packages import the harness from source
(`../../../tooling/narduk-testkit/src/d1`) so their tests need no testkit build;
narduk-auth, narduk-ai, narduk-devices and narduk-core's D1 tests use it.

## Handler test harness

`server/handlers` is for unit-testing a Nitro route handler — an H3 event
handler backed by Cloudflare bindings — without a real Worker runtime, a running
Nitro server, or an HTTP round trip. It belongs to the Vitest runner, alongside
`server/kit`, and is exported from its own subpath so a Playwright-only consumer
of this package never pulls in `node:sqlite` or a `@cloudflare/workers-types`
reference.

```ts
import {
  createFakeEvent,
  readFakeEventResponse,
} from '@narduk-enterprises/narduk-testkit/server/handlers'

const event = createFakeEvent({
  method: 'POST',
  path: '/api/buoys/1',
  params: { id: '1' },
  body: { status: 'active' },
})
await myHandler(event)
const { status, headers, body } = readFakeEventResponse(event)
```

`createFakeEvent` builds a real `H3Event` on top of h3's own
`createEvent(IncomingMessage, ServerResponse)` — the same construction this
monorepo's own tests already build by hand — so it works with h3's public API
(`getQuery`, `readBody`, `getRouterParam`, `getHeader`, `setResponseStatus`,
`setHeader`, ...) rather than a hand-rolled event shape that happens to look
right. `readFakeEventResponse(event, handlerResult?)` reads back what the
handler wrote to the response, decoding a JSON body automatically, and falls
back to the handler's return value when nothing was written directly (the common
case for a plain `defineEventHandler(() => ({ ... }))`).

**Bindings.** `createFakeKVNamespace()`, `createFakeR2Bucket()` and
`createFakeD1Database()` return in-memory fakes shaped like the real
`KVNamespace`, `R2Bucket` and `D1Database` interfaces:

```ts
import {
  createFakeD1Database,
  createFakeKVNamespace,
  createFakeR2Bucket,
} from '@narduk-enterprises/narduk-testkit/server/handlers'

const db = createFakeD1Database()
await db.exec('CREATE TABLE buoys (id INTEGER PRIMARY KEY, status TEXT)')
await db
  .prepare('INSERT INTO buoys (id, status) VALUES (?, ?)')
  .bind(1, 'active')
  .run()

const cache = createFakeKVNamespace()
await cache.put('buoy-status:1', JSON.stringify({ id: 1 }), {
  expirationTtl: 60,
})

const bucket = createFakeR2Bucket()
await bucket.put('report.pdf', pdfBytes, {
  httpMetadata: { contentType: 'application/pdf' },
})
```

`createFakeD1Database` is backed by `node:sqlite` (a Node built-in — no new
dependency), so SQL actually executes rather than returning canned rows:
`prepare().bind().first()/all()/run()/raw()` behave like the real thing, and
`batch()` runs inside a real `BEGIN`/`COMMIT`/`ROLLBACK` transaction, so a
failing statement partway through a batch rolls back every statement in it. Pass
an existing `node:sqlite` database via `{ database }` to seed schema once and
share it across fakes.

**Runtime requirements.** `server/handlers` is Node-only and test-time only. It
imports `node:sqlite`, `node:http`, `node:net`, `node:stream` and `node:crypto`,
so the package declares `engines.node >= 22.22.0` (the floor at which
`node:sqlite`'s `DatabaseSync`, `columns()` and `setReturnArrays()` are all
available unflagged). It also imports `h3` at runtime and its types use
`@cloudflare/workers-types`' ambient globals; both are declared as optional peer
dependencies, so an app that only uses the Playwright helpers is not made to
install them.

**Do not import this into a Worker bundle.** These fakes exist to replace the
bindings inside a Vitest run; bundling them into deployed Worker code would mean
shipping a SQLite database and a Node HTTP server in place of the real D1/KV/R2
bindings. The `node:` imports make that fail loudly at build time under
Cloudflare's runtime rather than silently — but keep the import inside `tests/`,
and note that this package as a whole is a `devDependency`.

**`callHandler`.** For the common case of a handler that reads its bindings from
`event.context.cloudflare.env`:

```ts
import { callHandler } from '@narduk-enterprises/narduk-testkit/server/handlers'

const response = await callHandler(
  buoyStatusHandler,
  { params: { id: '1' } },
  { env: { DB: db, STATUS_CACHE: cache } },
)
expect(response.status).toBe(200)
```

`callHandler` builds the fake event, wires `env` into
`event.context.cloudflare.env`, calls the handler, and converts a thrown
`H3Error` into the same response Nitro's own error handling would send — so a
handler that `throw createError({ statusCode: 404, ... })` is tested the same
way it runs in production.

**What these fakes do NOT emulate.** Being honest about the gap between a fake
and the real Worker runtime matters more than a longer feature list:

- **D1**: no network latency, no multi-region read consistency, and no
  read-replica sessions — `withSession()` throws, and the deprecated `dump()`
  API throws too, both intentionally, rather than silently returning nothing
  useful.
- **KV**: no eventual consistency. A `put()` is visible to the very next `get()`
  in the same test, which is not how KV behaves in production across regions.
  The 25 MiB value and 1 KiB metadata size limits are not enforced either.
- **R2**: no multipart uploads (`createMultipartUpload` and friends) and no
  conditional reads — `get()` **throws** on `onlyIf` rather than quietly
  ignoring it, because a real bucket answers a failed precondition with a
  body-less `R2Object` and a fake that returned the body would make a broken
  handler green. `put()` does honour the `R2Conditional` form of `onlyIf`: it
  resolves `null` and writes nothing when the condition fails, so
  create-if-absent (`{ etagDoesNotMatch: '*' }`) and a stale-etag write both
  behave as in production. It **throws** on the forms it does not emulate: an
  `onlyIf` `Headers` object and a weak `W/` etag (narduk-libs#916). `list()`
  supports `prefix`, `cursor`, `limit` and `include` but not `delimiter`.
- **Nitro's hooks**: this harness calls a handler directly, so nothing that runs
  in a Nitro lifecycle hook runs here — including narduk-logging's
  `Server-Timing` header, which is set in `beforeResponse`. A handler that sets
  a response header itself is read back normally.

None of that makes these fakes wrong for their job — testing a route handler's
own logic against realistic bindings — but a test that depends on any of the
above belongs against a real (or `wrangler dev`) binding instead.

**Where the fakes are deliberately strict.** Each fake was diffed against a real
binding (workerd, via miniflare), and every place the naive implementation would
have been _more permissive than production_ raises instead — a fake that accepts
what production rejects is how a broken handler gets a green test. So: D1
rejects a `bind()` with the wrong number of values instead of binding NULL,
`first(column)` throws `D1_COLUMN_NOTFOUND` for a column the result set lacks,
`run()` returns rows for a row-returning statement, BLOB columns come back as
D1's plain byte arrays rather than a `Uint8Array`, and `exec()` counts
statements by line the way D1 does. KV stores bytes rather than a decoded string
(so a binary value survives a round trip) and enforces the key rules (no
empty/`.`/`..`/over-512-byte keys) and the 60-second expiration floor. R2
honours `range`, gates `list`'s two metadata maps behind `include`, makes an
object body single-use, rejects a `put()` whose `md5`/`sha*` checksum does not
match the body (with the runtime's `10037` message), and parses a `Headers`
passed as `httpMetadata` into the six fields the runtime keeps.

**Follow-ups.** Several packages already hand-roll the `IncomingMessage`/
`ServerResponse` construction this harness's `createFakeEvent` replaces, plus a
couple of ad-hoc canned KV/D1 stubs (`narduk-core`'s `kv-cache.test.ts` and
`auth-api-key-d1.test.ts`); migrating those is left as follow-up work outside
this package rather than done in this PR.

## Nuxt aliases for plain Vitest

Narduk apps run their unit tests under plain Vitest, without `@nuxt/test-utils`,
so Vitest does not know the `#` aliases that Nuxt and narduk-core register:
`#server`, `#shared`, `~`, `#layer`, `#narduk-db`, `#narduk-core/schema`,
`#narduk-core/postgres-runtime` and the rest. `nuxtVitestAliases()` reads them
from the table Nuxt itself writes, `.nuxt/tsconfig.json`. An alias a module adds
or repoints is then picked up without an edit. For example,
`#narduk-core/schema` moves to `pg-schema.ts` when `databaseBackend` is
`postgres`. Hand-copied aliases never saw that kind of change (narduk-libs#998).

```ts
// apps/web/vitest.config.ts
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { nuxtVitestAliases } from '@narduk-enterprises/narduk-testkit/server/kit/vitest'
import { defineConfig } from 'vitest/config'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      ...nuxtVitestAliases({ appRoot }),
      // app-only aliases and any h3/vue pins go after the helper
    ],
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
```

- **`nuxt prepare` first.** The table exists only after Nuxt has written it. The
  helper throws with that hint when `.nuxt/tsconfig.json` is missing. Use
  `"test:unit": "nuxt prepare && vitest run"`.
- **Only the `#` and `~` namespaces** by default (`namespaces` widens it, for
  example `['#', '~', '@']`). A bare package name such as `h3`,
  `nitropack/runtime` or `@unhead/vue` is never aliased, whatever the namespace,
  because that would shadow the resolution the runtime performs.
- **Exact and prefix keys stay distinct.** `#layer` becomes `^#layer$` and
  `#layer/*` becomes `^#layer/(.*)$`, so any `#layer/...` path resolves, not
  just one hand-picked file. The most specific key comes first, so `#app/types`
  beats `#app/*`.
- **`tsconfig`** reads a different generated file, for example
  `.nuxt/tsconfig.server.json` for server-only aliases.

### `nitropack/runtime` and `#imports`

Plain Vitest runs no Nitro server, so both specifiers are pointed at
`@narduk-enterprises/narduk-testkit/server/kit/nitro-runtime-stub`. The
`nitropack/runtime` match is anchored, so `nitropack/runtime/internal/...` is
left alone. Both specifiers share one runtime config. A test sets it through
either import, and narduk-core, the app and any third-party route that reads
`useRuntimeConfig` all see the same value:

```ts
import { afterEach } from 'vitest'
import {
  resetTestRuntimeConfig,
  setTestRuntimeConfig,
} from '@narduk-enterprises/narduk-testkit/server/kit/nitro-runtime-stub'

afterEach(() => resetTestRuntimeConfig())

setTestRuntimeConfig({ public: { siteUrl: 'https://example.test' } })
```

`useRuntimeConfig()` returns `{}` until a test sets something, which is the
config of a deployment that set nothing. `useEvent()` throws, because there is
no request context. Nothing else from Nuxt's auto-import barrel is stubbed: a
module that needs more fails loudly instead of resolving to a silent stand-in.
Pass `stubs: { imports: false, nitroRuntime: false }` to keep your own stubs.

A module under `node_modules` that imports `#imports` (a published Nitro route)
must be inlined with `test.server.deps.inline` so Vite applies the alias to it.
