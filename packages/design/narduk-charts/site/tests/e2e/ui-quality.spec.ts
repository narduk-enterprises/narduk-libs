import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as Playwright from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
// @ts-expect-error Playwright loads this helper at runtime from an .mjs module.
import uiQuality from '../../../tools/playwright/ui-quality.mjs'
import { expect, test, waitForBaseUrlReady, waitForSiteHydration, warmUpSite } from './fixtures'

const SCREENSHOT_ROOT = path.resolve(process.cwd(), 'output/playwright/ui-quality')
type UiQualityElementCapture = Array<{ name: string; path: string }>
const {
  captureFullPageAudit,
  captureNamedLocator,
  createConsoleTracker,
  prepareUiQualityRoot,
  writeUiQualityManifest,
} = uiQuality

async function gotoAndSettle(page: import('@playwright/test').Page, route: string) {
  let response: Awaited<ReturnType<typeof page.goto>> | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await page.goto(route, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('ERR_ABORTED') || attempt === 1) {
        throw error
      }

      await page.waitForTimeout(500)
    }
  }

  expect(response?.ok(), `Expected ${route} to return an OK response`).toBeTruthy()
  await waitForSiteHydration(page)
  await page.waitForLoadState('networkidle').catch(() => {})
  await expect(page.locator('main')).toBeVisible()
}

test.describe('site ui quality', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  test.beforeAll(async ({ browser, baseURL }) => {
    if (!baseURL) {
      throw new Error('site ui quality requires Playwright baseURL to be configured.')
    }

    await waitForBaseUrlReady(baseURL)
    await warmUpSite(browser, baseURL)
    prepareUiQualityRoot(SCREENSHOT_ROOT)
  })

  test('captures flagship desktop surfaces', async ({ page }) => {
    const consoleTracker = createConsoleTracker(page, [/favicon\.ico/i])
    const captures = []

    await gotoAndSettle(page, '/')
    captures.push(
      await captureFullPageAudit(
        page,
        SCREENSHOT_ROOT,
        '/',
        'Marketing Home',
        async (directory: string, elementCaptures: UiQualityElementCapture) => {
          await captureNamedLocator(
            page,
            page.locator('main section').first(),
            'hero-section',
            directory,
            elementCaptures
          )
          await captureNamedLocator(
            page,
            page
              .getByRole('heading', { name: /Examples by use case/i })
              .locator('xpath=ancestor::section[1]'),
            'examples-grid',
            directory,
            elementCaptures
          )
        }
      )
    )

    await gotoAndSettle(page, '/examples/aapl?ui-audit=1')
    await page.waitForSelector('.narduk-candle-chart__svg', { timeout: 20_000 })
    captures.push(
      await captureFullPageAudit(
        page,
        SCREENSHOT_ROOT,
        '/examples/aapl?ui-audit=1',
        'AAPL Demo',
        async (directory: string, elementCaptures: UiQualityElementCapture) => {
          await captureNamedLocator(
            page,
            page.locator('.ns-terminal-shell').first(),
            'terminal-shell',
            directory,
            elementCaptures
          )
          await captureNamedLocator(
            page,
            page.locator('.ns-terminal-panel').nth(1),
            'rsi-panel',
            directory,
            elementCaptures
          )
        }
      )
    )

    await gotoAndSettle(page, '/examples/trading?ui-audit=1')
    await page.waitForSelector('.narduk-candle-chart__svg', { timeout: 20_000 })
    captures.push(
      await captureFullPageAudit(
        page,
        SCREENSHOT_ROOT,
        '/examples/trading?ui-audit=1',
        'Trading Demo',
        async (directory: string, elementCaptures: UiQualityElementCapture) => {
          await captureNamedLocator(
            page,
            page.locator('.ns-terminal-shell').first(),
            'terminal-shell',
            directory,
            elementCaptures
          )
          await captureNamedLocator(
            page,
            page.locator('.ns-terminal-panel').nth(2),
            'secondary-pane',
            directory,
            elementCaptures
          )
        }
      )
    )

    writeUiQualityManifest(SCREENSHOT_ROOT, {
      app: 'narduk-charts/site',
      generatedAt: new Date().toISOString(),
      minimumScreenshotCount: 10,
      minimumFullPageCount: 3,
      captures,
    })

    await consoleTracker.expectClean()
  })

  test('captures mobile layouts and records overflow metrics', async ({ browser }) => {
    const context: BrowserContext = await browser.newContext(Playwright.devices['iPhone 13'])
    try {
      const page = await context.newPage()
      const consoleTracker = createConsoleTracker(page, [/favicon\.ico/i])
      const mobileRoot = path.join(SCREENSHOT_ROOT, 'mobile')

      mkdirSync(mobileRoot, { recursive: true })

      await gotoAndSettle(page, '/')
      await page.screenshot({
        path: path.join(mobileRoot, 'marketing-home-full.png'),
        fullPage: true,
      })

      await gotoAndSettle(page, '/examples/aapl?ui-audit=1')
      await page.waitForSelector('.narduk-candle-chart__svg', { timeout: 20_000 })
      await page.screenshot({
        path: path.join(mobileRoot, 'aapl-demo-full.png'),
        fullPage: true,
      })

      const metrics = await page.evaluate(() => {
        const width = document.documentElement.clientWidth
        const horizontalOverflow = document.documentElement.scrollWidth > width
        return {
          viewportWidth: width,
          pageHeight: document.documentElement.scrollHeight,
          horizontalOverflow,
        }
      })

      expect(metrics.horizontalOverflow).toBe(false)

      writeFileSync(
        path.join(mobileRoot, 'metrics.json'),
        `${JSON.stringify(metrics, null, 2)}\n`,
        'utf8'
      )

      await consoleTracker.expectClean()
    } finally {
      await context.close()
    }
  })
})
