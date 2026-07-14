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

export function createConsoleTracker(page: Page, ignoredPatterns: RegExp[] = []) {
  const issues: string[] = []

  page.on('console', (message) => {
    const type = message.type()
    const text = message.text()

    if (
      (type === 'error' || type === 'warning') &&
      !ignoredPatterns.some((pattern) => pattern.test(text))
    ) {
      issues.push(`[console:${type}] ${text}`)
    }
  })

  page.on('pageerror', (error) => {
    issues.push(`[pageerror] ${error.message}`)
  })

  return {
    getIssues() {
      return [...issues]
    },
    async expectClean() {
      expect(issues, issues.join('\n')).toEqual([])
    },
  }
}

const uiQuality = {
  captureFullPageAudit,
  captureNamedLocator,
  captureSelectOverlay,
  createConsoleTracker,
  loadLazyMediaForFullPageCapture,
  prepareUiQualityRoot,
  slugify,
  waitForRenderableImages,
  withStickyChromeSuppressed,
  writeUiQualityManifest,
}

export default uiQuality
