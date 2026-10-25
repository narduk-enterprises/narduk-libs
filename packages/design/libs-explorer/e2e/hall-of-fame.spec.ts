import { expect, test, type Page } from '@playwright/test'

async function openCard(page: Page, id: string) {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (/hydration|\[Vue warn\]/i.test(message.text())) failures.push(message.text())
  })
  await page.goto(`/frame/${id}/card`)
  await expect(page.locator('[data-ready="true"]')).toBeVisible()
  return failures
}

test('settle starts at rest and responds to an explicit arrival, including reduced motion', async ({
  page,
}, testInfo) => {
  const failures = await openCard(page, 'ne-settle')
  const card = page.locator('[data-ne-settle]:not(.ne-settle-leave-active)')
  await expect(card).toContainText('Dock 1')
  await expect(card).not.toHaveClass(/ne-settle-enter/)
  const move = page.getByRole('button', { name: 'Move sample trailer to dock' })
  await move.focus()
  await page.keyboard.press('Enter')
  await expect(card).toContainText('Dock 2')
  await expect(card).not.toHaveClass(/ne-settle-enter-active/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await move.click()
  await expect(card).toContainText('Dock 3')
  expect(await card.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
  await expect(move).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('settle.png'), fullPage: true })
  expect(failures).toEqual([])
})

test('timeline keeps partial and missing periods honest and supports keyboard selection', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const failures = await openCard(page, 'ne-timeline-hero')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('$90B')
  const partial = page.getByRole('button', { name: 'FY26, $90B, partial period', exact: true })
  await expect(partial).toHaveAttribute('aria-pressed', 'true')
  expect(await partial.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(
    44,
  )
  const reported = page.getByRole('button', { name: 'FY24, $150B', exact: true })
  await reported.focus()
  await page.keyboard.press('Enter')
  await expect(reported).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('$150B')
  const missing = page.getByRole('button', { name: 'FY27, Not reported', exact: true })
  await missing.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Not reported')
  expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('timeline.png'), fullPage: true })
  expect(failures).toEqual([])
})

test('statement shows a source-qualified snapshot and an accessible action on either viewport', async ({
  page,
}, testInfo) => {
  const failures = await openCard(page, 'ne-statement-hero')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Miles Ahead, Miles Behind')
  await expect(page.locator('[data-state="stale"]')).toContainText('Last known')
  await expect(page.locator('[data-state="stale"]')).toContainText('Sample snapshot')
  const action = page.getByRole('link', { name: 'See the sample schedule' })
  await expect(action).toHaveAttribute('href', /#schedule$/)
  await action.focus()
  await expect(action).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('statement.png'), fullPage: true })
  expect(failures).toEqual([])
})
