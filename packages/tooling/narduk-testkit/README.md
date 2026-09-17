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

The UI-quality analyzer is also available as a small binary:

```sh
narduk-testkit ui analyze output/playwright/visual-audit
```

Playwright and Vitest are peer dependencies so each app controls its test runner
version. The analyzer uses `sharp` as a package runtime dependency.
