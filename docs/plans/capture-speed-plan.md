# Fast, honest screen capture — spec for narduk-testkit, journeys, the capture audit and the playbook

> **Status (2026-11-12): spec only. Nothing here is implemented.** Written for a
> separate implementing session. Work items are in [section 9](#9-work-items);
> each names the files it owns, its done-when and what can run in parallel.
> Nothing in this document has been timed. Every speed claim below is a
> mechanism, not a measurement; section 8 is the protocol that turns mechanisms
> into numbers, and the plan's done-when is measured, not argued.

## 1. Why this exists

Logan, 2026-11-12: web-app screenshot sweeps with "tons of screenshots" take far
too long, and he wants them faster. The first question was whether a tool other
than Playwright would help. A web search found no faster local engine: Puppeteer
is about tied with Playwright on one page, the "built for agents" browsers save
LLM tokens rather than seconds, and Lightpanda has no renderer so its
screenshots are placeholders. Almost all of those numbers come from vendors
selling screenshot APIs. **The engine is not the problem. The harnesses around
it are.**

### 1.1 What the code shows (read 2026-11-12, not timed)

`pacc-trac` `test/vqa/gallery.mjs`, the full-gallery sweep (the spec reviewer
counted 51 captured features and about 130 default shots in
`docs/catalog/features.mjs`, four of them public and so without sign-in; W0
re-counts):

| Behaviour                                    | Where                                                                                                                                | Effect                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| One browser per run (**good**)               | `gallery.mjs:45`, also `shoot.mjs`, `k2-viewports.mjs`, `qa-sweep.mjs`, `phone-renders.mjs`                                          | A "warm browser" would save one launch per run, not per shot.                                                                                      |
| A new context for every feature × viewport   | `gallery.mjs:115`                                                                                                                    | Context creation per shot.                                                                                                                         |
| Every context signs in again                 | `lib.mjs:83` `attachAuth`: opens a page, loads `/sign-in`, POSTs the login, fetches `/api/terms` (and may accept)                    | Roughly three extra requests and a page load per shot, before the shot. The file's own comment says it authenticates "once per role"; it does not. |
| Strictly serial                              | nested `for` loops; no pool anywhere in `gallery.mjs`, `shoot.mjs`, `k2-viewports.mjs`                                               | One page at a time on a many-core machine.                                                                                                         |
| `waitUntil: 'networkidle'` plus fixed sleeps | `gallery.mjs:135-139` (700 ms, +400 ms with a setup step); `shoot.mjs` 600 ms; `k2-viewports.mjs` 900-2500 ms; `qa-sweep.mjs` 800 ms | Dead time on every page, and `networkidle` waits on anything that polls.                                                                           |
| `fullPage: true` at `deviceScaleFactor: 2`   | `gallery.mjs:147`, `shoot.mjs`                                                                                                       | Large rasters and PNG encodes everywhere.                                                                                                          |

`narduk-libs` itself has the same shapes:

- `journeys/src/web.ts:415-417`: every `goto` waits for `load`, then
  `networkidle` (15 s, errors swallowed), then `sleep(700)` when paced.
- `journeys/src/web.ts:566-581`: one new context per journey; a non-secret role
  signs in inside the journey page every time. A saved `storageState` is used
  only for secret-class roles and only in capture mode (`web.ts:556`), to keep
  the credential out of the recording.
- `journeys/src/web.ts:545`: `worldHooks.prepare(scenarioId)` runs for every
  journey.
- `journeys/src/web.ts:466-481`, `worker-binding.ts`: a Playwright worker pool
  is refused unless each worker has its own `base` and `world`. This is a
  correct safety rule and stays.
- `narduk-testkit/src/playwright/deterministic-capture.ts`: `networkidle`, then
  `document.fonts.ready`, then a DOM quiet window, then two captures that must
  be byte-identical, with `fullPage` done by growing the viewport. This is slow
  **on purpose**, for committed baselines. It is not the bug and must not be
  "optimised".
- Capture mode in journeys bundles things that do not need each other: video,
  human-speed pacing, and a still after every step (`web.ts:614-616`).
- The journeys `goto(path)` takes no readiness argument, so an app-declared
  ready selector (D2) cannot reach journeys without a contract change; section
  9.1 lists it.

### 1.2 How widespread (matched lines, not defects)

A grep over the repos under `~/code` on 2026-11-12 for `networkidle`,
`waitForTimeout`, `newContext(`, `storageState`. **These are matched source
lines, not confirmed defects**; a `newContext` call is not a bug and a
`waitForTimeout` may be legitimate. They only say where to look first.

| Repo             | capture-ish files | `networkidle` | `waitForTimeout` | `newContext(` | `storageState` |
| ---------------- | ----------------: | ------------: | ---------------: | ------------: | -------------: |
| operator-portal  |                66 |             1 |                5 |            13 |              0 |
| pacc-trac        |                40 |            53 |               39 |            44 |              4 |
| stonx            |                20 |             3 |                6 |            16 |             29 |
| mybo-at-v2       |                20 |            10 |                5 |             9 |              1 |
| kzfr-website-bid |                14 |             0 |               22 |            11 |              0 |
| narduk-libs      |                13 |             5 |                4 |             5 |              4 |

This table is why a reusable audit is worth building. It was gathered once, at
Logan's request, to size the audit; it was not a search for adopters and it is
not a rollout list. `AGENTS.md` here forbids searching other apps to find
adopters, so adoption happens through the audit being run in a repo that asks
for it, and through adoption issues filed from real evidence
([section 9, W7](#9-work-items)).

## 2. Goals and non-goals

**Goals**

1. Make a many-shot sweep (gallery, route sweep, demo capture) as fast as the
   machine and the app allow, without making a capture lie about what a user
   sees.
2. One shared, measured way to sign in once, share browser state, settle a page
   and run captures with bounded parallelism, so no repo hand-rolls it.
3. A written playbook: how to write an efficient, correct capture script.
4. An audit that finds the bad patterns in any repo, says why each is slow, and
   says how to fix it.
5. Keep what is deliberately slow (deterministic baselines, the world-session
   rule) exactly as safe as it is today.

**Non-goals**

- Switching engines. No migration to Puppeteer, Selenium, Lightpanda, Rod,
  hosted browser pools or agent-browser. Section 10 records why and when to
  revisit.
- A long-lived browser daemon. Reuse within one run is already the norm and is
  not the cost.
- Changing what any existing journey or test asserts. Modes differ in pacing and
  artefacts, never in what passes (journey-runner-spec section 3).
- A fleet-wide sweep or sync run from this repo (`AGENTS.md` scope).

## 3. Decisions this spec makes

Each is settled here so the implementing session does not re-open it. Reverse
one only with new evidence.

- **D1. Two capture profiles, never blended.** `deterministic` (committed
  baselines, existing `captureStableScreenshot`) is **unchanged**. `review`
  (galleries, sweeps, demo stills, look-checks) is the new fast path. A caller
  picks one by name; there is no half-way setting. Reason: a speed-up that
  loosens the deterministic path breaks committed PNGs for no gain; a review
  sweep gains nothing from byte-identical double captures.
- **D2. Readiness replaces idleness.** Review capture is ready when `load` has
  fired, the Vue/Nuxt hydration probe has resolved for a Nuxt page,
  `document.fonts.ready` has resolved, and the app's own declared ready selector
  is visible. No `networkidle`, no fixed sleep. Pages that poll or hold a socket
  (which defeat `networkidle` anyway) work unchanged. The hydration probe today
  is `waitForVueHydrated` in `src/e2e/fixtures.ts`, which imports
  `@playwright/test` as a value; W1 extracts the probe into a runner-free module
  and re-exports it from fixtures (section 4.7).
- **D3. Sign in once per role, origin and world generation, not per shot.** A
  session cache stores a Playwright `storageState` keyed by
  `(origin, role, generation)`. `generation` is **required**, not optional: an
  omitted generation would mean the cache never invalidates. An app with no
  reseeding passes the constant `'static'` explicitly. In journeys the value is
  the `generation` that `WorldHooks.prepare` already returns (`types.ts:485`).
  Every context is built from the cached state.
- **D4. Parallelism is bounded and opt-in for read-only work only.** In
  `capture-session`, a bounded pool of pages runs captures that declare
  themselves read-only; a mutating capture is a barrier (the pool drains, the
  capture runs alone, the pool resumes). **Journeys gets no pool in the first
  release**: its contract (section 5) runs journeys serially under one leased
  world with a fresh `prepare` each, so a pool there is a contract loosening,
  not an addition. It stays an open question (section 12) for the contract's
  author.
- **D5. Stills do not pay for video.** Journeys gets a stills-only capture mode
  with no recording and no pacing. Pacing and video stay for the demo mode that
  needs a human-readable pace.
- **D6. One detector set, two surfaces.** The audit's detectors are ESLint rules
  in `eslint-config`; the testkit CLI runs those same rules programmatically.
  The estate already enforces this class of rule through `eslint-config`
  (`narduk/e2e`, including `e2e-timeout-ceiling`), so it is the existing,
  reviewed path. Adding a pack is heavier than it looks; see section 6.
- **D7. Where each artefact lives** (decided by the layout of the estate, not by
  preference):
  - the helper library, the CLI, and the playbook (`docs/` inside the package,
    linked from the README): **narduk-testkit**;
  - the detector rules: **eslint-config**, a new opt-in `capture` pack;
  - the stills mode, sign-in cache and `goto` readiness: **journeys** (no pool
    in the first release, D4);
  - the agent-facing audit skill: **`agent-infrastructure/skills/`**, as a
    section of `visual-qa` plus a thin `capture-audit` entry. narduk-libs has no
    `skills/` directory and a `SKILL.md` placed here would not be discovered
    from other repos. The skill points at the testkit playbook and the CLI; it
    does not duplicate them.
- **D8. Charter.** The audit tool runs in one repo, when invoked, and reports.
  It never opens PRs in other repos, never syncs, never holds a standing
  relationship with an app (`AGENTS.md`, Scope). The PRs this plan does call for
  are task PRs in repos the task names: W6 in pacc-trac (the reference adopter,
  at Logan's request) and W8 in agent-infrastructure (where skills live). An
  estate-wide pass is the skill's job, run by a person or lane who asked for it.

## 4. narduk-testkit

New export `@narduk-enterprises/narduk-testkit/playwright/capture-session`. The
package's Playwright peer is `@playwright/test`, which brings `playwright-core`.
This module uses type-only imports from `playwright-core` and no runtime import
of `@playwright/test`, so it also works from plain `.mjs` scripts (the shape
`pacc-trac`'s `test/vqa/*.mjs` use). It must not import `src/e2e/fixtures.ts` or
`deterministic-capture.ts` for runtime values: both import `@playwright/test`
(`fixtures.ts:1`, and `expect` in `deterministic-capture.ts`).

### 4.1 API (sketch; names are the contract, signatures may be refined in review)

```ts
// Open one browser for the run. Launch options are passed through, never
// invented. `profile` selects readiness and screenshot defaults (D1).
createCaptureRun(opts: {
  profile: 'review' | 'deterministic'
  base: string                  // default origin; a spec may name another (see `origin`)
  engine?: 'chromium' | 'webkit' | 'firefox'   // default chromium; one run, one engine
  launch?: LaunchOptions
  concurrency?: number          // default: see 4.3
  timing?: boolean | string     // true -> stdout summary; string -> JSON path
}): Promise<CaptureRun>

interface CaptureRun {
  // D3. Signs in via the caller's plan at most once per key; reuses the
  // storageState after. `generation` is required: it changes whenever the world
  // is re-prepared (pass 'static' for an app that never reseeds). A capture that
  // lands on the sign-in page mid-sweep (expired session) re-signs in once and
  // retries once, and records that it did; a second bounce is a failure.
  session(key: { origin?: string; role: string; generation: string }, signIn: SignIn): Promise<StorageState | undefined>

  // One capture. Builds (or reuses, see 4.4) a context from the cached
  // storageState, navigates, waits for readiness (D2), shoots, closes the page.
  capture(spec: CaptureSpec): Promise<CaptureResult>

  // D4. Runs specs through a bounded pool. A spec without `readOnly: true` is a
  // barrier: the pool drains, that spec runs alone, the pool resumes.
  captureAll(specs: CaptureSpec[]): Promise<CaptureResult[]>

  close(): Promise<void>   // closes contexts, then the browser; writes timing
}

interface CaptureSpec {
  id: string
  path: string
  device: { name: string; viewport: { width: number; height: number }; dpr?: number; isMobile?: boolean; hasTouch?: boolean }
  colorScheme?: 'light' | 'dark'
  schemeStoredByApp?: boolean               // true when the app keeps the scheme in a cookie/storage (4.4)
  origin?: string                           // overrides `base` (two-origin apps, e.g. yard and desk)
  role?: string
  readOnly?: boolean                        // D4; declared per spec, never inferred
  freshContext?: boolean                    // opt out of context sharing (4.4)
  ready?: string | ((page: Page) => Promise<void>)   // app-declared selector or hook
  setup?: (page: Page) => Promise<void>
  fullPage?: boolean | 'cap'                // see 4.5
  out: string                               // file path
  format?: 'png' | 'jpeg' | 'webp-via-sharp'
}
```

`CaptureResult` carries
`{ id, ok, httpStatus, finalUrl, bouncedToSignIn, ms: { auth, goto, ready, setup, shoot, write } , error? }`.
The per-phase split is required: the audit and the baseline protocol (section 8)
read it.

### 4.2 Review-profile readiness (D2)

In order, each with a short bound and a named failure (never a silent pass):

1. `page.goto(url, { waitUntil: 'load' })`.
2. The Vue/Nuxt hydration probe (`__vue_app__.$nuxt.isHydrating === false`, the
   expression `waitForVueHydrated` uses) when the page is a Nuxt app.
   `waitForHydration` is deprecated and stays unused.
3. `document.fonts.ready`.
4. The spec's `ready` selector or hook, if given.

A page with no `ready` declared falls back to steps 1-3 and the result records
`readyDeclared: false`, which the audit surfaces as "this capture could be
photographing a still-loading screen". The fallback exists so adoption is
incremental, not so it is the target.

### 4.3 Concurrency default

Bounded pool, never unbounded (unbounded tabs exhaust memory and thrash the
target). The default is a function of `os.availableParallelism()` with a hard
ceiling, **and the number is chosen from the phase-0 measurements, not guessed
here**. Overridable by option and by env (`CAPTURE_CONCURRENCY`). Respect the
target: a hosted staging origin gets a lower default than localhost.

### 4.4 Contexts

Reuse is allowed where Playwright permits it; a new context is required where a
setting is context-level. Implementer verifies against the installed Playwright
version (not assumed here):

- Viewport size can change per page (`page.setViewportSize`); `colorScheme` can
  be emulated per page (`page.emulateMedia`). (Checked against Playwright
  1.61.1, the lockfile version, by the spec reviewer.)
- `deviceScaleFactor`, `isMobile` and `hasTouch` are fixed when a context is
  created, so a "phone" device needs its own context.
- **An app that stores its colour scheme itself is the exception.** pacc-trac
  keeps the scheme in a `pacc-trac` cookie, and its own scripts note that the
  browser's `colorScheme` alone never reaches light (`qa-sweep.mjs:309-310`,
  `k2-viewports.mjs:137`). Concurrent pages in one context would race on that
  cookie, so for such an app the scheme is part of the context key
  (`schemeStoredByApp: true`).
- The context key is therefore
  `(origin, role, generation, deviceScaleFactor, isMobile, hasTouch, appScheme?)`,
  with a page opened per capture inside it.
- **Context sharing can change what a screen shows.** Pages in one context share
  cookies, localStorage and the HTTP cache, so a first-visit or onboarding
  screen, a "seen" flag, or a cache-dependent state can differ from a
  fresh-context shot. That is acceptable for ordinary read-only screens and
  wrong for first-visit captures: such a spec sets `freshContext: true`. A
  capture that mutates state is a barrier (D4) and gets a fresh context.
- Engines are not mixed inside one run (`qa-sweep.mjs` uses WebKit for phones):
  a caller that needs two engines makes two runs.

### 4.5 Screenshots

- Review profile defaults to `deviceScaleFactor: 1` for sweeps and lets the
  caller ask for 2 where retina evidence is the point; the audit flags a blanket
  default of 2 only as informational.
- `fullPage` is explicit per spec. Offer a `'cap'` mode that bounds capture
  height, so one pathological page cannot dominate a sweep.
- Pass `animations: 'disabled'` and `caret: 'hide'` on the review profile and
  `reducedMotion: 'reduce'` on the context, so a captured motion frame is not a
  flaky one. (The deterministic path already does its own version.)
- `jpeg` and `webp` outputs are available for review sweeps; `png` stays the
  default so no existing consumer changes on upgrade.

### 4.6 Third-party noise

An opt-in `blockThirdParty` list (analytics beacons, consent and chat widgets)
aborted at the route level. **Fonts, first-party images and first-party scripts
are never blocked by default**: blocking them changes the pixels and turns a
speed-up into a wrong screenshot. The list is a default array callers extend,
not a hidden allowlist.

### 4.7 Compatibility

Additive only. `deterministic-capture` and every existing export keep their
behaviour. To share the hydration probe without a runner import, W1 moves its
expression into a runner-free module (`playwright/hydration`) and makes
`waitForVueHydrated` in `fixtures.ts` call it; behaviour and the public name do
not change. `journeys` has no dependency on testkit, so W5 inlines the one
expression with a comment and a test asserting it equals testkit's, rather than
adding a cross-package dependency in this release.

## 5. narduk-testkit: the audit CLI

`narduk-testkit capture audit [root] [--json] [--rules CAP001,CAP003] [--timing report.json]`
next to the existing `ui analyze` and `e2e` subcommands in
`bin/narduk-testkit.mjs`.

- **Discovery:** a file is capture-like if it imports `playwright`,
  `playwright-core`, `@playwright/test` or `puppeteer` and calls `.screenshot(`,
  `newContext(` or `.launch(`. Discovery is by content, not by path, because the
  estate's scripts live in `test/vqa/`, `scripts/`, `design/` and `tests/e2e/`,
  and the existing e2e rules' globs do not cover all of them. The CLI passes the
  discovered list to ESLint through the Node API's file/`overrideConfig`
  options, so the pack needs no per-pack option.
- **Engine:** runs the `capture` ESLint rules (section 6) through the ESLint
  Node API on the discovered files. No second parser, no second rule set.
- **Output:** per finding: rule id, file:line, severity, one-line
  why-it-is-slow, the fix, and a link to the playbook anchor. `--json` is stable
  and schema-versioned so the skill and a CI step can consume it.
- **`--timing`:** reads the JSON that `createCaptureRun({ timing })` writes and
  prints the per-phase split (`auth`, `goto`, `ready`, `setup`, `shoot`,
  `write`), total wall time and p50/p95 per shot. This is how the audit turns
  "looks slow" into "auth is 38% of the sweep".
- **Exit code:** non-zero only on `error` severity findings, so adoption can
  start as warnings.
- **Exemptions:** `// capture-audit-ignore CAP003 -- <reason>`; the reason is
  mandatory and a bare ignore is itself a finding. Exempt lists in repo config
  are shrink-only, as the e2e pack already requires for its own exemptions.

## 6. eslint-config: the `capture` pack

A new opt-in capability pack, not part of `narduk/e2e` (whose
`e2e-timeout-ceiling` rule applies to spec and helper files and deliberately
leaves `playwright.config.*` alone, though the pack as a whole also covers
config files). The package's packs are static arrays
(`eslint-app-config.mjs:495-508`) with no per-pack options, so the pack ships
fixed default globs (`**/test/vqa/**`, `**/scripts/**`, `**/design/**`,
`**/*capture*`) and the CLI overrides the file list through the ESLint Node API.
**Adding a pack is a larger change than adding rules**:
`package-surface.test.ts` (line 119) and `packs.test.ts` (line 90) hard-assert
exactly 14 packs, `DESIGN.md:26` says "the 14 capability pack names survive",
and the pack needs a `package.json` export, `src/index.ts` registration and the
no-orphan-rule test. W3 owns all of them. One rule per row. Every rule ships
with a README section: detector, why it is slow, fix, when it is a false
positive, and a before/after from section 7.

| Id         | Detects                                                                                                                                                                              | Why it costs time                                                                                                   | Fix                                                                             | Not a defect when                                                                                          | Severity |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| **CAP001** | `launch(` / `launchPersistentContext(` inside a loop or per-item function                                                                                                            | A browser process per item                                                                                          | Launch once per run; `createCaptureRun`                                         | A test that needs process isolation or a different engine/channel per case                                 | error    |
| **CAP002** | Context creation plus a sign-in step (a `fetch` POST to a login path, a `goto` to `/sign-in`, a call to a helper named like `attachAuth`/`login`/`signIn`) inside the same loop body | Sign-in is paid per shot instead of per role                                                                        | Sign in once, save `storageState`, build contexts from it (D3)                  | The capture is about the sign-in flow itself                                                               | error    |
| **CAP003** | `waitUntil: 'networkidle'` or `waitForLoadState('networkidle')` as the readiness signal in a capture script                                                                          | Waits for a quiet network; a poll, socket or beacon makes it wait out its full timeout, and a fast page still waits | Review readiness (D2): `load`, hydration, fonts, a declared selector            | A deterministic-profile capture, where the testkit helper uses it deliberately                             | warn     |
| **CAP004** | `waitForTimeout(n)` / `new Promise(r => setTimeout(r, n))` after a `goto` or setup in a capture loop                                                                                 | A fixed pause is paid on every page whether needed or not, and still races on a slow one                            | Wait for the condition the pause stands in for                                  | Paced demo/video capture, where a dwell is the product                                                     | warn     |
| **CAP005** | A loop that awaits navigation and a screenshot per iteration with no bounded pool in scope                                                                                           | One page at a time                                                                                                  | `captureAll` / a bounded pool for read-only specs (D4)                          | Mutating flows, or anything depending on a leased world                                                    | warn     |
| **CAP006** | `newContext` per viewport or colour scheme where the options differ only by viewport size or `colorScheme`                                                                           | Contexts rebuilt for settings Playwright can change per page                                                        | One context per distinct context key (section 4.4)                              | The settings that do differ are context-level, or the app stores its colour scheme itself (pacc-trac does) | info     |
| **CAP007** | `fullPage: true` combined with `deviceScaleFactor: 2` (or higher) as the default for every shot                                                                                      | Large raster and PNG encode per shot                                                                                | `dpr: 1` for sweeps; `fullPage` where the full page is the evidence; cap height | The shot is for retina evidence                                                                            | info     |
| **CAP008** | Capture without `animations: 'disabled'` or `reducedMotion`                                                                                                                          | Slow to settle and flaky to repeat                                                                                  | Set both on the review profile                                                  | The animation is the subject                                                                               | info     |
| **CAP009** | No route-level block for known analytics/consent/chat beacons on a public-site sweep                                                                                                 | Extra requests, and a `networkidle` wait that never comes                                                           | `blockThirdParty` (never block fonts or first-party assets)                     | The beacon behaviour is under test                                                                         | info     |
| **CAP010** | A hand-rolled capture script where `@narduk-enterprises/journeys` or `capture-session` covers the case (the `visual-qa` skill already says not to write these)                       | Every repo re-solves, and re-gets wrong, sign-in, readiness and pooling                                             | Use the shared tool; delete the script                                          | The script does something neither tool can                                                                 | info     |

Rules are heuristics over syntax. The first release must ship each with a
fixture set of true positives and known false positives (the repo's rule tests
live in `eslint-config/tests/rules`).

## 7. Worked example: `pacc-trac` `test/vqa/gallery.mjs`

The audit's reference case, and W6's target. Before (current shape, condensed):

```js
for (const [role, features] of byAuthRole) {
  const plan = await getToken(role)
  for (const feature of features) {
    for (const vp of viewportsFor(feature)) {
      const context = await browser.newContext({
        viewport: vp,
        deviceScaleFactor: 2,
      })
      await attachAuth(context, plan) // CAP002: sign-in per shot
      const page = await context.newPage()
      await page.goto(BASE + path, { waitUntil: 'networkidle' }) // CAP003
      await page.waitForTimeout(700) // CAP004
      await page.screenshot({ path, fullPage: true }) // CAP007
      await context.close()
    } // CAP005: serial
  }
}
```

After (target shape, using section 4):

```js
const run = await createCaptureRun({
  profile: 'review',
  base: BASE,
  timing: 'vqa-artifacts/gallery-timing.json',
})
const specs = features.flatMap((f) =>
  viewportsFor(f).map((vp) => ({
    id: `${f.id}-${vp.name}`,
    path: fillPath(f.path, refs),
    device: vp,
    role: f.role,
    readOnly: f.screenshot.readOnly === true, // declared per entry in W6, never inferred
    ready: f.screenshot.ready,
    setup: f.screenshot.setup,
    out: pngPath(f, vp),
  })),
)
await run.captureAll(specs) // sign-in once per role; bounded pool; load+hydration+fonts+ready
await run.close()
```

Entries default to `readOnly: false`, so an unmigrated catalog is serial and
correct. W6 marks an entry `readOnly: true` only after checking that neither its
`setup` (`runSetup` in `test/vqa/setups.mjs`) nor the page's own load mutates
state; a GET is not assumed to be harmless. The catalog also gains an optional
`ready` selector per feature; entries without one use the fallback and report
`readyDeclared: false`.

## 8. Measurement protocol (the done-when)

No speed number appears in code comments, PR bodies or docs unless it came from
this protocol.

1. **Baseline first (W0).** Time `gallery.mjs` against one fixed target (local
   dev server preferred, so the network is not a variable) _before any change_,
   three runs, same machine, nothing else heavy running. Record: wall time,
   shots, per-phase split. The split needs instrumentation; W0 adds a throwaway
   timing wrapper to `pacc-trac` (not committed to `main`) or uses the
   `createCaptureRun` timing output once W1 lands.
2. **Re-time after each work item that changes the path**, not only at the end,
   so each change's effect is its own number and a regression is attributable.
3. **Report** wall time, shots, shots/second, p50/p95 per shot, and the phase
   split, before and after, with the machine and target named. State what was
   not measured.
4. **Parity check.** A faster sweep must produce the same screens: for
   `gallery.mjs`, compare the manifest's `httpStatus`, `bounced` and `pass`
   fields before/after, and eyeball a sample at each viewport. A speed-up that
   changes the pass set is a bug until explained.
5. **Done-when for the plan:** the pacc-trac sweep is re-timed and the result,
   good or bad, is written into this document's tracking table. If the number
   does not move, the plan says so and the bottleneck analysis is redone.

Two claims from the research are **not** established and must be checked against
the Playwright version in use before the playbook states them: that headless
Chromium defaults to the lighter `chrome-headless-shell` build, and whether
`channel: 'chrome'` changes launch or render speed.

## 9. Work items

Owner files are relative to the repo named. "Parallel" lists what can run
alongside. All PRs use `Refs`, never `Closes`, until the issue's done-when is
met. Package versions move through the repo's changeset flow
(`docs/package-releases.md`), minor bumps for additive exports.

| #      | Item                | Repo and owned files                                                                                                                                                                                                                                                                                                                                                         | Done-when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Needs                                                                |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **W0** | Baseline            | pacc-trac (read-only, throwaway timing wrapper), result recorded in this doc's tracking table                                                                                                                                                                                                                                                                                | Three timed runs of `gallery.mjs` with the per-phase split, machine and target named                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none; do first                                                       |
| **W1** | `capture-session`   | narduk-testkit: `src/playwright/capture-session.ts`, new runner-free `src/playwright/hydration.ts` (extracted from `src/e2e/fixtures.ts`, which then calls it), `package.json` export and `files` (add `docs/`), `tests/`, README + changeset (with the `create-narduk-app` patch line, which pins testkit at `manifest.ts:76`)                                              | Section 4 API implemented; unit tests with a fake `Browser`; one real-Chromium test proving sign-in happens once for N captures, that a read-only pool runs concurrently while a mutating spec is a barrier, that an expired session re-signs in once, and that `freshContext` and `schemeStoredByApp` give separate contexts; `package-exports.test.ts` green; the module loads from a plain `.mjs` with no `@playwright/test` import                                                                                                                                                                                                                                                                                                                                              | W0 numbers inform 4.3 only; can start in parallel                    |
| **W2** | Capture playbook    | narduk-testkit: `docs/capture-playbook.md`, README link, `package.json` `files` (the published package ships only `bin/`, `dist/` and the README today, so `docs/` must be added or the playbook is unreachable)                                                                                                                                                             | Playbook below lifted into the package docs, every CAP rule linked to its section, worked example from section 7; `pnpm pack --dry-run` shows the playbook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none                                                                 |
| **W3** | `capture` pack      | eslint-config: `src/rules/capture/*`, pack registration in `eslint-app-config.mjs` and `src/index.ts`, `package.json` export, `tests/rules`, `tests/composition/package-surface.test.ts` and `packs.test.ts` (both assert 14 packs), `DESIGN.md`, the no-orphan-rule test, changeset (with the `create-narduk-app` patch line, which pins eslint-config at `manifest.ts:46`) | CAP001-CAP010 each with true-positive and false-positive fixtures; opt-in; the pack count assertions and `DESIGN.md` updated deliberately; no change to any existing pack's results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | rule ids and messages frozen from section 6; parallel with W1        |
| **W4** | Audit CLI           | narduk-testkit: `src/cli/capture-audit.ts`, `bin/narduk-testkit.mjs`, tests                                                                                                                                                                                                                                                                                                  | Discovery by content, ESLint-API run of W3 rules, stable `--json`, `--timing` report, mandatory-reason ignores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | W3 rules exist (or a stub with the same ids)                         |
| **W5** | Journeys: fast path | journeys: `src/web.ts`, `src/worker-binding.ts`, `src/index.ts`, README, tests                                                                                                                                                                                                                                                                                               | **(a)** stills-only capture mode: no video, no pacing, steps' per-step stills kept; **(b)** sign-in cache keyed by `(origin, role, generation)` where `generation` is what `WorldHooks.prepare` returns (`types.ts:485`); because the contract stamps a new generation on every `prepare` and `web.ts:545` runs `prepare` per journey, the cache hits only inside a declared sequence or a world whose generation is stable, so **W5 must report the measured hit rate and drop (b) if it is near zero**; **(c)** `goto` gains an optional `ready` argument and, outside paced mode, replaces `networkidle` + `sleep` with load + the inlined hydration probe + fonts + `ready`; **(d)** no worker pool in this release (section 12, question 3); the existing refusal is unchanged | W1 hydration module (inlined, not imported); contract changes in 9.1 |
| **W6** | pacc-trac adoption  | pacc-trac: `test/vqa/gallery.mjs`, `shoot.mjs`, `k2-viewports.mjs`, `qa-sweep.mjs`, `lib.mjs`, `docs/catalog/features.mjs` (optional `ready` and `readOnly` per entry)                                                                                                                                                                                                       | Section 7 "after" shape on `gallery.mjs` first, then the others one PR each (the two-origin scripts use `origin`; `qa-sweep.mjs`'s WebKit phone pass is a second run); entries marked `readOnly` only after checking; re-timed per section 8; parity check green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W1 released                                                          |
| **W7** | Adoption issues     | other repos: **issues only**, labelled, evidence attached                                                                                                                                                                                                                                                                                                                    | For each repo whose owner or a task asks for it: audit run output attached to an issue naming file, rule, fix and done-when. No sweep, no PRs from libs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W4                                                                   |
| **W8** | Skill and contract  | agent-infrastructure: `skills/visual-qa/SKILL.md` (new capture-audit section), thin `skills/capture-audit/SKILL.md`, `skills/visual-qa/references/journey-runner-spec.md`                                                                                                                                                                                                    | The skill invokes the testkit CLI, reads `--json`, applies the playbook fixes, and reports with the section 8 protocol. The contract edits listed below are made in the same change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | W4 and W5 shapes settled                                             |

**Parallelism.** W0, W1, W2, W3 start together. W4 follows W3's rule ids. W5
follows W1's readiness and session API. W6 follows the W1 release. W8 follows
W4/W5. W7 follows W4 and is demand-driven.

### 9.1 Journey-runner-spec sections W5/W8 change

The contract is in `agent-infrastructure`
(`skills/visual-qa/references/journey-runner-spec.md`). W5 must not drift from
it, and W8 must edit it in the same change:

- **Section 3 (test and capture).** Add the stills-only mode. State that pacing
  vocabulary (`beat`, `read`, `point`) remains valid and is a no-op in stills
  mode as it is in test mode, and that the modes still differ only in pacing and
  artefacts, never in what passes.
- **Section 2.3 / 6.2 (step and web context).** `goto(path)` gains an optional
  `ready` argument, and the web adapter's non-paced readiness becomes load +
  hydration + fonts + `ready` instead of `networkidle` + a sleep. This is a
  contract change (the current `WebJourneyContext.goto` takes only a path).
- **Section 5 (world sessions) and section 6.2 (web adapter).** Add the sign-in
  cache and record the invalidation rule: a session is valid only for the world
  generation `prepare` returned when it was created, so a cached session cannot
  point at rows that no longer exist. State plainly that the cache does not
  loosen section 5: every journey still gets its fresh `prepare`.
- **Not changed:** section 5's serial-journeys rule and section 6.2's refusal of
  a worker pool on a shared world. A read-only journey pool would loosen them
  and is deliberately **out** of this release (section 12, question 3).
- **Section 13 (open questions).** Add the open items from section 12 below.

## 10. The capture playbook (content for W2)

This section is the playbook's body. W2 moves it into `narduk-testkit` docs and
keeps it the single copy.

### 10.1 The cost model

A capture is `launch` once, then per shot: context, sign-in, navigation, settle,
rasterise, encode, write. Only the first is cheap to share, and it is already
shared. The rest repeat per shot unless you restructure them. Fix the repeating
parts in this order, largest likely win first, but **measure first** (section 8)
because the order depends on the app:

1. Stop signing in per shot.
2. Stop waiting for idleness and fixed time; wait for readiness.
3. Run read-only shots concurrently, bounded.
4. Stop paying for pixels you do not need (dpr, `fullPage`, encoding).
5. Stop loading what the picture does not need (analytics, consent, chat),
   without touching fonts or first-party assets.

### 10.2 Rules for a good capture script

- **One browser per run, one context per distinct device-and-role tuple.** Open
  a page per shot and close it. Do not create a context per shot.
- **Sign in once per role; save and reuse `storageState`.** If the world is
  re-prepared, the saved state is stale: re-sign-in on a new generation.
- **Readiness is a condition, not a duration.** `load`, hydration, fonts, then a
  selector the app declares for "this screen is done". Never `waitForTimeout`;
  never `networkidle` for review captures.
- **Declare `ready` per screen.** It is one line per catalog entry and is the
  difference between "the page finished" and "the page looks finished".
- **Concurrency is bounded and read-only.** A bounded pool for captures that do
  not change state. Anything that submits a form, creates a row or depends on a
  leased world runs alone.
- **Pick the profile on purpose.** Committed baselines use `deterministic`
  (slow, repeatable, double-captured). Galleries and sweeps use `review`.
- **Request only the pixels you will use.** `dpr: 1` unless retina is the point;
  `fullPage` per screen, with a height cap; `jpeg`/`webp` for bulk review.
- **Freeze motion.** `animations: 'disabled'`, `caret: 'hide'`,
  `reducedMotion: 'reduce'`.
- **Block noise, not content.** Analytics and widget beacons may be aborted.
  Fonts, first-party images and scripts may not.
- **A failure is a failure.** A capture that swallows an error and carries on
  produces a screenshot of a login page. Record status, final URL and whether it
  bounced to sign-in, and fail the run on any (the existing journeys rule: a
  file that exists is not a screen that rendered).
- **Instrument it.** Emit per-phase timing every run. A sweep you cannot break
  down is a sweep you will guess at.

### 10.3 When to use what

| Need                                                          | Use                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Committed screenshot that must not change unless the app does | `deterministic-capture` (`captureStableScreenshot`)                                      |
| Gallery, route sweep, look-check stills                       | `capture-session`, `review` profile                                                      |
| Declared user journeys: tests, stills, video, walkthrough     | `@narduk-enterprises/journeys`                                                           |
| Demo video with human pacing                                  | journeys capture mode with video                                                         |
| Console, a11y, layout probes on a page set                    | the existing `ui-quality` and `accessibility` helpers on top of a `capture-session` page |

### 10.4 Anti-patterns and their fix

Each CAP rule in section 6 is an anti-pattern entry: symptom, cause, fix,
exception. The playbook links them rather than restating.

## 11. The skill (content for W8)

`capture-audit`, in `agent-infrastructure/skills/`. Triggers on: capture or
screenshot sweep is slow, "audit our screenshot scripts", "why is the gallery
slow", reviewing a capture PR.

Steps, in order:

1. Identify the repo's capture scripts and the target to time (section 8).
2. Baseline-time one representative run. If nothing can be run, say so and
   report findings as unmeasured.
3. Run `narduk-testkit capture audit --json`; add `--timing` if a timing file
   exists.
4. Rank findings by measured phase share, not by rule severity. Fix the largest
   measured phase first.
5. Apply the playbook fix; re-time; run the parity check; report before/after
   with what was not measured.
6. File adoption issues (never PRs) in repos the user did not ask the skill to
   change.

It does not duplicate the playbook; it names the CLI, the rule ids and the
protocol, and links the testkit docs.

## 12. Open questions

1. **Concurrency default.** Chosen from W0 measurements on the machines that
   actually run sweeps (a laptop, the iMac, a Linux CI guest). Until then the
   spec fixes no number.
2. **Per-page versus per-context settings.** Settled for Playwright 1.61.1
   (viewport and `colorScheme` per page; `deviceScaleFactor`, `isMobile`,
   `hasTouch` per context), with the app-stored-scheme exception in section 4.4.
   Re-check on a Playwright upgrade.
3. **A read-only pool in journeys.** Journeys runs serially under one leased
   world with a fresh `prepare` per journey, and `registerJourneys` has no pool
   primitive (a Playwright worker runs tests serially and
   `assertIsolatedTargets` refuses a pool on a shared world). Parallel stills
   are served by `capture-session`, driven from a catalog. Only if that proves
   insufficient should the contract's author consider a step-level `readOnly`
   flag (a journey is read-only only if every step is); it would loosen section
   5 and needs their agreement.
4. **Sign-in cache hit rate in journeys.** Answered in principle (the key uses
   `WorldHooks.prepare`'s `generation`); whether it ever hits depends on how
   often `prepare` keeps the generation. W5 measures it.
5. **Engine revisit.** If W6's re-timing shows rasterisation or encode, not
   auth/idle/serial, dominating, revisit engine and `channel`/headless-shell
   choices then, with measurements. Not before.
6. **Estate scale.** Whether the audit should be a scheduled lane over the
   estate is a separate decision for Logan and the orchestrator; this plan only
   makes a single-repo audit possible.

## 13. Tracking

| Item                  | State         | PR  | Measured result |
| --------------------- | ------------- | --- | --------------- |
| W0 baseline           | not started   |     |                 |
| W1 capture-session    | not started   |     |                 |
| W2 playbook           | not started   |     |                 |
| W3 capture pack       | not started   |     |                 |
| W4 audit CLI          | not started   |     |                 |
| W5 journeys fast path | not started   |     |                 |
| W6 pacc-trac adoption | not started   |     |                 |
| W7 adoption issues    | demand-driven |     |                 |
| W8 skill and contract | not started   |     |                 |

Tracker issue:
[narduk-libs#2184](https://github.com/narduk-enterprises/narduk-libs/issues/2184),
labels `tracker`, `P2-medium`, `area:testkit`; journeys work is named in its
body. Milestone unset; PRs `Refs` it.

## Sources

- Web search, 2026-11-12: vendor-authored screenshot-API comparisons (Puppeteer
  vs Playwright, hosted screenshot APIs), Lightpanda's own benchmark
  documentation, and reviews of Vercel's agent-browser. All speed figures in
  them are vendor- or single-blog-reported and are not relied on here.
- Code read 2026-11-12: `pacc-trac`
  `test/vqa/{gallery,shoot,k2-viewports,qa-sweep,lib}.mjs`,
  `scripts/phone-renders.mjs`; `narduk-libs`
  `packages/tooling/journeys/src/{web,worker-binding}.ts`,
  `packages/tooling/narduk-testkit/src/playwright/{deterministic-capture,e2e-budget}.ts`,
  `packages/tooling/eslint-config/src/rules/e2e/e2e-timeout-ceiling.ts`;
  `agent-infrastructure`
  `skills/visual-qa/{SKILL.md,references/journey-runner-spec.md}`.
