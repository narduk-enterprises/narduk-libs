/**
 * The web adapter (§6.2): a thin layer on Playwright Test, registered from a
 * spec file. This module is the package's only Playwright import — the core
 * stays runtime-neutral, and `@playwright/test` is an optional peer.
 *
 * The spec marked the engine choice provisional pending exactly this
 * implementation; deviations found while building are recorded in the PR, not
 * silently absorbed.
 */
import { Buffer } from 'node:buffer'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'

import { digestJourney } from './digest.js'
import { createEncodeLane, encodeVideo, sha256File } from './media.js'

import type {
  Applicability,
  Catalog,
  Mode,
  RunManifest,
  RunStep,
  WebJourney,
  WebJourneyContext,
  WebProfile,
  WorldHooks,
  WorldQuery,
} from './types.js'
import { RUN_SCHEMA } from './types.js'
import { expectedStepIds, makeRunId, runPaths } from './verify.js'
import {
  assertIsolatedTargets,
  bindWorkerTargets,
  configuredWorkersFrom,
  type WorkerResolved,
} from './worker-binding.js'

export type { WorkerResolved, WorkerResolver } from './worker-binding.js'

export interface RegisterJourneysOptions {
  catalog: Catalog
  /**
   * Today's scalar hooks, or a function of `workerIndex` so worker k
   * prepares world k. A worker pool is refused unless this and `base`
   * are both functions (narduk-libs#116).
   */
  world: WorkerResolved<WorldHooks>
  /**
   * Today's scalar origin, or `(workerIndex) => origin`. Resolved inside
   * the registered `test()` body and recorded on the run manifest.
   */
  base: WorkerResolved<string>
  outRoot: string
  environment: string
  profileName: string
  commit?: string
  declarationDigest: string
  /** Defaults to process.env.JOURNEYS_MODE, then 'test'. */
  mode?: Mode
  /** Register only these journey ids (default: every web journey). */
  only?: string[]
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * GET-only, same-origin, JSON-only — by construction (§2.3). A throw anywhere
 * in here fails the step; the adapter never converts a query failure into a
 * skip.
 */
export function createWorldQuery(base: string): WorldQuery {
  return {
    base,
    async get(path: string): Promise<unknown> {
      if (!path.startsWith('/')) {
        throw new Error(`world query paths are same-origin and absolute; got "${path}"`)
      }
      const response = await fetch(base + path, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`world query ${path} returned ${response.status}`)
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        throw new Error(
          `world query ${path} returned text/html: probing the rendered page is the ` +
            'forbidden UI probe through a side door',
        )
      }
      const body = await response.text()
      try {
        return JSON.parse(body) as unknown
      } catch {
        throw new Error(`world query ${path} did not return JSON`)
      }
    },
  }
}

/**
 * EVERY AWAIT IN THIS FILE IS BOUNDED, and the number below is why the file has
 * a constant instead of two inline literals.
 *
 * Playwright's default action timeout is ZERO, meaning no timeout at all, so an
 * action that never becomes possible is bounded only by the per-test ceiling —
 * minutes for a capture. `scrollIntoViewIfNeeded()` was called with no options
 * in two places here, and one of them cost two hosted capture builds 17 minutes
 * each on the same beat while that beat's test-mode twin passed in 11 seconds
 * (narduk-libs#77, Buildkite `pacc-trac-capture` #9 and #10). Read out of the
 * trace rather than guessed at: the action had a `before` event, no `after`,
 * and `timeout: "0"`.
 *
 * Both call sites already swallow their own failures, so a bound degrades the
 * cosmetic case to "no highlight drawn" and the functional case to "click
 * without pre-scrolling" — which `click()` does itself, under its own 8s bound.
 * A defect either way; the job of the number is only to turn "forever" into
 * "bounded", matching the 4s `hover()` already carried beside it.
 *
 * A CONSUMER-SIDE `actionTimeout` IS NOT THIS. It bounds the same call, but it
 * is a Playwright config a repository has to know to write, and the two builds
 * above died in a repository that had not written it. A library whose helper
 * can park forever unless the consumer defends against it is shipping the
 * defect and the workaround separately.
 */
const SCROLL_TIMEOUT_MS = 4_000
const ASSERT_TIMEOUT_MS = 8_000
const ASSERT_POLL_MS = 50

const LISTED_NAMES = 20
const LISTED_NAME_CHARS = 60

/**
 * Playwright treats `timeout: 0` as "wait forever" and `NaN` as nonsense.
 * `Number(process.env.X || 25_000)` turns `X=0` into that forever wait
 * (narduk-libs#67). Refuse those here; an assertion that cannot fail is not
 * an assertion.
 */
function assertionTimeout(override?: number): number {
  const fromEnv = process.env.JOURNEYS_ASSERT_TIMEOUT
  let value = override
  if (value === undefined && fromEnv !== undefined) {
    value = Number(fromEnv)
  }
  if (value === undefined) return ASSERT_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `assertion timeout must be a positive finite number of milliseconds, got ${JSON.stringify(
        override ?? fromEnv,
      )}`,
    )
  }
  return value
}

async function pollUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await probe()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(ASSERT_POLL_MS, remaining))
  }
}

function pageUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return ''
  }
}

function quoted(value: string | RegExp): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function looksLikeSelector(target: string): boolean {
  const trimmed = target.trim()
  // Labels commonly contain `:`, `=`, and unit brackets (`Quantity [kg]`).
  // Treat as a selector only when it starts like one or carries an attribute.
  return (
    /^[.#[]/.test(trimmed) ||
    /^(?:input|textarea|select)\b/i.test(trimmed) ||
    /\[[a-z][\w-]*\s*[~|^$*]?=/i.test(trimmed)
  )
}

function roleLocator(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp) {
  return page.getByRole(role, {
    name,
    ...(typeof name === 'string' ? { exact: true } : {}),
  })
}

function textLocator(page: Page, text: string | RegExp) {
  return typeof text === 'string' ? page.getByText(text, { exact: true }) : page.getByText(text)
}

type PresenceLocator = {
  count: () => Promise<number>
  first: () => {
    waitFor: (opts: { state: 'visible'; timeout: number }) => Promise<void>
    isVisible: () => Promise<boolean>
  }
}

/**
 * Presence is a visible match. `waitFor({ state: 'visible' })` can fail while
 * `count()` is still non-zero (off-screen, `aria-hidden`, a template node).
 * Swallowing that failure and treating count as success was the hidden-match
 * pass narduk-libs#67 called out.
 */
async function hasVisibleMatch(locator: PresenceLocator, timeout: number): Promise<boolean> {
  const first = locator.first()
  await first.waitFor({ state: 'visible', timeout }).catch(() => {})
  return (await locator.count()) > 0 && (await first.isVisible())
}

/**
 * The accessible names present for `role`, capped and truncated. Read with
 * `evaluateAll`, which never waits, so a failing path stays as fast as it was;
 * anything that goes wrong here returns nothing rather than masking the
 * failure it is describing.
 */
async function namesForRole(page: Page, role: string): Promise<string[] | null> {
  try {
    const names = await page
      .getByRole(role as Parameters<Page['getByRole']>[0])
      .evaluateAll((elements) =>
        elements.map((element) =>
          (element.getAttribute('aria-label') ?? (element as HTMLElement).innerText ?? '')
            .replaceAll(/\s+/g, ' ')
            .trim(),
        ),
      )
    return names.filter(Boolean)
  } catch {
    return null
  }
}

function listNames(role: string, names: string[] | null): string | null {
  if (names === null) return null
  if (names.length === 0) return `  no ${role}s on the page`
  const shown = names
    .slice(0, LISTED_NAMES)
    .map((name) =>
      JSON.stringify(
        name.length > LISTED_NAME_CHARS ? `${name.slice(0, LISTED_NAME_CHARS - 1)}…` : name,
      ),
    )
  const more = names.length > LISTED_NAMES ? ` (+${names.length - LISTED_NAMES} more)` : ''
  return `  ${role}s on the page: ${shown.join(', ')}${more}`
}

/**
 * A `must()` that finds nothing is a finding: a renamed control, a state that
 * never arrived, a drifted beat. So the message says what WAS there, and on
 * which page, instead of only what the declaration wanted (narduk-libs#68).
 * A missing `button` also lists links, the commonest role confusion.
 */
async function describeMissingControl(
  page: Page,
  role: string,
  name: string | RegExp,
): Promise<string> {
  let url = ''
  try {
    url = page.url()
  } catch {
    // A closed page has no URL; the rest of the message still helps.
  }
  const wanted = typeof name === 'string' ? JSON.stringify(name) : String(name)
  const lines = [`no ${role} matching ${wanted}${url ? ` on ${url}` : ''}`]
  const listed = listNames(role, await namesForRole(page, role))
  if (listed) lines.push(listed)
  if (role === 'button') {
    const links = listNames('link', await namesForRole(page, 'link'))
    if (links) lines.push(links)
  }
  return lines.join('\n')
}

/**
 * Exported for the unit suite, not for consumers: the bound above is a property
 * of these helpers, and a browser is far too expensive a way to assert that a
 * call passes a timeout. Not re-exported from `./index` or `./web`'s public
 * surface in any documented form.
 */
export function createContextApi(page: Page, base: string, mode: Mode): WebJourneyContext {
  const paced = mode === 'capture'
  return {
    page,
    base,
    async must(name, opts = {}) {
      const role = (opts.role ?? 'button') as Parameters<Page['getByRole']>[0]
      const locator = page.getByRole(role, { name }).nth(opts.nth ?? 0)
      await locator.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      if ((await locator.count()) === 0) {
        throw new Error(await describeMissingControl(page, String(role), name))
      }
      // Bounded, and it runs in BOTH modes: unlike `point()` below, a parked
      // scroll here wedges the regression gate too, not only the camera.
      await locator.scrollIntoViewIfNeeded({ timeout: SCROLL_TIMEOUT_MS }).catch(() => {})
      await locator.click({ timeout: 8_000 })
      if (paced) await sleep(400)
    },
    async see(text, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const locator = textLocator(page, text)
      if (!(await hasVisibleMatch(locator, timeout))) {
        const url = pageUrl(page)
        throw new Error(`expected ${quoted(text)} on ${url || 'the page'} within ${timeout}ms`)
      }
    },
    async hasControl(name, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const role = (opts.role ?? 'button') as Parameters<Page['getByRole']>[0]
      const locator = roleLocator(page, role, name)
      if (!(await hasVisibleMatch(locator, timeout))) {
        throw new Error(await describeMissingControl(page, String(role), name))
      }
    },
    async noControl(name, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const role = (opts.role ?? 'button') as Parameters<Page['getByRole']>[0]
      const locator = roleLocator(page, role, name)
      // Poll count() to zero. waitFor({ state: 'detached' }) resolves
      // immediately when the locator matches nothing — a snapshot wearing
      // an assertion's clothes (narduk-libs#67).
      const absent = await pollUntil(async () => (await locator.count()) === 0, timeout)
      if (!absent) {
        const url = pageUrl(page)
        throw new Error(
          `expected no ${String(role)} named ${quoted(name)} on ${url || 'the page'} within ${timeout}ms`,
        )
      }
    },
    async gone(text, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const locator = textLocator(page, text)
      let saw = false
      const left = await pollUntil(async () => {
        const count = await locator.count()
        const visible = count > 0 && (await locator.first().isVisible())
        if (visible) {
          saw = true
          return false
        }
        return saw
      }, timeout)
      const url = pageUrl(page)
      if (!left) {
        if (!saw) {
          throw new Error(
            `never saw ${quoted(text)} on ${url || 'the page'} within ${timeout}ms, so cannot assert it is gone`,
          )
        }
        throw new Error(
          `expected ${quoted(text)} to be gone from ${url || 'the page'} within ${timeout}ms`,
        )
      }
    },
    async fill(target, value, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const field = looksLikeSelector(target)
        ? page.locator(target)
        : page.getByLabel(target, { exact: true })
      const locator = field.nth(opts.nth ?? 0)
      if (!(await hasVisibleMatch(locator, timeout))) {
        const url = pageUrl(page)
        throw new Error(
          `no field matching ${JSON.stringify(target)}${url ? ` on ${url}` : ''} within ${timeout}ms`,
        )
      }
      await locator.fill(value, { timeout })
      const read = await locator.inputValue()
      if (read !== value) {
        const url = pageUrl(page)
        throw new Error(
          `fill wrote ${JSON.stringify(value)} but the field reads ${JSON.stringify(read)}` +
            `${url ? ` on ${url}` : ''}`,
        )
      }
    },
    async attach(selector, file, opts = {}) {
      const timeout = assertionTimeout(opts.timeout)
      const locator = page.locator(selector)
      await locator.waitFor({ state: 'attached', timeout }).catch(() => {})
      if (typeof file === 'string') {
        await locator.setInputFiles(file, { timeout })
        return
      }
      await locator.setInputFiles(
        { name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.buffer) },
        { timeout },
      )
    },
    async goto(path) {
      await page.goto(base + path, { waitUntil: 'load', timeout: 45_000 })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      if (paced) await sleep(700)
    },
    async beat(ms) {
      if (paced) await sleep(ms)
    },
    async read(screens = 2) {
      if (!paced) return
      for (let index = 0; index < screens; index += 1) {
        await page.mouse.wheel(0, 520)
        await sleep(600)
      }
      await page.mouse.wheel(0, -520 * screens)
      await sleep(400)
    },
    async point(text) {
      if (!paced) return
      const locator = page.getByText(text).first()
      if ((await locator.count()) === 0) return
      await locator.scrollIntoViewIfNeeded({ timeout: SCROLL_TIMEOUT_MS }).catch(() => {})
      await locator.hover({ timeout: SCROLL_TIMEOUT_MS }).catch(() => {})
      await sleep(900)
    },
  }
}

/** One encode in flight across the registered suite (narduk-libs#114). */
const captureEncodeLane = createEncodeLane()

/**
 * Register one Playwright `test()` per web journey, one `test.step()` per
 * declared step. Call from a spec file. Journeys sharing a world run serially
 * inside one worker by construction here (registration order). A pool
 * (`workers > 1`) is legitimate only when `base` and `world` are both
 * functions of `workerIndex` — otherwise this refuses, naming the shared
 * origin / shared database overwrite (§5, narduk-libs#116).
 */
export function registerJourneys(options: RegisterJourneysOptions): void {
  assertIsolatedTargets({
    base: options.base,
    world: options.world,
    workers: configuredWorkersFrom({}),
  })
  test.beforeAll(() => {
    const info = test.info()
    assertIsolatedTargets({
      base: options.base,
      world: options.world,
      workers: configuredWorkersFrom({ workers: info.config.workers }),
    })
  })
  test.afterAll(async () => {
    await captureEncodeLane.idle()
  })
  const mode: Mode = options.mode ?? (process.env.JOURNEYS_MODE === 'capture' ? 'capture' : 'test')
  const commit = options.commit ?? process.env.JOURNEYS_COMMIT ?? 'uncommitted'
  const profile = options.catalog.profiles[options.profileName]
  if (!profile || profile.kind !== 'web') {
    throw new Error(`profile "${options.profileName}" is not a declared web profile`)
  }
  const journeys = options.catalog.journeys.filter(
    (journey): journey is WebJourney =>
      journey.surface === 'web' && (!options.only || options.only.includes(journey.id)),
  )

  for (const journey of journeys) {
    // Capture runs the FIRST declared scenario (§2.2); test mode runs each.
    const scenarioIds = mode === 'capture' ? [journey.scenarios[0]] : journey.scenarios
    for (const scenarioId of scenarioIds) {
      const testTitle = scenarioIds.length > 1 ? `${journey.id} [${scenarioId}]` : journey.id
      test(testTitle, async ({ browser }) => {
        await runJourney({
          journey,
          scenarioId,
          mode,
          commit,
          profile,
          options,
          browser,
        })
      })
    }
  }
}

interface RunJourneyArgs {
  journey: WebJourney
  scenarioId: string
  mode: Mode
  commit: string
  profile: WebProfile
  options: RegisterJourneysOptions
  browser: Browser
}

async function runJourney(args: RunJourneyArgs): Promise<void> {
  const { journey, scenarioId, mode, commit, profile, options, browser } = args
  const info = test.info()
  const { base, world: worldHooks } = bindWorkerTargets(options, {
    workers: info.config.workers,
    parallelIndex: info.parallelIndex,
  })
  const startedAt = new Date()
  const attemptId = makeRunId(commit, startedAt)
  const paths = runPaths({
    outRoot: options.outRoot,
    environment: options.environment,
    surface: 'web',
    journeyId: journey.id,
    profileName: options.profileName,
    mode,
    runId: attemptId,
  })
  mkdirSync(join(paths.attemptDirectory, 'steps'), { recursive: true })

  const prepared = await worldHooks.prepare(scenarioId)
  const confirmed = prepared.scenarioId === scenarioId
  const appRevision = await worldHooks.appRevision()

  const audienceEntry = options.catalog.audience[journey.role]
  if (!audienceEntry) throw new Error(`unknown role "${journey.role}"`)

  const videoTmp = mode === 'capture' ? mkdtempSync(join(tmpdir(), 'njr-video-')) : null
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined

  // §2.5: recording is suspended while a secret-class authentication hook
  // runs. A context cannot pause its video, so the hook runs in a separate,
  // never-recorded context and only its session state crosses over.
  if (mode === 'capture' && audienceEntry.credentialClass === 'secret') {
    const authContext = await browser.newContext({ viewport: profile.viewport })
    const authPage = await authContext.newPage()
    await audienceEntry.web(authPage, base)
    storageState = await authContext.storageState()
    await authContext.close()
  }

  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.dpr,
    colorScheme: profile.colorScheme,
    ...(storageState ? { storageState } : {}),
    ...(videoTmp ? { recordVideo: { dir: videoTmp, size: profile.viewport } } : {}),
  })
  const recordingStart = Date.now()
  const page = await context.newPage()
  const api = createContextApi(page, base, mode)
  const world = createWorldQuery(base)

  if (!storageState && audienceEntry.web) {
    await audienceEntry.web(page, base)
  }

  const included = new Set(expectedStepIds(journey, scenarioId))
  const steps: RunStep[] = []
  let failure: unknown
  let ordinal = 0
  for (const step of journey.steps) {
    if (!included.has(step.id)) continue
    ordinal += 1
    const startedMs = Date.now() - recordingStart
    const record: RunStep = {
      id: step.id,
      ordinal,
      status: 'passed',
      say: step.say,
      startedMs,
      endedMs: startedMs,
    }
    steps.push(record)
    try {
      if (step.appliesIf) {
        const verdict: Applicability = await step.appliesIf(world)
        if (!verdict.applicable) {
          record.status = 'skipped-not-applicable'
          record.skipReason = verdict.reason
          record.endedMs = Date.now() - recordingStart
          continue
        }
      }
      await test.step(step.say, async () => {
        await step.do(api)
        if (mode === 'capture' && step.capture?.dwell) await sleep(step.capture.dwell)
      })
      record.endedMs = Date.now() - recordingStart
      if (mode === 'capture') {
        const shot = `steps/${String(ordinal).padStart(2, '0')}-${step.id}.png`
        await page.screenshot({ path: join(paths.attemptDirectory, shot) })
        record.shot = shot
        record.shotSha256 = sha256File(join(paths.attemptDirectory, shot))
      }
    } catch (error) {
      record.status = 'failed'
      record.error = error instanceof Error ? error.message : String(error)
      record.endedMs = Date.now() - recordingStart
      failure = error
      break
    }
  }

  await context.close()

  let video: RunManifest['video']
  let encodeDone: Promise<RunManifest['video']> | undefined
  if (videoTmp) {
    const webm = readdirSync(videoTmp).find((file) => file.endsWith('.webm'))
    if (webm) {
      const webmPath = join(paths.attemptDirectory, 'video.webm')
      const mp4Path = join(paths.attemptDirectory, 'video.mp4')
      copyFileSync(join(videoTmp, webm), webmPath)
      encodeDone = captureEncodeLane.enqueue(async () => {
        const encoded = await encodeVideo(webmPath, mp4Path, profile.video)
        if (encoded.ok) rmSync(webmPath, { force: true })
        const file = encoded.ok ? 'video.mp4' : 'video.webm'
        const fullPath = join(paths.attemptDirectory, file)
        return {
          file,
          seconds: encoded.seconds,
          sha256: sha256File(fullPath),
          encode: {
            ffmpeg: encoded.ffmpeg,
            probe: encoded.probe,
            ...(profile.video?.preset ? { preset: profile.video.preset } : {}),
            ...(profile.video?.crf !== undefined ? { crf: profile.video.crf } : {}),
            ...(encoded.maxBytesExceeded ? { maxBytesExceeded: true } : {}),
          },
        }
      })
    }
    rmSync(videoTmp, { force: true, recursive: true })
  }

  const generationAfter = await worldHooks.generation()
  if (encodeDone) video = await encodeDone

  const generationInterference = generationAfter !== prepared.generation
  const manifest: RunManifest = {
    schema: RUN_SCHEMA,
    journey: journey.id,
    surface: 'web',
    mode,
    base,
    commit,
    declarationDigest: options.declarationDigest,
    journeyDigest: digestJourney(journey),
    appRevision,
    profile: {
      name: options.profileName,
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      viewport: `${profile.viewport.width}x${profile.viewport.height}`,
      dpr: profile.dpr ?? 1,
      colorScheme: profile.colorScheme ?? 'light',
    },
    startedAt: startedAt.toISOString(),
    scenario: {
      id: scenarioId,
      confirmed,
      generation: prepared.generation,
      generationAfter,
      preparedBy: 'fresh-load',
    },
    verdict: failure || !confirmed || generationInterference ? 'failed' : 'passed',
    steps,
    ...(video ? { video } : {}),
  }
  writeFileSync(join(paths.attemptDirectory, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (failure) throw failure
  if (!confirmed) {
    throw new Error(`world confirmed scenario "${prepared.scenarioId}", asked for "${scenarioId}"`)
  }
  if (generationInterference) {
    throw new Error(
      `world generation changed mid-journey ("${prepared.generation}" to "${generationAfter}") — ` +
        'the world was replaced under the journey and every artefact after that is evidence of nothing',
    )
  }
}
