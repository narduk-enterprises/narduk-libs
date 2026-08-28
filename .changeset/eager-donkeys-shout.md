---
'@narduk-enterprises/narduk-testkit': minor
---

Three new subpaths for e2e suites that commit evidence, extracted from a
Cloudflare Worker app's Playwright suite where each one was load-bearing.

**`playwright/deterministic-capture`** — `prepareDeterministicPage`,
`freezePageClock`, `emulateReducedMotion`, `waitForVisualQuiescence`,
`captureStableScreenshot` and `expectRepeatableCapture`. It carries three
measured findings that each cause silent, hard-to-attribute screenshot churn on
`playwright@1.61.1`:

- `page.clock.setFixedTime()` replaces `window.performance` with a plain object
  stub, so `getEntriesByType('resource')` returns zero entries on a page that
  just fetched four API responses. Nothing throws; any request or performance
  budget built on Resource Timing simply starts passing for the wrong reason.
  `freezePageClock` patches `Date.now` and `new Date()` through a Proxy and
  leaves the performance timeline alone.
- `use: { reducedMotion: 'reduce' }` resolves into `project.use` and is then
  dropped on the way to the browser context — the page answers `no-preference`,
  and an app that reads the media query renders a different, sometimes
  differently sized tree. `emulateReducedMotion` applies it on the page, where
  it takes effect.
- Playwright's `fullPage` capture is not repeatable: six consecutive calls
  against a settled page produced hashes A B A B A B, the same 23 pixels
  flipping one 8-bit step along a rounded border. `captureStableScreenshot`
  grows the viewport to the document instead, which is one paint and is stable —
  and stops stranding `position: fixed` chrome partway down a tall page.

`captureStableScreenshot` also photographs twice and requires byte equality —
retrying the pair (re-settling between attempts, three times by default) so that
a loaded CI runner slipping one paint into the gap is not a red test, while a
screen that never comes to rest still fails and says so.
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
cover. Extensionless paths are rewritten to the HTML entry so deep links behave
as they do behind a real static host; an unrecorded path inside the API scope is
answered 501 rather than a plausible empty body; the port is ephemeral by
default. It is deliberately not re-exported from the root barrel, because it is
imported from a Playwright config, which is evaluated before the runner exists.
