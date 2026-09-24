import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CHROMIUM_PROJECT_ALIAS,
  PR_PROJECT_NAME,
  QUARANTINE_GREP,
  QUARANTINE_PROJECT_NAME,
  QUARANTINE_TAG,
  WEB_PROJECT_NAME,
  assertPlaywrightQuarantineCollection,
  collectSpecsForProject,
  createNardukPlaywrightPreset,
  parsePlaywrightJsonList,
  parsePlaywrightListOutput,
  quarantineDetails,
  sourceDeclaresQuarantineTag,
  specMatchesProject,
  testSourceAtLine,
} from '../src/playwright/config.js'

const FLAKY = 'apps/web/tests/e2e/flaky.pr.spec.ts'
const HOME = 'apps/web/tests/e2e/home.pr.spec.ts'
const VISUAL = 'apps/web/tests/e2e/visual-audit.web.spec.ts'
const TAGGED_SOURCE = `import { test } from '@playwright/test'
import { quarantineDetails } from '@narduk-enterprises/narduk-testkit/playwright/config'

test('flaky checkout', quarantineDetails({ issue: 'app#12', date: '2026-09-24', owner: 'logan' }), async ({ page }) => {
  await page.goto('/')
})
`
const UNTAGGED_SOURCE = `import { test } from '@playwright/test'
test('home', async ({ page }) => {
  await page.goto('/')
})
`
const MIXED_SOURCE = `import { test } from '@playwright/test'
import { quarantineDetails } from '@narduk-enterprises/narduk-testkit/playwright/config'

test('home', async ({ page }) => {
  await page.goto('/')
})

test('flaky checkout', quarantineDetails({ issue: 'app#12', date: '2026-09-24', owner: 'logan' }), async ({ page }) => {
  await page.goto('/')
})
`

describe('quarantine tag helper (#520)', () => {
  it('refuses a quarantine with no issue', () => {
    expect(() => quarantineDetails({ issue: '', date: '2026-09-24', owner: 'logan' })).toThrow(
      /no issue is not a quarantine/,
    )
  })

  it('writes the issue -- date -- owner annotation and the @quarantine tag', () => {
    expect(quarantineDetails({ issue: 'buoys#211', date: '2026-09-18', owner: 'logan' })).toEqual({
      tag: QUARANTINE_TAG,
      annotation: [{ type: 'issue', description: 'buoys#211 -- 2026-09-18 -- logan' }],
    })
  })

  it('reads both title tokens and { tag: QUARANTINE_TAG } as declared', () => {
    expect(sourceDeclaresQuarantineTag(TAGGED_SOURCE)).toBe(true)
    expect(sourceDeclaresQuarantineTag("test('flaky @quarantine', async () => {})")).toBe(true)
    expect(
      sourceDeclaresQuarantineTag("test('home', { tag: '@quarantine' }, async () => {})"),
    ).toBe(true)
    expect(sourceDeclaresQuarantineTag(UNTAGGED_SOURCE)).toBe(false)
    expect(
      sourceDeclaresQuarantineTag(
        "test('home', async () => { expect('@quarantine').toBeDefined() })",
      ),
    ).toBe(false)
    expect(sourceDeclaresQuarantineTag("test('home', async () => { /* @quarantine */ })")).toBe(
      false,
    )
  })
})

describe('preset excludes quarantined specs from pr (#520)', () => {
  it('sets grepInvert on pr/web and grep on the quarantine project', () => {
    const preset = createNardukPlaywrightPreset({ assertSpecTiers: false })
    const pr = preset.projects.find((project) => project.name === PR_PROJECT_NAME)
    const web = preset.projects.find((project) => project.name === WEB_PROJECT_NAME)
    const quarantine = preset.projects.find((project) => project.name === QUARANTINE_PROJECT_NAME)

    expect(pr?.grepInvert).toEqual(QUARANTINE_GREP)
    expect(web?.grepInvert).toEqual(QUARANTINE_GREP)
    expect(quarantine?.grep).toEqual(QUARANTINE_GREP)
    expect(quarantine?.metadata?.e2eTier).toBe('quarantine')
    expect(quarantine?.metadata?.visualAuditViewports).toEqual(web?.metadata?.visualAuditViewports)
  })

  it('copies grepInvert onto the chromium alias of web', () => {
    const preset = createNardukPlaywrightPreset({
      assertSpecTiers: false,
      chromiumAlias: true,
    })
    const chromium = preset.projects.find((project) => project.name === CHROMIUM_PROJECT_ALIAS)
    expect(chromium?.grepInvert).toEqual(QUARANTINE_GREP)
  })

  it('keeps a tagged spec out of pr and in quarantine', () => {
    const files = [HOME, FLAKY, VISUAL]
    const quarantinedFiles = new Set([FLAKY])

    expect(specMatchesProject(FLAKY, PR_PROJECT_NAME, { quarantined: true })).toBe(false)
    expect(specMatchesProject(FLAKY, QUARANTINE_PROJECT_NAME, { quarantined: true })).toBe(true)
    expect(specMatchesProject(HOME, PR_PROJECT_NAME, { quarantined: false })).toBe(true)
    expect(specMatchesProject(HOME, QUARANTINE_PROJECT_NAME)).toBe(false)

    expect(collectSpecsForProject(files, PR_PROJECT_NAME, { quarantinedFiles })).toEqual([HOME])
    expect(collectSpecsForProject(files, QUARANTINE_PROJECT_NAME, { quarantinedFiles })).toEqual([
      FLAKY,
    ])
    expect(collectSpecsForProject(files, WEB_PROJECT_NAME, { quarantinedFiles })).toEqual([VISUAL])
  })
})

describe('Playwright-collection guard (#520)', () => {
  it('parses playwright test --list lines', () => {
    const listed = [
      'Listing tests:',
      `  [pr] › ${HOME}:3:1 › home`,
      `  [quarantine] › ${FLAKY}:5:1 › flaky checkout @quarantine`,
      'Total: 2 tests in 2 files',
    ].join('\n')

    expect(parsePlaywrightListOutput(listed)).toEqual([
      { file: HOME, project: 'pr', title: 'home', line: 3, column: 1 },
      {
        file: FLAKY,
        project: 'quarantine',
        title: 'flaky checkout @quarantine',
        tags: ['@quarantine'],
        line: 5,
        column: 1,
      },
    ])
  })

  it('fills tags and line from Playwright JSON list output', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              file: FLAKY,
              title: 'flaky checkout',
              tags: ['@quarantine'],
              line: 8,
              column: 1,
              tests: [{ projectName: 'quarantine' }],
            },
            {
              file: HOME,
              title: 'home',
              tags: [],
              line: 4,
              column: 1,
              tests: [{ projectName: 'pr' }],
            },
          ],
        },
      ],
    }

    expect(parsePlaywrightJsonList(report)).toEqual([
      {
        file: FLAKY,
        project: 'quarantine',
        title: 'flaky checkout',
        tags: ['@quarantine'],
        line: 8,
        column: 1,
      },
      { file: HOME, project: 'pr', title: 'home', line: 4, column: 1 },
    ])
    expect(parsePlaywrightListOutput(JSON.stringify(report))).toEqual(
      parsePlaywrightJsonList(report),
    )
  })

  it('accepts a tagged file in quarantine and an untagged file in pr', () => {
    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [
          { file: HOME, project: 'pr', title: 'home' },
          { file: FLAKY, project: 'quarantine', title: 'flaky checkout @quarantine' },
        ],
      }),
    ).not.toThrow()
  })

  it('fails when an untagged file is collected by quarantine', () => {
    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [{ file: HOME, project: 'quarantine', title: 'home' }],
      }),
    ).toThrow(/Untagged test collected by the quarantine project/)
  })

  it('fails when a tagged test is collected by pr', () => {
    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [{ file: FLAKY, project: 'pr', title: 'flaky checkout @quarantine' }],
      }),
    ).toThrow(/Wrongly tagged test collected by a PR\/web project/)
  })

  it('uses the listed test source when --list does not repeat the tag in the title', () => {
    const taggedLine = lineOf(TAGGED_SOURCE, "test('flaky checkout'")
    const untaggedLine = lineOf(UNTAGGED_SOURCE, "test('home'")
    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [{ file: FLAKY, project: 'pr', title: 'flaky checkout', line: taggedLine }],
        sources: { [FLAKY]: TAGGED_SOURCE },
      }),
    ).toThrow(/Wrongly tagged test collected/)

    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [{ file: HOME, project: 'quarantine', title: 'home', line: untaggedLine }],
        sources: { [HOME]: UNTAGGED_SOURCE },
      }),
    ).toThrow(/Untagged test collected/)

    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [
          { file: FLAKY, project: 'quarantine', title: 'flaky checkout', line: taggedLine },
        ],
        sources: { [FLAKY]: TAGGED_SOURCE },
      }),
    ).not.toThrow()
  })

  it('does not treat a sibling as quarantined when only one test in the file is tagged', () => {
    const homeLine = lineOf(MIXED_SOURCE, "test('home'")
    const flakyLine = lineOf(MIXED_SOURCE, "test('flaky checkout'")
    expect(testSourceAtLine(MIXED_SOURCE, homeLine)).toContain("test('home'")
    expect(testSourceAtLine(MIXED_SOURCE, homeLine)).not.toContain('quarantineDetails')
    expect(testSourceAtLine(MIXED_SOURCE, flakyLine)).toContain('quarantineDetails')

    expect(() =>
      assertPlaywrightQuarantineCollection({
        collected: [
          { file: HOME, project: 'pr', title: 'home', line: homeLine },
          { file: HOME, project: 'quarantine', title: 'flaky checkout', line: flakyLine },
        ],
        sources: { [HOME]: MIXED_SOURCE },
      }),
    ).not.toThrow()
  })
})

function lineOf(source: string, snippet: string): number {
  const index = source.indexOf(snippet)
  return source.slice(0, index).split('\n').length
}

describe('quarantine documentation (#520)', () => {
  it('documents the tag, the PR exclusion, and the collection guard', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toContain(QUARANTINE_TAG)
    expect(readme).toContain('grepInvert')
    expect(readme).toContain('assertPlaywrightQuarantineCollection')
    expect(readme).toContain('playwright test --list')
    expect(readme).toContain('parsePlaywrightListOutput')
    expect(readme).toContain('quarantineDetails')
    expect(readme).toContain('readSource')
    expect(readme).toContain("readFileSync(file, 'utf8')")
    expect(readme).toContain('test.describe(..., quarantineDetails')
  })
})
