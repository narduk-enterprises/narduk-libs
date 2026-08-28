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
