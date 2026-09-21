import { expect, test } from '@playwright/test'

test('every catalog package and component demo has a page', async ({ page }) => {
  await page.goto('/packages')
  const packageLinks = await page.locator('main a[href^="/packages/"]').count()
  expect(packageLinks).toBeGreaterThanOrEqual(28)

  await page.goto('/components')
  const demoHrefs = await page
    .locator('main a[href^="/components/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  expect(demoHrefs.length).toBeGreaterThanOrEqual(16)
  for (const href of demoHrefs) {
    const response = await page.goto(href)
    expect(response?.status(), href).toBe(200)
    await expect(page.locator('main h1').first()).toBeVisible()
    await expect(
      page.locator('[data-design-card], [data-testid="demo-frame"]').first(),
    ).toBeVisible()
  }
})

test('search narrows navigation by capability', async ({ page }) => {
  await page.goto('/')
  const menu = page.getByRole('button', { name: 'Menu' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('textbox', { name: 'Search the Explorer' }).fill('upload')
  const nav = page.getByRole('navigation', { name: 'Explorer' })
  await expect(nav.getByRole('link', { name: 'narduk-uploads' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Data table' })).toHaveCount(0)
})

test('data table: sort, presets in the URL, event log and reset', async ({ page }) => {
  await page.goto('/components/ne-data-table')
  const table = page.getByTestId('demo-frame').locator('table')
  const firstStation = table.locator('tbody tr').first()
  await expect(firstStation).toContainText('Port Aransas')

  await table.getByRole('button', { name: /avg/ }).click()
  await expect(page).toHaveURL(/sort=wind%3Adesc|sort=wind:desc/)
  await expect(firstStation).toContainText('Sabine Pass')
  await expect(page.getByTestId('event-log')).toContainText('update:sort "wind:desc"')
  await expect(table).toContainText('sorted last')

  await page.getByRole('switch', { name: 'No rows' }).click()
  await expect(table).toContainText('No readings in this window')
  await expect(page).toHaveURL(/empty=1/)

  // A shared link restores the same state.
  await page.goto(page.url())
  await expect(table).toContainText('No readings in this window')

  await page.getByTestId('demo-reset').click()
  await expect(page).toHaveURL(/\/components\/ne-data-table$/)
  await expect(firstStation).toContainText('Port Aransas')
  await expect(page.getByTestId('event-log')).toContainText('No events yet.')
})

test('data table: CSV export carries the rows in view', async ({ page }) => {
  await page.goto('/components/ne-data-table?sort=wind:desc')
  const download = page.waitForEvent('download')
  await page.getByTestId('demo-controls').getByRole('button', { name: 'CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('explorer-readings.csv')
  const text = await (await file.createReadStream()).toArray()
  const csv = Buffer.concat(text).toString('utf8')
  expect(csv.split('\n')[0]).toContain('Fixture data')
  expect(csv).toMatch(/Sabine Pass[\s\S]*Aransas Bay/)
})

test('color mode switches and foundations show both schemes', async ({ page }) => {
  await page.goto('/foundations')
  await expect(page.getByText('--ne-accent', { exact: true })).toBeVisible()
  const html = page.locator('html')
  const before = await html.getAttribute('class')
  await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
  await expect(html).not.toHaveAttribute('class', before ?? '')
})

test('build provenance links the source commit', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('source-commit')).toHaveAttribute(
    'href',
    /github\.com\/narduk-enterprises\/narduk-libs\/commit\/[0-9a-f]{40}$/,
  )
})
