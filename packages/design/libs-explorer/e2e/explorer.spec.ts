/**
 * The Explorer's browser suite, against the prerendered build.
 *
 * Deterministic by construction: no sleeps, only web-first assertions that
 * poll for a stated condition. Demo selectors are scoped to the demo's own
 * frame, so the design card (which renders the same component) never
 * satisfies them. The expected row orders and CSV come from demo/table.mts,
 * the module the page renders from, not from a copy.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test'

import { DAY_LABELS, orderReadings, parseTableQuery, READINGS } from '../demo/table.mts'

const explorerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(explorerRoot, '../../..')

/**
 * Wait until the page is interactive and every preview frame shows what the
 * page sent it. A click before either is lost (prerendered HTML is inert),
 * and waiting on these marks replaces sleeps.
 */
async function settle(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.getByTestId('frame-pending')).toHaveCount(0)
  const frames = await page
    .locator('iframe[data-testid^="frame-"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid') ?? ''))
  for (const id of frames) {
    await expect(
      page.frameLocator(`[data-testid="${id}"]`).locator('[data-ready="true"]'),
    ).toHaveCount(1)
  }
}

async function open(page: Page, url: string) {
  await page.goto(url)
  await settle(page)
}

function demoFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="frame-demo"]')
}

/** The first cell of every body row: day labels, the divider, station names. */
async function rowHeads(frame: FrameLocator): Promise<string[]> {
  const table = frame.locator('[data-testid="demo-table"] table')
  await expect(table).toBeVisible()
  return table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map(
        (row) => (row.querySelector('th, td') as HTMLElement | null)?.innerText.trim() ?? '',
      ),
    )
}

function expectedRowHeads(query: Record<string, string>): string[] {
  const state = parseTableQuery(query)
  const rows = orderReadings(READINGS, state)
  if (!state.grouped) return rows.map(({ station }) => station)
  const out: string[] = []
  let day: string | null = null
  for (const row of rows) {
    if (row.date !== day) {
      day = row.date
      out.push(DAY_LABELS[day] ?? day)
    }
    out.push(row.station)
  }
  return out
}

function searchOf(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams)
}

async function expectQuery(page: Page, expected: Record<string, string>) {
  await expect.poll(() => searchOf(page)).toEqual(expected)
}

/**
 * Press Tab until `target` has focus: proves it is reachable by keyboard.
 *
 * `limit` only bounds the loop. The sidebar gains a link with every example,
 * so a tight cap failed whenever a component was added, not when a control
 * became unreachable.
 */
async function tabTo(page: Page, target: Locator, limit = 200) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error(`Not reachable with Tab in ${limit} presses`)
}

function workspaceManifests(): { slug: string; name: string; version: string; private: boolean }[] {
  const out = []
  for (const family of readdirSync(join(repoRoot, 'packages'))) {
    const familyDirectory = join(repoRoot, 'packages', family)
    for (const slug of readdirSync(familyDirectory)) {
      const manifestPath = join(familyDirectory, slug, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      out.push({
        slug,
        name: manifest.name,
        version: manifest.version ?? '0.0.0',
        private: manifest.private === true,
      })
    }
  }
  return out
}

test.describe('catalog', () => {
  test('every workspace package has its own page, with its own identity', async ({ page }) => {
    const manifests = workspaceManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(28)
    await open(page, '/packages')
    await expect(page.locator('main a[href^="/packages/"]')).toHaveCount(manifests.length)
    for (const manifest of manifests) {
      await open(page, `/packages/${manifest.slug}`)
      await expect(page.locator('main h1')).toHaveText(manifest.slug)
      await expect(page.getByText(manifest.name, { exact: true }).first()).toBeVisible()
      await expect(page.getByTestId('workspace-version')).toHaveText(manifest.version)
      await expect(page.getByTestId(manifest.private ? 'workspace-usage' : 'setup')).toBeVisible()
      // No fabricated import statements: entry points are listed as specifiers.
      await expect(page.locator('main')).not.toContainText('import …')
    }
  })

  test('every component page renders each of its preview frames', async ({ page }) => {
    // One page load per component, so the run grows with the registry: about
    // 1.5s a page, past Playwright's 30s default at 29 components (#977).
    test.setTimeout(120_000)
    await open(page, '/components')
    const links = await page
      .locator('main a[href^="/components/"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''))
    expect(links.length).toBeGreaterThanOrEqual(16)
    for (const href of links) {
      await open(page, href)
      const id = href.split('/').at(-1)!
      const heading = page.locator('main h1')
      await expect(heading).toBeVisible()
      await expect(page.getByTestId('usage-source')).toContainText('<template>')
      for (const surface of ['demo', 'usage', 'card'] as const) {
        const section = page.getByTestId(`section-${surface}`)
        if ((await section.count()) === 0) continue
        const frame = page.frameLocator(`[data-testid="frame-${surface}"]`)
        await expect(frame.locator(`[data-surface="${surface}"]`), `${id} ${surface}`).toBeVisible()
      }
    }
  })

  test('search narrows navigation by capability', async ({ page }) => {
    await open(page, '/')
    const menu = page.getByRole('button', { name: 'Menu' })
    if (await menu.isVisible()) await menu.click()
    await page.getByRole('textbox', { name: 'Search the Explorer' }).fill('upload')
    const nav = page.getByRole('navigation', { name: 'Explorer' })
    await expect(nav.getByRole('link', { name: 'narduk-uploads' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Data table' })).toHaveCount(0)
  })
})

test.describe('viewport presets (finding 1)', () => {
  test('the phone preset is the frame document’s real viewport', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'needs a window wider than the tablet preset')
    await open(page, '/components/ne-data-table')
    const frame = demoFrame(page)
    const columnSets = frame.locator('[data-ne-column-sets]')
    // Full width on a desktop window: the table's phone column switch is hidden.
    await expect(frame.locator('[data-testid="demo-table"]')).toBeVisible()
    await expect(columnSets).toBeHidden()

    await page.getByTestId('viewport-phone').click()
    await expectQuery(page, { width: 'phone' })
    const demo = page.getByTestId('frame-demo')
    await expect
      .poll(() => demo.evaluate((iframe: HTMLIFrameElement) => iframe.contentWindow!.innerWidth))
      .toBe(375)
    await expect(columnSets).toBeVisible()
    // Only one column group is shown on a phone.
    await expect(frame.getByRole('columnheader', { name: 'height' })).toBeHidden()

    await page.getByTestId('viewport-tablet').click()
    await expect
      .poll(() => demo.evaluate((iframe: HTMLIFrameElement) => iframe.contentWindow!.innerWidth))
      .toBe(768)
    await expect(columnSets).toBeHidden()

    // The preview is only the preview: no Explorer navigation inside the frame.
    await expect(frame.getByRole('navigation', { name: 'Explorer' })).toHaveCount(0)
    // The design card is rendered unchanged, in its own frame.
    const card = page.frameLocator('[data-testid="frame-card"]')
    await expect(card.locator('[data-design-card="ne-data-table"]')).toBeVisible()
    await expect(card.locator('[data-testid="demo-controls"]')).toHaveCount(0)
  })

  test('the theme follows the page into every frame', async ({ page }) => {
    await open(page, '/components/ne-filter-bar')
    const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ })
    const card = page.getByTestId('frame-card')
    await expect(
      page.frameLocator('[data-testid="frame-card"]').locator('[data-surface]'),
    ).toBeVisible()
    const pageDark = async () =>
      (await page.locator('html').getAttribute('class'))?.includes('dark')
    const frameDark = () =>
      card.evaluate((iframe: HTMLIFrameElement) =>
        iframe.contentDocument!.documentElement.classList.contains('dark'),
      )
    const before = await pageDark()
    await toggle.click()
    await expect.poll(pageDark).toBe(!before)
    await expect.poll(frameDark).toBe(!before)
  })
})

test.describe('reset (finding 2)', () => {
  test('Reset restores a stateful design card and keeps the colour preference', async ({
    page,
  }) => {
    await open(page, '/components/ne-filter-bar')
    const card = page.frameLocator('[data-testid="frame-card"]')
    const chips = card.locator('[data-design-card="ne-filter-bar"]')
    await expect(chips.getByRole('button', { name: /^Open/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
    const preference = await page.evaluate(() => localStorage.getItem('nuxt-color-mode'))
    const scheme = await page.locator('html').getAttribute('class')

    await chips.getByRole('button', { name: /^Done/ }).first().click()
    await expect(chips.getByRole('button', { name: /^Done/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByTestId('demo-reset').click()
    await expect(chips.getByRole('button', { name: /^Open/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(chips.getByRole('button', { name: /^Done/ }).first()).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(await page.evaluate(() => localStorage.getItem('nuxt-color-mode'))).toBe(preference)
    await expect(page.locator('html')).toHaveAttribute('class', scheme ?? '')
  })

  test('Reset returns the demo to its defaults, full width and an empty log', async ({ page }) => {
    await open(page, '/components/ne-data-table?sort=wind:desc&grouped=1&width=phone')
    const frame = demoFrame(page)
    await expect(frame.getByTestId('demo-grouped-note')).toBeVisible()
    await frame.getByRole('switch', { name: 'Loading' }).click()
    await expect(page.getByTestId('event-entry')).toHaveCount(1)

    await page.getByTestId('demo-reset').click()
    await expectQuery(page, {})
    await expect(page.getByTestId('viewport-full')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('event-log')).toHaveText(/No events yet\./)
    await expect(frame.getByTestId('demo-sort')).toHaveText('sort: none')
    await expect.poll(() => rowHeads(frame)).toEqual(expectedRowHeads({}))
  })
})

test.describe('table state in the URL (finding 3)', () => {
  test('the phone column set survives a reload and walks with back/forward', async ({ page }) => {
    await open(page, '/components/ne-data-table?width=phone')
    const frame = demoFrame(page)
    const tab = (name: string) => frame.locator('[data-ne-column-sets]').getByRole('tab', { name })
    await expect(tab('Wind')).toHaveAttribute('aria-selected', 'true')

    await tab('Waves').click()
    await expectQuery(page, { set: 'waves', width: 'phone' })
    await expect(page.getByTestId('event-log')).toContainText('update:columnSet "waves"')

    await page.reload()
    await settle(page)
    await expect(tab('Waves')).toHaveAttribute('aria-selected', 'true')

    await page.goBack()
    await expectQuery(page, { width: 'phone' })
    await expect(tab('Wind')).toHaveAttribute('aria-selected', 'true')
    await page.goForward()
    await expectQuery(page, { set: 'waves', width: 'phone' })
    await expect(tab('Waves')).toHaveAttribute('aria-selected', 'true')
  })

  test('controls push history; back and forward move the demo without loops', async ({ page }) => {
    await open(page, '/components/ne-data-table')
    const frame = demoFrame(page)
    await expect(frame.getByTestId('demo-table')).toBeVisible()
    const start = await page.evaluate(() => history.length)

    await frame.getByRole('switch', { name: 'Group by day' }).click()
    await expectQuery(page, { grouped: '1' })
    await frame.locator('[data-testid="demo-table"]').getByRole('button', { name: /gust/ }).click()
    await expectQuery(page, { sort: 'gust:desc', grouped: '1' })
    expect(await page.evaluate(() => history.length)).toBe(start + 2)

    await page.goBack()
    await expectQuery(page, { grouped: '1' })
    await expect(frame.getByTestId('demo-sort')).toHaveText('sort: none')
    await page.goBack()
    await expectQuery(page, {})
    await expect(frame.getByRole('switch', { name: 'Group by day' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.goForward()
    await page.goForward()
    await expectQuery(page, { sort: 'gust:desc', grouped: '1' })
    await expect
      .poll(() => rowHeads(frame))
      .toEqual(expectedRowHeads({ sort: 'gust:desc', grouped: '1' }))
    // Syncing never added entries of its own.
    expect(await page.evaluate(() => history.length)).toBe(start + 2)
  })

  test('malformed, unknown and repeated parameters settle on one canonical URL', async ({
    page,
  }) => {
    await open(
      page,
      '/components/ne-data-table?sort=date:asc&grouped=true&set=WIND&utm=x&width=phone',
    )
    const length = await page.evaluate(() => history.length)
    await expectQuery(page, { width: 'phone' })
    expect(await page.evaluate(() => history.length)).toBe(length)
    await expect(demoFrame(page).getByTestId('demo-sort')).toHaveText('sort: none')

    await open(page, '/components/ne-data-table?sort=wind:asc&sort=gust:desc&set=pressure&set=wind')
    await expectQuery(page, { sort: 'wind:asc', set: 'pressure' })
    await expect(demoFrame(page).getByTestId('demo-sort')).toHaveText('sort: wind:asc')

    await open(page, '/components/ne-data-table?width=huge&grouped=1')
    await expectQuery(page, { grouped: '1' })
    await expect(page.getByTestId('viewport-full')).toHaveAttribute('aria-pressed', 'true')
  })

  test('loading and empty states come from the URL', async ({ page }) => {
    await open(page, '/components/ne-data-table?loading=1')
    const frame = demoFrame(page)
    await expect(frame.locator('[data-ne-data-table]')).toHaveAttribute('aria-busy', 'true')
    await expect(frame.getByRole('switch', { name: 'Loading' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await open(page, '/components/ne-data-table?empty=1')
    await expect(frame.getByText('No readings in this window')).toBeVisible()
    await expect(frame.locator('[data-ne-data-table]')).not.toHaveAttribute('aria-busy', 'true')
  })
})

test.describe('grouped sorting and export (finding 4)', () => {
  test('grouped: days newest first, missing last within each day, no global divider', async ({
    page,
  }) => {
    const query = { sort: 'gust:desc', grouped: '1' }
    await open(page, `/components/ne-data-table?${new URLSearchParams(query)}`)
    const frame = demoFrame(page)
    await expect(frame.getByTestId('demo-grouped-note')).toBeVisible()
    // Polled: the frame renders the default order first, then applies the query.
    await expect.poll(() => rowHeads(frame)).toEqual(expectedRowHeads(query))
    // Spelled out once, so the expectation is readable without the module.
    expect(await rowHeads(frame)).toEqual([
      'Fri, Sep 18',
      'Port Aransas',
      'Port Isabel',
      'Aransas Bay',
      'Thu, Sep 17',
      'Sabine Pass',
      'Bob Hall Pier',
      'Galveston',
      'Wed, Sep 16',
      'Freeport',
    ])
    await expect(frame.getByText(/sorted last/)).toHaveCount(0)
  })

  test('ungrouped: one divider above the rows with no value', async ({ page }) => {
    await open(page, '/components/ne-data-table?sort=gust:desc')
    const frame = demoFrame(page)
    await expect(frame.getByTestId('demo-sort')).toHaveText('sort: gust:desc')
    const stations = expectedRowHeads({ sort: 'gust:desc' })
    // The divider sits after the five rows with a gust value.
    await expect
      .poll(() => rowHeads(frame))
      .toEqual([
        ...stations.slice(0, 5),
        '2 rows have no gust value · sorted last',
        ...stations.slice(5),
      ])
  })

  test('the CSV is exactly the rows in view, in display order', async ({ page }) => {
    const query = { sort: 'gust:desc', grouped: '1' }
    await open(page, `/components/ne-data-table?${new URLSearchParams(query)}`)
    const frame = demoFrame(page)
    await expect(frame.getByTestId('demo-grouped-note')).toBeVisible()
    const download = page.waitForEvent('download')
    await frame.getByTestId('demo-controls').getByRole('button', { name: 'CSV' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('explorer-readings.csv')
    const csv = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8')
    const cell = (value: number | null) => (value === null ? '' : String(value))
    const expected = [
      '"Fixture data, not live readings."',
      'Station,Date,Wind avg (kt),Wind gust (kt),Wave height (ft),Pressure (inHg)',
      ...orderReadings(READINGS, parseTableQuery(query)).map((row) =>
        [
          row.station,
          row.date,
          cell(row.wind),
          cell(row.gust),
          cell(row.waves),
          cell(row.pressure),
        ].join(','),
      ),
    ]
    expect(csv).toBe(`${expected.join('\r\n')}\r\n`)
    await expect(page.getByTestId('event-log')).toContainText('csv {"rows":7}')
  })
})

test.describe('usage examples (finding 5)', () => {
  test('usage examples run as written', async ({ page }) => {
    await open(page, '/components/ne-confirm-dialog')
    const confirm = page.frameLocator('[data-testid="frame-usage"]')
    await confirm.getByRole('button', { name: 'Delete runner' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirm.getByTestId('confirm-outcome')).toHaveText('Deleted.')

    await open(page, '/components/ne-pager')
    const pager = page.frameLocator('[data-testid="frame-usage"]')
    await expect(pager.getByTestId('pager-items')).toContainText('runner-001')
    await pager.getByRole('button', { name: /next/i }).first().click()
    await expect(pager.getByTestId('pager-items')).toContainText('runner-026')
    await expect(pager.getByTestId('pager-items')).not.toContainText('runner-001')
  })

  test('the skip link moves keyboard focus into main: Tab, Enter, Tab (narduk-libs#977)', async ({
    page,
  }) => {
    // The frame opened on its own, so the skip link is the document's first
    // Tab stop, exactly as it is at the top of an app's layout.
    await page.goto('/frame/ne-skip-link/usage')
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.locator('[data-ready="true"]')).toHaveCount(1)

    const skip = page.getByRole('link', { name: 'Skip to content' })
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()

    await page.keyboard.press('Enter')
    await expect(page.locator('main#main-content')).toBeFocused()
    await expect(page).toHaveURL(/#main-content$/)

    // Past the example's nav: the next Tab starts from the target.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'First control in the page' })).toBeFocused()
  })

  test('the shown source is the file that runs, and setup is one link away', async ({ page }) => {
    await open(page, '/components/ne-data-table')
    const source = readFileSync(join(explorerRoot, 'app/usage/ne-data-table.usage.vue'), 'utf8')
    // Byte for byte: toHaveText would normalise whitespace.
    await expect
      .poll(() =>
        page
          .getByTestId('usage-source')
          .locator('code')
          .evaluate((code) => code.textContent),
      )
      .toBe(source)
    await page.getByRole('link', { name: '@narduk-enterprises/narduk-shell setup' }).click()
    await expect(page.getByTestId('setup')).toContainText(
      "modules: ['@narduk-enterprises/narduk-shell']",
    )
  })
})

test.describe('foundations (finding 6)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`previews resolve each token through its own property (${scheme})`, async ({
      page,
    }, testInfo) => {
      await open(page, '/foundations')
      const preview = (token: string) =>
        page.locator(`[data-token="${token}"][data-scheme="${scheme}"] [data-preview]`)
      const style = (token: string, property: string) =>
        preview(token).evaluate(
          (element, name) => getComputedStyle(element).getPropertyValue(name),
          property,
        )

      expect(await style('--ns-r-lg', 'border-top-left-radius')).toBe('12px')
      expect(await style('--ns-e1', 'box-shadow')).toContain('inset')
      expect(await style('--ns-display-size', 'font-size')).toBe('52px')
      expect(await style('--ns-display-line', 'line-height')).not.toBe('normal')
      expect(await style('--ns-display-track', 'letter-spacing')).not.toBe('normal')
      expect(await style('--ns-space-4', 'width')).toBe('16px')
      expect(await style('--ns-font-mono', 'font-family')).toContain('IBM Plex Mono')
      await expect(
        page.locator(`[data-token="--ns-container"][data-scheme="${scheme}"] [data-preview]`),
      ).toHaveCount(0)

      // Every hex colour renders as exactly the value printed beside it.
      const colors = await page.locator(`[data-scheme="${scheme}"]`).evaluateAll((cells) =>
        cells.flatMap((cell) => {
          const swatch = cell.querySelector('[data-preview]')
          const value = cell.querySelector('code')?.textContent?.trim() ?? ''
          if (!swatch || !/^#[0-9a-f]{6}$/i.test(value)) return []
          return [{ value, background: getComputedStyle(swatch).backgroundColor }]
        }),
      )
      expect(colors.length).toBeGreaterThan(10)
      for (const { value, background } of colors) {
        const [r, g, b] = [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16))
        expect(background, value).toBe(`rgb(${r}, ${g}, ${b})`)
      }

      if (scheme === 'dark') {
        const inherited = (token: string) =>
          page.locator(`[data-token="${token}"][data-scheme="dark"] [data-inherited]`)
        // No dark declaration: the light value, said to be inherited.
        await expect(inherited('--ns-ink')).toBeVisible()
        // An explicit dark value, different or the same as light, is not inherited.
        await expect(inherited('--ne-surface')).toHaveCount(0)
        await expect(inherited('--ne-radius-base')).toHaveCount(0)
        expect(await style('--ne-surface', 'background-color')).toBe('rgb(20, 28, 34)')
      }
      await page.screenshot({
        path: testInfo.outputPath(`foundations-${scheme}.png`),
        fullPage: true,
      })
    })
  }
})

test.describe('provenance and access (finding 11)', () => {
  test('the footer names the revision this build was made from', async ({ page }) => {
    const expected =
      process.env.EXPLORER_SOURCE_COMMIT ??
      process.env.GITHUB_SHA ??
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    await open(page, '/')
    await expect(page.getByTestId('source-commit')).toHaveAttribute(
      'href',
      `https://github.com/narduk-enterprises/narduk-libs/commit/${expected}`,
    )
    await expect(page.getByTestId('source-commit')).toHaveText(expected.slice(0, 7))
  })

  test('the event log keeps the latest 20, newest first', async ({ page }) => {
    await open(page, '/components/ne-data-table')
    const loading = demoFrame(page).getByRole('switch', { name: 'Loading' })
    for (let click = 1; click <= 22; click += 1) {
      await loading.click()
      await expect(page.getByTestId('event-entry').first()).toContainText(`#${click} `)
    }
    await expect(page.getByTestId('event-entry')).toHaveCount(20)
    await expect(page.getByTestId('event-entry').last()).toContainText('#3 ')
  })

  test('navigation, presets, Reset and copy work from the keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the phone layout folds navigation behind Menu')
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            ;(window as unknown as { copied: string }).copied = text
            return Promise.resolve()
          },
        },
      })
    })
    await open(page, '/')
    await tabTo(
      page,
      page.getByRole('navigation', { name: 'Explorer' }).getByRole('link', { name: 'Data table' }),
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/components\/ne-data-table$/)

    await tabTo(page, page.getByTestId('viewport-phone'))
    await page.keyboard.press('Enter')
    await expectQuery(page, { width: 'phone' })

    await tabTo(page, page.getByTestId('copy-link'))
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('copy-link')).toHaveText('Copied')
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(
      page.url(),
    )

    await tabTo(page, page.getByTestId('demo-reset'))
    await page.keyboard.press('Enter')
    await expectQuery(page, {})

    await tabTo(page, page.getByTestId('copy-button').first())
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('copy-button').first()).toHaveAttribute('data-state', 'copied')
  })

  test('a refused clipboard says so instead of claiming success', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      })
    })
    await open(page, '/components/ne-data-table')
    await page.getByTestId('copy-link').click()
    await expect(page.getByTestId('copy-link')).toContainText('Copy failed')
    await page.getByTestId('copy-button').first().click()
    await expect(page.getByTestId('copy-button').first()).toHaveAttribute('data-state', 'failed')
    await expect(page.getByText('Copy failed', { exact: true }).first()).toBeVisible()
  })
})
