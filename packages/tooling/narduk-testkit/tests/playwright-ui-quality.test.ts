import { randomFillSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import {
  OPTIONAL_TELEMETRY_HOSTS,
  createConsoleTracker,
  default as uiQuality,
  isOptionalTelemetryHost,
  prepareUiQualityRoot,
  slugify,
  writeUiQualityManifest,
} from '../src/playwright/ui-quality'
import { analyzeUiQualityRoot } from '../src/playwright/ui-quality-analyzer'

import type { ConsoleMessage, Page, Response, Route } from '@playwright/test'

const tempDirs: string[] = []

function createVisualAuditRoot(prefix: string) {
  const visualAuditRoot = join(process.cwd(), 'output', 'playwright', 'visual-audit')
  mkdirSync(visualAuditRoot, { recursive: true })
  const targetDir = mkdtempSync(join(visualAuditRoot, prefix))
  tempDirs.push(targetDir)
  return targetDir
}

function createTempDir(prefix: string) {
  const targetDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(targetDir)
  return targetDir
}

function createNoisyPng(width: number, height: number) {
  const channels = 3
  const bytes = Buffer.alloc(width * height * channels)
  randomFillSync(bytes)

  return sharp(bytes, { raw: { width, height, channels } }).png()
}

afterEach(() => {
  for (const targetDir of tempDirs.splice(0)) {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

describe('visual QA toolkit helpers', () => {
  it('normalizes capture names for file paths', () => {
    expect(slugify('Fiscal year overlay')).toBe('fiscal-year-overlay')
    expect(slugify(' / ')).toBe('capture')
    expect(uiQuality.slugify('Legacy default import')).toBe('legacy-default-import')
  })

  it('resets the artifact root and writes the manifest', () => {
    const rootDir = createVisualAuditRoot('visual-qa-root-')
    mkdirSync(rootDir, { recursive: true })
    writeFileSync(join(rootDir, 'stale.txt'), 'stale')

    const outputRoot = prepareUiQualityRoot(rootDir)
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    expect(readFileSync(join(outputRoot, 'manifest.json'), 'utf8')).toContain('"app": "demo"')
  })

  it('isolates visual QA roots per scope', () => {
    const rootDir = createVisualAuditRoot('visual-qa-root-scope-')

    const runRootA = prepareUiQualityRoot(rootDir, { scope: 'spec-a' })
    writeFileSync(join(runRootA, 'stale.txt'), 'from-a')

    const runRootB = prepareUiQualityRoot(rootDir, { scope: 'spec-b' })
    expect(readFileSync(join(runRootA, 'stale.txt'), 'utf8')).toBe('from-a')

    const runRootAReset = prepareUiQualityRoot(rootDir, { scope: 'spec-a' })
    expect(existsSync(join(runRootAReset, 'stale.txt'))).toBe(false)
    expect(runRootAReset).toBe(runRootA)
    writeUiQualityManifest(runRootAReset, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })
    expect(readFileSync(join(runRootAReset, 'manifest.json'), 'utf8')).toContain('"app": "demo"')
    expect(runRootB).not.toBe(runRootA)
  })

  it('refuses to delete outside the visual audit artifact root', () => {
    expect(() => prepareUiQualityRoot(join(process.cwd(), 'output', 'playwright'))).toThrow(
      /within/,
    )
    expect(() => prepareUiQualityRoot(join(process.cwd(), 'output', 'playwright', 'repo'))).toThrow(
      /within/,
    )
  })
})

describe('analyzeUiQualityRoot', () => {
  it('writes summaries for healthy visual QA artifacts', async () => {
    const rootDir = createTempDir('visual-qa-analysis-')
    const routeDir = join(rootDir, 'home')
    mkdirSync(routeDir, { recursive: true })
    await createNoisyPng(640, 480).toFile(join(routeDir, 'page-full.png'))
    await createNoisyPng(240, 160).toFile(join(routeDir, 'hero.png'))
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    const summary = await analyzeUiQualityRoot(rootDir)

    expect(summary.failures).toEqual([])
    expect(summary.screenshotCount).toBe(2)
    expect(summary.fullPageCount).toBe(1)
    expect(readFileSync(join(rootDir, 'summary.md'), 'utf8')).toContain('# Visual QA Summary')
  })

  it('fails blank or missing captures without judging design quality', async () => {
    const rootDir = createTempDir('visual-qa-blank-')
    mkdirSync(join(rootDir, 'home'), { recursive: true })
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(join(rootDir, 'home', 'page-full.png'))
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    const summary = await analyzeUiQualityRoot(rootDir)

    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('looks visually flat'),
        'Expected at least 2 screenshots but found 1',
      ]),
    )
  })

  it('throws when visual QA manifests are malformed', async () => {
    const rootDir = createVisualAuditRoot('visual-qa-analysis-bad-manifest-')
    mkdirSync(rootDir, { recursive: true })
    writeFileSync(join(rootDir, 'manifest.json'), '{bad json')

    await expect(analyzeUiQualityRoot(rootDir)).rejects.toThrow(
      `Failed to parse visual QA manifest at ${join(rootDir, 'manifest.json')}.`,
    )
  })
})

/** Enough of a Playwright console message for the tracker to classify it. */
function consoleMessage(type: string, text: string, url = '') {
  return {
    location: () => ({ columnNumber: 0, lineNumber: 0, url }),
    text: () => text,
    type: () => type,
  } as unknown as ConsoleMessage
}

interface StubRoute {
  handler: (route: Route) => unknown
  matcher: (url: URL) => boolean
}

/**
 * A page that records its listeners and route patterns, so a test can emit the console and
 * network events a real browser would and watch what the tracker does with them. Stubbing the
 * tracker's OUTPUT instead would leave the part that decides anything — the origin test — untested.
 */
function httpResponse(status: number, url: string) {
  return {
    status: () => status,
    url: () => url,
  } as unknown as Response
}

function stubPage() {
  const consoleListeners: Array<(message: ConsoleMessage) => void> = []
  const pageErrorListeners: Array<(error: Error) => void> = []
  const responseListeners: Array<(response: Response) => void> = []
  const routes: StubRoute[] = []

  const page = {
    on(event: string, listener: unknown) {
      if (event === 'console') consoleListeners.push(listener as (message: ConsoleMessage) => void)
      if (event === 'pageerror') pageErrorListeners.push(listener as (error: Error) => void)
      if (event === 'response') responseListeners.push(listener as (response: Response) => void)
      return page
    },
    route(matcher: unknown, handler: unknown) {
      routes.push({
        handler: handler as StubRoute['handler'],
        matcher: matcher as StubRoute['matcher'],
      })
      return Promise.resolve()
    },
  }

  return {
    emitConsole(type: string, text: string, url = '') {
      for (const listener of consoleListeners) listener(consoleMessage(type, text, url))
    },
    emitPageError(error: Error) {
      for (const listener of pageErrorListeners) listener(error)
    },
    emitResponse(status: number, url: string) {
      for (const listener of responseListeners) listener(httpResponse(status, url))
    },
    page: page as unknown as Page,
    /**
     * Drive a request through whatever routing the tracker installed, as the browser would, and
     * report what the handler did with it: `null` for a request no route matched.
     */
    async request(url: string) {
      const route = routes.find((candidate) => candidate.matcher(new URL(url)))
      if (!route) return null

      const outcomes: Array<Record<string, unknown>> = []
      await route.handler({
        abort: (errorCode?: string) => {
          outcomes.push({ abort: errorCode })
          return Promise.resolve()
        },
        fulfill: (options: Record<string, unknown>) => {
          outcomes.push({ fulfill: options })
          return Promise.resolve()
        },
      } as unknown as Route)
      return outcomes[0] ?? null
    },
    routes,
  }
}

describe('isOptionalTelemetryHost', () => {
  it('matches the known analytics domains and their subdomains', () => {
    expect(isOptionalTelemetryHost('static.cloudflareinsights.com')).toBe(true)
    expect(isOptionalTelemetryHost('cloudflareinsights.com')).toBe(true)
    expect(isOptionalTelemetryHost('www.googletagmanager.com')).toBe(true)
    expect(isOptionalTelemetryHost('www.google-analytics.com')).toBe(true)
    expect(isOptionalTelemetryHost('us.i.posthog.com')).toBe(true)
    expect(isOptionalTelemetryHost('EU.I.POSTHOG.COM')).toBe(true)
    expect(uiQuality.isOptionalTelemetryHost('posthog.com')).toBe(true)
  })

  it('does not match a first-party host, or a lookalike that merely ends the same way', () => {
    expect(isOptionalTelemetryHost('buoystat.us')).toBe(false)
    expect(isOptionalTelemetryHost('127.0.0.1')).toBe(false)
    expect(isOptionalTelemetryHost('notposthog.com')).toBe(false)
    expect(isOptionalTelemetryHost('posthog.com.evil.test')).toBe(false)
  })

  it('accepts a caller host as a bare hostname or as the configured URL', () => {
    expect(isOptionalTelemetryHost('p.nard.uk', ['p.nard.uk'])).toBe(true)
    expect(isOptionalTelemetryHost('p.nard.uk', ['https://p.nard.uk'])).toBe(true)
    expect(isOptionalTelemetryHost('p.nard.uk', ['https://p.nard.uk/'])).toBe(true)
    expect(isOptionalTelemetryHost('nard.uk', ['p.nard.uk'])).toBe(false)
    expect(isOptionalTelemetryHost('p.nard.uk', ['', '   '])).toBe(false)
  })

  it('keeps the shipped list to domains whose absence cannot change the product', () => {
    expect([...OPTIONAL_TELEMETRY_HOSTS]).toEqual([
      'cloudflareinsights.com',
      'google-analytics.com',
      'googletagmanager.com',
      'posthog.com',
    ])
  })
})

describe('createConsoleTracker', () => {
  it('installs no routing and records every console error by default', async () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page)

    expect(stub.routes).toEqual([])
    stub.emitConsole(
      'error',
      'Failed to load resource: net::ERR_CONNECTION_REFUSED',
      'https://static.cloudflareinsights.com/beacon.min.js',
    )
    stub.emitConsole('warning', 'a warning', 'https://buoystat.us/_nuxt/entry.js')
    stub.emitPageError(new Error('boom'))

    expect(tracker.getIssues()).toEqual([
      '[console:error] Failed to load resource: net::ERR_CONNECTION_REFUSED',
      '[console:warning] a warning',
      '[pageerror] boom',
    ])
    await expect(tracker.expectClean()).rejects.toThrow()
  })

  it('still accepts a bare pattern list as the second argument', () => {
    const ignoredPatterns: RegExp[] = [/^\[build\]/]
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, ignoredPatterns)

    stub.emitConsole('error', '[build] noisy', 'https://buoystat.us/_nuxt/entry.js')
    stub.emitConsole('error', 'real failure', 'https://buoystat.us/_nuxt/entry.js')

    expect(tracker.getIssues()).toEqual(['[console:error] real failure'])
  })

  it('keeps a bare RegExp[] assignable through ConsoleTrackerOptions', () => {
    const ignoredPatterns: RegExp[] = [/^\[build\]/]
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, { ignoredPatterns })

    stub.emitConsole('error', '[build] noisy')
    stub.emitConsole('error', 'real failure')

    expect(tracker.getIssues()).toEqual(['[console:error] real failure'])
  })

  it('ignores an object rule with url only when a failed response URL also matches', () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, [
      { text: /Failed to load resource/, url: /\/api\/mapkit-token(?:\?|$)/ },
    ])

    stub.emitResponse(403, 'https://lakestat.us/api/mapkit-token?issuer=x')
    stub.emitConsole(
      'error',
      'Failed to load resource: the server responded with a status of 403',
      'https://lakestat.us/',
    )

    expect(tracker.getIssues()).toEqual([])
  })

  it('still reports matching text when no failed response URL matches the object rule', () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, {
      ignoredPatterns: [{ text: /Failed to load resource/, url: /\/api\/mapkit-token(?:\?|$)/ }],
    })

    stub.emitResponse(500, 'https://lakestat.us/api/stations')
    stub.emitConsole(
      'error',
      'Failed to load resource: the server responded with a status of 500',
      'https://lakestat.us/',
    )
    stub.emitConsole(
      'error',
      'Failed to load resource: the server responded with a status of 403',
      'https://lakestat.us/',
    )

    expect(tracker.getIssues()).toEqual([
      '[console:error] Failed to load resource: the server responded with a status of 500',
      '[console:error] Failed to load resource: the server responded with a status of 403',
    ])
  })

  it('treats a text-only object rule like a bare RegExp', () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, [{ text: /^\[build\]/ }])

    stub.emitConsole('error', '[build] noisy')
    stub.emitConsole('error', 'real failure')

    expect(tracker.getIssues()).toEqual(['[console:error] real failure'])
  })

  it('does not treat a 2xx or 3xx response as the failed request an object rule needs', () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, [
      { text: /Failed to load resource/, url: /\/api\/mapkit-token/ },
    ])

    stub.emitResponse(200, 'https://lakestat.us/api/mapkit-token')
    stub.emitResponse(304, 'https://lakestat.us/api/mapkit-token')
    stub.emitConsole('error', 'Failed to load resource: the server responded with a status of 403')

    expect(tracker.getIssues()).toEqual([
      '[console:error] Failed to load resource: the server responded with a status of 403',
    ])
  })

  it('blocks optional telemetry and drops only those origins’ entries when stubbed', async () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, {
      extraTelemetryHosts: ['https://p.nard.uk'],
      telemetry: 'stub',
    })
    await tracker.ready

    /*
     * Aborted, never fulfilled. An empty 204 for Cloudflare's beacon is a body that fails the
     * `integrity` attribute Cloudflare injects with it, and the resulting SRI console error is
     * reported against the DOCUMENT, which no origin filter can attribute to telemetry. An
     * aborted request is never integrity-checked and its console entry keeps the telemetry URL.
     */
    await expect(
      stub.request('https://static.cloudflareinsights.com/beacon.min.js'),
    ).resolves.toEqual({ abort: 'blockedbyclient' })
    await expect(stub.request('https://www.googletagmanager.com/gtag/js?id=G-1')).resolves.toEqual({
      abort: 'blockedbyclient',
    })
    await expect(stub.request('https://p.nard.uk/e/?ip=1')).resolves.toEqual({
      abort: 'blockedbyclient',
    })

    stub.emitConsole(
      'error',
      'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector',
      'https://static.cloudflareinsights.com/beacon.min.js',
    )
    stub.emitConsole(
      'error',
      'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector',
      'https://p.nard.uk/e/',
    )

    expect(tracker.getIssues()).toEqual([])
    await expect(tracker.expectClean()).resolves.toBeUndefined()
  })

  it('leaves first-party traffic unrouted and its failures fatal when stubbed', async () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, {
      extraTelemetryHosts: ['p.nard.uk'],
      telemetry: 'stub',
    })
    await tracker.ready

    await expect(stub.request('https://buoystat.us/api/stations')).resolves.toBeNull()

    stub.emitConsole(
      'error',
      'Failed to load resource: the server responded with a status of 500',
      'https://buoystat.us/api/stations',
    )
    stub.emitConsole('error', 'Hydration node mismatch', 'https://buoystat.us/_nuxt/DlAUqK2U.js')
    stub.emitConsole('error', 'no location at all')

    expect(tracker.getIssues()).toEqual([
      '[console:error] Failed to load resource: the server responded with a status of 500',
      '[console:error] Hydration node mismatch',
      '[console:error] no location at all',
    ])
    await expect(tracker.expectClean()).rejects.toThrow()
  })

  it('keeps a document-scoped error fatal even when its text names a telemetry URL', async () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, { telemetry: 'stub' })
    await tracker.ready

    /*
     * The boundary of what an origin-scoped filter can do, and the reason these requests are
     * aborted rather than fulfilled. Chromium reports a Subresource Integrity failure against
     * the DOCUMENT, so this entry is indistinguishable from a first-party error no matter what
     * URL its text happens to quote, and it stays fatal. Blocking the request means the
     * integrity check never runs, so this message never occurs in the first place.
     */
    stub.emitConsole(
      'error',
      "Failed to find a valid digest in the 'integrity' attribute for resource " +
        "'https://static.cloudflareinsights.com/beacon.min.js'. The resource has been blocked.",
      'https://buoystat.us/',
    )

    expect(tracker.getIssues()).toHaveLength(1)
    await expect(tracker.expectClean()).rejects.toThrow()
  })

  it('drops a pageerror thrown by telemetry code but keeps one that merely mentions it', async () => {
    const stub = stubPage()
    const tracker = createConsoleTracker(stub.page, { telemetry: 'stub' })
    await tracker.ready

    const fromTelemetry = new Error('posthog exploded')
    fromTelemetry.stack =
      'Error: posthog exploded\n    at https://us.i.posthog.com/static/array.js:1:2\n    at https://buoystat.us/_nuxt/entry.js:3:4'
    stub.emitPageError(fromTelemetry)

    const fromApp = new Error('app exploded')
    fromApp.stack =
      'Error: app exploded\n    at https://buoystat.us/_nuxt/entry.js:3:4\n    at https://us.i.posthog.com/static/array.js:1:2'
    stub.emitPageError(fromApp)

    stub.emitPageError(new Error('no stack at all'))

    expect(tracker.getIssues()).toEqual(['[pageerror] app exploded', '[pageerror] no stack at all'])
  })
})
