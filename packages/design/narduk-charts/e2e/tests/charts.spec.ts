import { test, expect } from '@playwright/test'

test.describe('narduk-charts interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    await page.waitForSelector('.narduk-line-chart__svg', { timeout: 30_000 })
  })

  test('line chart receives keyboard focus and moves with arrows', async ({ page }) => {
    const svg = page.locator('[data-testid="line-chart"] .narduk-line-chart__svg')
    await svg.focus()
    await expect(svg).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const polite = page.locator('[aria-live="polite"]')
    await expect(polite.first()).not.toHaveText('')
  })

  test('legend toggles aria-pressed', async ({ page }) => {
    const btn = page.locator('[data-testid="line-section"] .narduk-legend__item').first()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  test('bar rects are keyboard-focusable', async ({ page }) => {
    const firstBar = page.locator('[data-testid="bar-chart"] [data-nc-bar="0"]')
    await firstBar.focus()
    await expect(firstBar).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const second = page.locator('[data-testid="bar-chart"] [data-nc-bar="1"]')
    await expect(second).toBeFocused()
  })

  test('pie slice keyboard rotation', async ({ page }) => {
    const s0 = page.locator('[data-testid="pie-chart"] [data-nc-slice="0"]')
    await s0.focus()
    await expect(s0).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const s1 = page.locator('[data-testid="pie-chart"] [data-nc-slice="1"]')
    await expect(s1).toBeFocused()
  })

  test('candle chart receives focus and updates live region', async ({ page }) => {
    const svg = page.locator('[data-testid="candle-chart"] .narduk-candle-chart__svg')
    await svg.focus()
    await expect(svg).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const polite = page.locator('[data-testid="candle-section"] [aria-live="polite"]')
    await expect(polite.first()).not.toHaveText('')
  })

  test('candle chart exposes domain after mount', async ({ page }) => {
    const dom = page.locator('[data-testid="candle-domain"]')
    await expect(dom).not.toHaveText('none', { timeout: 10_000 })
  })
})

test.describe('performance harness', () => {
  test('large candle dataset mounts', async ({ page }) => {
    await page.goto('/?candlePerf=1')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    const t0 = Date.now()
    await page.waitForSelector('[data-testid="candle-chart"] .narduk-candle-chart__svg', {
      timeout: 15_000,
    })
    expect(Date.now() - t0).toBeLessThan(12_000)
  })
})

test.describe('visual regression', () => {
  test('line section baseline', async ({ page }) => {
    test.skip(!!process.env.CI, 'Screenshot baselines are generated per-OS; run locally with npm run test:e2e:update')
    await page.goto('/')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    const section = page.locator('[data-testid="line-section"]')
    await expect(section).toHaveScreenshot('line-section.png', { timeout: 15_000 })
  })
})
