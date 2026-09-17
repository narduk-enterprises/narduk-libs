import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { expect } from '@playwright/test'

import type { Locator, Page } from '@playwright/test'

export interface UiQualityElementCapture {
  name: string
  path: string
}

export interface UiQualityRouteCapture {
  elementScreenshots: UiQualityElementCapture[]
  id: string
  pageScreenshot: string
  route: string
  title: string
}

export interface UiQualityManifest {
  [key: string]: unknown
  app?: string
  captures?: unknown
  generatedAt?: string
  minimumFullPageCount?: number
  minimumScreenshotCount?: number
}

export interface CaptureNamedLocatorOptions {
  suppressStickyChrome?: boolean
  waitAfterScrollMs?: number
}

export interface CaptureFullPageAuditOptions {
  loadLazyMedia?: boolean
  suppressStickyChrome?: boolean
}

export interface UiQualityRootOptions {
  scope?: string
}

function assertSafeUiQualityRoot(rootDir: string) {
  const resolvedRoot = path.resolve(rootDir)
  if (!rootDir.trim()) {
    throw new Error('prepareUiQualityRoot() requires a non-empty rootDir.')
  }

  const cwd = path.resolve(process.cwd())
  const relativeToCwd = path.relative(cwd, resolvedRoot)
  if (!relativeToCwd || relativeToCwd.startsWith('..') || path.isAbsolute(relativeToCwd)) {
    throw new Error(
      `Refusing to delete "${resolvedRoot}" because it must resolve to a subdirectory of "${cwd}".`,
    )
  }

  const visualAuditRoot = path.resolve(cwd, 'output', 'playwright', 'visual-audit')
  const relativeToVisualAuditRoot = path.relative(visualAuditRoot, resolvedRoot)
  if (relativeToVisualAuditRoot.startsWith('..') || path.isAbsolute(relativeToVisualAuditRoot)) {
    throw new Error(
      `Refusing to delete "${resolvedRoot}" because UI quality output should be within "${visualAuditRoot}".`,
    )
  }

  const root = path.parse(resolvedRoot).root
  if (resolvedRoot === root) {
    throw new Error(
      `Refusing to delete "${resolvedRoot}" because it resolves to the filesystem root.`,
    )
  }
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '') || 'capture'
  )
}

export function prepareUiQualityRoot(rootDir: string, options: UiQualityRootOptions = {}) {
  const scope = options.scope?.trim()
  const resolvedRoot = scope ? path.join(rootDir, slugify(scope)) : rootDir

  assertSafeUiQualityRoot(resolvedRoot)

  rmSync(resolvedRoot, { recursive: true, force: true })
  mkdirSync(resolvedRoot, { recursive: true })
  return resolvedRoot
}

export function writeUiQualityManifest(rootDir: string, manifest: UiQualityManifest) {
  mkdirSync(rootDir, { recursive: true })
  writeFileSync(
    path.join(rootDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

export async function waitForRenderableImages(page: Page) {
  await page.waitForFunction(() => {
    return Array.from(document.images).every((image) => {
      if (image.offsetWidth === 0 || image.offsetHeight === 0) return true

      return image.complete && image.naturalWidth > 0
    })
  })

  await page.evaluate(async () => {
    const renderableImages = Array.from(document.images).filter(
      (image) => image.offsetWidth > 0 && image.offsetHeight > 0,
    )

    await Promise.all(renderableImages.map((image) => image.decode().catch(() => null)))
  })
}

export async function loadLazyMediaForFullPageCapture(page: Page) {
  const images = page.locator('img')
  const imageCount = await images.count()

  for (let index = 0; index < imageCount; index += 1) {
    const image = images.nth(index)
    const isRenderable = await image.evaluate(
      (imageElement: HTMLImageElement) =>
        imageElement.offsetWidth > 0 && imageElement.offsetHeight > 0,
    )
    if (!isRenderable) continue

    const element = await image.elementHandle()
    if (!element) continue

    await image.scrollIntoViewIfNeeded()
    await page.waitForFunction((node) => {
      const imageElement = node as HTMLImageElement
      return imageElement.complete && imageElement.naturalWidth > 0
    }, element)
    await image.evaluate(async (imageElement: HTMLImageElement) => {
      await imageElement.decode().catch(() => null)
    })
  }

  await page.evaluate(() => window.scrollTo(0, 0))
  await waitForRenderableImages(page)
}

async function captureLocatorScreenshot(
  page: Page,
  locator: Locator,
  screenshotPath: string,
  options: CaptureNamedLocatorOptions,
) {
  await locator.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' })
    }
  })
  await page.waitForTimeout(options.waitAfterScrollMs ?? 150)
  await locator.screenshot({ path: screenshotPath })
}

export async function withStickyChromeSuppressed(page: Page, fn: () => Promise<void>) {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'playwright-visual-audit-suppress-sticky'
    style.textContent = `
      header.sticky,
      nav.sticky,
      section.sticky,
      [class*=" sticky"],
      [class^="sticky"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `
    document.head.append(style)
  })

  try {
    await fn()
  } finally {
    await page.evaluate(() => {
      document.getElementById('playwright-visual-audit-suppress-sticky')?.remove()
    })
  }
}

export async function captureNamedLocator(
  page: Page,
  locator: Locator,
  name: string,
  directory: string,
  captures: UiQualityElementCapture[],
  options: CaptureNamedLocatorOptions = {},
) {
  await expect(locator).toBeVisible()
  const screenshotPath = path.join(directory, `${slugify(name)}.png`)

  if (options.suppressStickyChrome === false) {
    await captureLocatorScreenshot(page, locator, screenshotPath, options)
  } else {
    await withStickyChromeSuppressed(page, async () => {
      await captureLocatorScreenshot(page, locator, screenshotPath, options)
    })
  }

  captures.push({ name, path: screenshotPath })
}

export async function captureSelectOverlay(
  page: Page,
  label: string,
  directory: string,
  captures: UiQualityElementCapture[],
) {
  const combobox = page.getByRole('combobox', { name: label })
  await expect(combobox).toBeVisible()
  await combobox.scrollIntoViewIfNeeded()
  await combobox.click({ force: true })

  const listbox = page.getByRole('listbox').last()
  await expect(listbox).toBeVisible()
  const screenshotPath = path.join(directory, `${slugify(`${label}-overlay`)}.png`)
  await listbox.screenshot({ path: screenshotPath })
  captures.push({ name: `${label} overlay`, path: screenshotPath })

  await page.keyboard.press('Escape')
  await expect(listbox).toBeHidden()
}

export async function captureFullPageAudit(
  page: Page,
  rootDir: string,
  route: string,
  title: string,
  captureElements: (directory: string, captures: UiQualityElementCapture[]) => Promise<void>,
  options: CaptureFullPageAuditOptions = {},
): Promise<UiQualityRouteCapture> {
  const directory = path.join(rootDir, slugify(title))
  mkdirSync(directory, { recursive: true })

  if (options.loadLazyMedia) {
    await loadLazyMediaForFullPageCapture(page)
  }

  const pageScreenshot = path.join(directory, 'page-full.png')
  const capturePageScreenshot = async () => {
    await page.screenshot({
      path: pageScreenshot,
      fullPage: true,
    })
  }

  if (options.suppressStickyChrome === false) {
    await capturePageScreenshot()
  } else {
    await withStickyChromeSuppressed(page, capturePageScreenshot)
  }

  const elementScreenshots: UiQualityElementCapture[] = []
  await captureElements(directory, elementScreenshots)

  return {
    id: slugify(title),
    route,
    title,
    pageScreenshot,
    elementScreenshots,
  }
}

export type TelemetryMode = 'live' | 'stub'

/**
 * Registrable domains whose traffic is OPTIONAL analytics/telemetry: the product renders and
 * behaves identically when they never answer. A host matches this list exactly or as a
 * subdomain of it, so `posthog.com` also covers `us.i.posthog.com` and `cloudflareinsights.com`
 * also covers `static.cloudflareinsights.com`.
 *
 * An app that proxies its own analytics under a first-party-looking hostname — the Narduk
 * fleet's PostHog reverse proxy is configured per app as `POSTHOG_HOST` and surfaces as
 * `runtimeConfig.public.posthogHost` — cannot be discovered from here, because this package
 * has no runtime dependency on the app or on `@narduk-enterprises/narduk-analytics`. Those
 * hosts are supplied by the caller through
 * {@link ConsoleTrackerOptions.extraTelemetryHosts}, which accepts a bare hostname or the
 * configured URL itself.
 */
export const OPTIONAL_TELEMETRY_HOSTS = [
  'cloudflareinsights.com',
  'google-analytics.com',
  'googletagmanager.com',
  'posthog.com',
] as const

function normalizeTelemetryHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null

  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname.replace(/\.$/, '') || null
    } catch {
      return null
    }
  }

  return trimmed.split('/')[0]?.replaceAll(/^\.+|\.$/g, '') || null
}

/**
 * Whether `hostname` belongs to an optional-telemetry origin, matching the registrable domain
 * itself or any subdomain of it.
 */
export function isOptionalTelemetryHost(hostname: string, extraHosts: readonly string[] = []) {
  const host = normalizeTelemetryHost(hostname)
  if (!host) return false

  return [...OPTIONAL_TELEMETRY_HOSTS, ...extraHosts].some((entry) => {
    const candidate = normalizeTelemetryHost(entry)
    if (!candidate) return false

    return host === candidate || host.endsWith(`.${candidate}`)
  })
}

function hostnameOf(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

/**
 * The URL of the FIRST stack frame, which is the code that actually threw. Matching any frame
 * would drop a first-party error merely because a telemetry script appears further down its
 * stack.
 */
function topFrameUrl(stack: string | undefined): string | null {
  if (!stack) return null

  return /\bhttps?:\/\/[^\s)]+/.exec(stack)?.[0] ?? null
}

export interface ConsoleTrackerOptions {
  /**
   * Extra optional-telemetry hosts for this app, as a bare hostname (`p.nard.uk`) or as the
   * configured URL (`https://p.nard.uk`). Only consulted when `telemetry` is `'stub'`.
   */
  extraTelemetryHosts?: string[]
  /**
   * Console text this suite has already decided is not a defect. Passing a bare `RegExp[]` as
   * the second argument is the same thing and stays supported.
   */
  ignoredPatterns?: RegExp[]
  /**
   * `'live'` (the default) lets optional telemetry reach the network, which is what a suite
   * running against a real browser on a normal network has always done.
   *
   * `'stub'` blocks every optional-telemetry request before it reaches the network, the way a
   * content blocker does, and drops the console and `pageerror` entries those origins produce.
   * It exists because whether an analytics CDN is reachable is a property of the machine, not
   * of the app: a tailnet resolver answering `0.0.0.0` for `static.cloudflareinsights.com`
   * turns `expectClean()` into a test of the operator's DNS. Nothing else is excluded — a
   * first-party request that fails, a hydration mismatch, and every other console error stay
   * fatal in both modes.
   *
   * The requests are ABORTED rather than fulfilled with an empty `204`, which is what this
   * option shipped as in 1.3.1 and what a first reading of the problem suggests. Cloudflare
   * injects its beacon with an `integrity` attribute, so an empty body is a body that fails
   * Subresource Integrity, and Chromium then reports
   * `Failed to find a valid digest in the 'integrity' attribute` — a console error whose
   * `location().url` is the DOCUMENT rather than the beacon, which no origin-scoped filter can
   * attribute to telemetry. Measured against https://buoystat.us on 2026-09-16: the `204`
   * traded three `ERR_CONNECTION_REFUSED` errors for six unattributable SRI errors, while an
   * abort leaves `ERR_BLOCKED_BY_CLIENT` entries that do carry the telemetry URL.
   */
  telemetry?: TelemetryMode
}

export interface ConsoleTracker {
  expectClean(): Promise<void>
  getIssues(): string[]
  /**
   * Resolves once telemetry routing is installed. Await it before the first navigation when
   * `telemetry` is `'stub'`; {@link ConsoleTracker.expectClean} awaits it too, so a failed
   * install surfaces as a test failure rather than as a silently live run.
   */
  ready: Promise<void>
}

export function createConsoleTracker(
  page: Page,
  options: ConsoleTrackerOptions | RegExp[] = {},
): ConsoleTracker {
  const resolved: ConsoleTrackerOptions = Array.isArray(options)
    ? { ignoredPatterns: options }
    : options
  const ignoredPatterns = resolved.ignoredPatterns ?? []
  const extraTelemetryHosts = resolved.extraTelemetryHosts ?? []
  const stubTelemetry = resolved.telemetry === 'stub'

  const isTelemetryUrl = (value: string | null | undefined) => {
    const hostname = hostnameOf(value)
    return hostname ? isOptionalTelemetryHost(hostname, extraTelemetryHosts) : false
  }

  const issues: string[] = []

  page.on('console', (message) => {
    const type = message.type()
    const text = message.text()

    if (type !== 'error' && type !== 'warning') return
    if (ignoredPatterns.some((pattern) => pattern.test(text))) return
    if (stubTelemetry && isTelemetryUrl(message.location()?.url)) return

    issues.push(`[console:${type}] ${text}`)
  })

  page.on('pageerror', (error) => {
    if (stubTelemetry && isTelemetryUrl(topFrameUrl(error.stack))) return

    issues.push(`[pageerror] ${error.message}`)
  })

  const installTelemetryRoutes = async () => {
    await page.route(
      (url) => isOptionalTelemetryHost(url.hostname, extraTelemetryHosts),
      (route) => route.abort('blockedbyclient'),
    )
  }

  const ready: Promise<void> = stubTelemetry ? installTelemetryRoutes() : Promise.resolve()
  void ready.catch(() => {})

  return {
    ready,
    getIssues() {
      return [...issues]
    },
    async expectClean() {
      await ready
      expect(issues, issues.join('\n')).toEqual([])
    },
  }
}

const uiQuality = {
  captureFullPageAudit,
  captureNamedLocator,
  captureSelectOverlay,
  createConsoleTracker,
  isOptionalTelemetryHost,
  loadLazyMediaForFullPageCapture,
  prepareUiQualityRoot,
  slugify,
  waitForRenderableImages,
  withStickyChromeSuppressed,
  writeUiQualityManifest,
}

export default uiQuality
