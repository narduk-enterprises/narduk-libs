import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CHROMIUM_PROJECT_ALIAS,
  DEFAULT_PR_VIEWPORT_NAMES,
  ESTATE_VIEWPORTS,
  NARDUK_PLAYWRIGHT_FULLY_PARALLEL,
  NARDUK_PLAYWRIGHT_WORKERS,
  PR_PROJECT_NAME,
  SETUP_PROJECT_NAME,
  WEB_PROJECT_NAME,
  assertE2eSpecTiers,
  classifyE2eFile,
  collectSpecsForProject,
  createNardukPlaywrightPreset,
  listE2eFiles,
  projectNameFromArgv,
  specMatchesProject,
  viewportsAtCollection,
} from '../src/playwright/config.js'

const scratchDirs: string[] = []

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function specDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-e2e-tiers-'))
  scratchDirs.push(dir)
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(dir, relative)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents, 'utf8')
  }
  return dir
}

const ALL_SPECS = [
  'apps/web/tests/e2e/global.setup.ts',
  'apps/web/tests/e2e/home.pr.spec.ts',
  'apps/web/tests/e2e/visual-audit.web.spec.ts',
  'apps/web/tests/e2e/headers.pr-web.spec.ts',
  'apps/web/tests/e2e/orphan.spec.ts',
]

describe('classifyE2eFile (#434)', () => {
  it('reads the tier from the filename', () => {
    expect(classifyE2eFile('apps/web/tests/e2e/global.setup.ts')).toBe('setup')
    expect(classifyE2eFile('home.pr.spec.ts')).toBe('pr')
    expect(classifyE2eFile('visual-audit.web.spec.ts')).toBe('web')
    expect(classifyE2eFile('headers.pr-web.spec.ts')).toBe('pr-web')
    expect(classifyE2eFile('orphan.spec.ts')).toBe('undeclared')
    expect(classifyE2eFile('playwright.config.ts')).toBeUndefined()
  })
})

describe('spec collection (#434)', () => {
  it('fails undeclared specs — they are how 10 became 36', () => {
    expect(() => assertE2eSpecTiers(ALL_SPECS)).toThrow(/orphan\.spec\.ts/)
    expect(() => assertE2eSpecTiers(ALL_SPECS)).toThrow(/undeclared spec is collected by every/)
  })

  it('accepts an explicit dual-declaration and rejects implicit dual-attach', () => {
    expect(() =>
      assertE2eSpecTiers([
        'home.pr.spec.ts',
        'visual-audit.web.spec.ts',
        'headers.pr-web.spec.ts',
        'global.setup.ts',
      ]),
    ).not.toThrow()

    expect(specMatchesProject('headers.pr-web.spec.ts', 'pr')).toBe(true)
    expect(specMatchesProject('headers.pr-web.spec.ts', 'web')).toBe(true)
    expect(specMatchesProject('orphan.spec.ts', 'pr')).toBe(false)
    expect(specMatchesProject('orphan.spec.ts', 'web')).toBe(false)
  })

  it('keeps a pr-only spec out of a --project=web list', () => {
    const web = collectSpecsForProject(ALL_SPECS, WEB_PROJECT_NAME)
    const pr = collectSpecsForProject(ALL_SPECS, PR_PROJECT_NAME)

    expect(pr).toEqual([
      'apps/web/tests/e2e/home.pr.spec.ts',
      'apps/web/tests/e2e/headers.pr-web.spec.ts',
    ])
    expect(web).toEqual([
      'apps/web/tests/e2e/visual-audit.web.spec.ts',
      'apps/web/tests/e2e/headers.pr-web.spec.ts',
    ])
    expect(web.join('\n')).not.toContain('home.pr.spec.ts')
    expect(collectSpecsForProject(ALL_SPECS, SETUP_PROJECT_NAME)).toEqual([
      'apps/web/tests/e2e/global.setup.ts',
    ])
  })
})

describe('viewportsAtCollection (#434)', () => {
  it('a pr run does not instantiate page for a viewport pr metadata excludes', () => {
    const pageConstructions: string[] = []
    const preset = createNardukPlaywrightPreset({
      assertSpecTiers: false,
    })
    const pr = preset.projects.find((project) => project.name === PR_PROJECT_NAME)
    expect(pr?.metadata?.visualAuditViewports).toEqual([...DEFAULT_PR_VIEWPORT_NAMES])

    const collected = viewportsAtCollection(ESTATE_VIEWPORTS, pr!)
    const tests: Array<{ run: () => void; title: string }> = []
    for (const viewport of collected) {
      tests.push({
        title: `a11y ${viewport.name}`,
        run: () => {
          pageConstructions.push(viewport.name)
        },
      })
    }

    expect(tests.map((entry) => entry.title)).toEqual(['a11y desktop', 'a11y mobile'])
    for (const entry of tests) entry.run()
    expect(pageConstructions).toEqual(['desktop', 'mobile'])
    expect(pageConstructions).not.toContain('tablet')
    expect(pageConstructions).not.toContain('wide')
  })

  it('honors custom prViewports from the preset project, not { name: pr }', () => {
    const preset = createNardukPlaywrightPreset({
      assertSpecTiers: false,
      prViewports: ['desktop'],
    })
    const prProject = preset.projects.find((project) => project.name === PR_PROJECT_NAME)

    expect(
      viewportsAtCollection(ESTATE_VIEWPORTS, { name: 'pr' }).map((viewport) => viewport.name),
    ).toEqual(['desktop', 'mobile'])
    expect(
      viewportsAtCollection(ESTATE_VIEWPORTS, prProject!).map((viewport) => viewport.name),
    ).toEqual(['desktop'])
  })

  it('reads a lone --project from argv', () => {
    expect(projectNameFromArgv(['node', 'playwright', 'test', '--project', 'pr'])).toBe('pr')
    expect(projectNameFromArgv(['node', 'playwright', 'test', '--project=web'])).toBe('web')
    expect(
      projectNameFromArgv(['node', 'playwright', 'test', '--project', 'pr', '--project', 'web']),
    ).toBe(undefined)
  })
})

describe('createNardukPlaywrightPreset (#434)', () => {
  it('exports setup, pr, web, fullyParallel true, and workers 2', () => {
    const preset = createNardukPlaywrightPreset({
      assertSpecTiers: false,
      baseURL: 'http://127.0.0.1:51952',
      browserUse: { browserName: 'chromium', channel: 'chrome' },
    })

    expect(preset.fullyParallel).toBe(NARDUK_PLAYWRIGHT_FULLY_PARALLEL)
    expect(preset.fullyParallel).toBe(true)
    expect(preset.workers).toBe(NARDUK_PLAYWRIGHT_WORKERS)
    expect(preset.workers).toBe(2)
    expect(preset.use).toEqual({ baseURL: 'http://127.0.0.1:51952' })
    expect(preset.projects.map((project) => project.name)).toEqual([
      SETUP_PROJECT_NAME,
      PR_PROJECT_NAME,
      WEB_PROJECT_NAME,
      'quarantine',
    ])
    expect(JSON.stringify(preset)).not.toContain('3000')
    expect(preset.projects[1]?.dependencies).toEqual([SETUP_PROJECT_NAME])
    expect(preset.projects[1]?.use).toEqual({ browserName: 'chromium', channel: 'chrome' })
  })

  it('omits the chromium alias unless opted in, so a bare run does not double web', () => {
    const preset = createNardukPlaywrightPreset({ assertSpecTiers: false })
    expect(preset.projects.map((project) => project.name)).toEqual([
      SETUP_PROJECT_NAME,
      PR_PROJECT_NAME,
      WEB_PROJECT_NAME,
      'quarantine',
    ])
    expect(preset.projects.some((project) => project.name === CHROMIUM_PROJECT_ALIAS)).toBe(false)
  })

  it('registers chromium as an opt-in alias of web', () => {
    const preset = createNardukPlaywrightPreset({
      assertSpecTiers: false,
      chromiumAlias: true,
    })
    const chromium = preset.projects.find((project) => project.name === CHROMIUM_PROJECT_ALIAS)
    const web = preset.projects.find((project) => project.name === WEB_PROJECT_NAME)
    expect(chromium?.testMatch).toEqual(web?.testMatch)
    expect(chromium?.metadata?.e2eTier).toBe('web')
    expect(specMatchesProject('visual-audit.web.spec.ts', CHROMIUM_PROJECT_ALIAS)).toBe(true)
    expect(specMatchesProject('home.pr.spec.ts', CHROMIUM_PROJECT_ALIAS)).toBe(false)
  })

  it('fails the config load when testDir still has an undeclared spec', () => {
    const dir = specDir({
      'global.setup.ts': 'export {}',
      'home.pr.spec.ts': 'export {}',
      'leaked.spec.ts': 'export {}',
    })

    expect(() => createNardukPlaywrightPreset({ testDir: dir })).toThrow(/leaked\.spec\.ts/)
    expect(listE2eFiles(dir).some((file) => file.endsWith('leaked.spec.ts'))).toBe(true)
    expect(() =>
      createNardukPlaywrightPreset({
        testDir: dir,
        specFiles: listE2eFiles(dir).filter((file) => !file.endsWith('leaked.spec.ts')),
      }),
    ).toThrow(/leaked\.spec\.ts/)
    expect(() =>
      createNardukPlaywrightPreset({
        specFiles: listE2eFiles(dir).filter((file) => !file.endsWith('leaked.spec.ts')),
      }),
    ).not.toThrow()
  })
})

describe('preset documentation (#434)', () => {
  it('documents the serial escape and the measured workers: 2 default', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toContain("test.describe.configure({ mode: 'serial' })")
    expect(readme).toContain('workers: 2')
    expect(readme).toContain('e2e-parallel-config')
    expect(readme).toContain('e2e-shards')
    expect(readme).toContain("preset.projects.find((project) => project.name === 'pr')")
    expect(readme).toContain('chromiumAlias: true')
    expect(readme).not.toContain("viewportsAtCollection(ALL_VIEWPORTS, { name: 'pr' })")
  })
})
