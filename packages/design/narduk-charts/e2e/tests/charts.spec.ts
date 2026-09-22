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

test.describe('series palette tokens', () => {
  const stroke = (testId: string, nth: number) =>
    `[data-testid="${testId}"] .narduk-line-path >> nth=${nth}`

  test('theme classes repaint the series, not just the chrome', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    await page.waitForSelector('[data-testid="palette-cbs-section"] .narduk-line-path', {
      timeout: 30_000,
    })

    const resolved = (sel: string) => page.locator(sel).evaluate(el => getComputedStyle(el).stroke)

    const defaults = [
      await resolved(stroke('palette-default-section', 0)),
      await resolved(stroke('palette-default-section', 1)),
    ]
    const safe = [
      await resolved(stroke('palette-cbs-section', 0)),
      await resolved(stroke('palette-cbs-section', 1)),
    ]

    // Every stroke resolved to a real color — a var() the browser could not
    // resolve would come back as `none` or the initial value.
    for (const value of [...defaults, ...safe]) {
      expect(value).toMatch(/^(rgb|color|oklch)/)
    }

    // The whole point of the token indirection: same markup, different palette.
    expect(safe[0]).not.toBe(defaults[0])
    expect(safe[1]).not.toBe(defaults[1])
    // …and the two series stay distinguishable from each other within a theme.
    expect(safe[0]).not.toBe(safe[1])
  })
})

test.describe('visual regression', () => {
  test('line section baseline', async ({ page }) => {
    test.skip(
      !!process.env.CI,
      'Screenshot baselines are generated per-OS; run locally with npm run test:e2e:update',
    )
    await page.goto('/')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    const section = page.locator('[data-testid="line-section"]')
    await expect(section).toHaveScreenshot('line-section.png', { timeout: 15_000 })
  })
})

test.describe('off-screen data tables', () => {
  // narduk-libs#296: the off-screen data table must not widen its container.
  // An auto-layout <table> grows to its content's min width whatever its
  // declared 1px, and `overflow` does not apply to a table box, so the
  // visually-hidden table pushed a 390px page out to 652px in Buoys.
  test('an off-screen data table adds no width to a narrow container', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.e2e-root', { timeout: 30_000 })
    const section = page.locator('[data-testid="narrow-data-table-section"]')
    await expect(section.locator('table')).toHaveCount(2)
    const { clientWidth, scrollWidth } = await section.evaluate(el => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    // Still a real table, still in the accessibility tree.
    await expect(section.getByRole('table', { name: 'Narrow line with data table' })).toHaveCount(1)
  })
})
