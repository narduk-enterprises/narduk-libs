import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runSharedUiPinnedCheck } from '../../src/foundation/evaluate-shared-ui-pinned.js'
import {
  evaluateItem8,
  PRESENCE_REQUIRED,
  SHARED_UI_PACKAGES,
} from '../../src/foundation/items/item-8-shared-ui-pinned.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { RegistryPublication, RegistryReality } from '../../src/foundation/npm-registry.js'
import type { FoundationStatus, FoundationSubCheck } from '../../src/foundation/types.js'
import { fakeReality, makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const SHELL = '@narduk-enterprises/narduk-shell'
const UI = '@narduk-enterprises/narduk-ui'
const CHARTS = '@narduk-enterprises/narduk-charts'

/** The estate as it stands: shell unpublished, ui and charts published. */
const TODAY: Record<string, RegistryPublication> = {
  [SHELL]: { status: 'unpublished' },
  [UI]: { status: 'published', latest: '0.1.2', major: 0 },
  [CHARTS]: { status: 'published', latest: '2.5.1', major: 2 },
}

const ALL_PUBLISHED: Record<string, RegistryPublication> = {
  [SHELL]: { status: 'published', latest: '1.0.0', major: 1 },
  [UI]: { status: 'published', latest: '2.3.4', major: 2 },
  [CHARTS]: { status: 'published', latest: '1.2.0', major: 1 },
}

const ALL_UNREADABLE: Record<string, RegistryPublication> = {
  [SHELL]: { status: 'unreadable' },
  [UI]: { status: 'unreadable' },
  [CHARTS]: { status: 'unreadable' },
}

function reality(publications: Record<string, RegistryPublication> = TODAY) {
  return fakeReality({ publications })
}

/** A reality whose every registry read throws -- the item must still decide. */
const THROWING_REALITY: RegistryReality = {
  resolveInstalled() {
    return null
  },
  publicationOf() {
    return Promise.reject(new Error('registry exploded'))
  },
  latestPublishedMajor() {
    return Promise.reject(new Error('registry exploded'))
  },
}

async function evaluate(
  root: string,
  publications: Record<string, RegistryPublication> = TODAY,
): Promise<FoundationSubCheck[]> {
  return evaluateItem8(new AppRepo(root), reality(publications))
}

function statusOf(id: string, checks: FoundationSubCheck[]): FoundationStatus {
  const found = checks.find((c) => c.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.status
}

function detailOf(id: string, checks: FoundationSubCheck[]): string {
  const found = checks.find((c) => c.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.detail
}

function writeUiApp(
  root: string,
  deps: Record<string, string> = {},
  options: { nuxtConfig?: string; pagesDir?: string } = {},
): void {
  writeJson(root, 'package.json', { name: 'ui-app', dependencies: deps })
  writeFile(root, options.nuxtConfig ?? 'nuxt.config.ts', 'export default defineNuxtConfig({})')
  writeFile(root, `${options.pagesDir ?? 'app/pages'}/index.vue`, '<template>home</template>')
}

describe('item 8 -- the presence set', () => {
  // narduk-libs#282 review, task 1: an earlier revision derived presence from
  // publication -- narduk-charts is published, therefore every UI app must
  // depend on it. That made a charting library mandatory on apps that draw no
  // charts. The set is empty because no estate decision names a shared-UI
  // package as required of EVERY UI app; adding one is a policy change that
  // must cite a dated company-hq decision, and this test is what stops it
  // arriving as an unannounced default.
  it('is empty -- no shared-UI package is required of every UI app today', () => {
    expect(PRESENCE_REQUIRED).toEqual([])
  })

  it('covers narduk-shell, narduk-ui and narduk-charts as sub-checks 8.1-8.3', () => {
    expect(SHARED_UI_PACKAGES.map((entry) => [entry.id, entry.pkg])).toEqual([
      ['8.1', SHELL],
      ['8.2', UI],
      ['8.3', CHARTS],
    ])
  })
})

describe('item 8 -- shared-ui-pinned', () => {
  it('8.0 is unknown when no package.json is readable at a known path', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const checks = await evaluate(root)
    expect(statusOf('8.0', checks)).toBe('unknown')
    expect(checks).toHaveLength(1)
  })

  it('8.0 is not-applicable for an API-only app (no nuxt.config, no pages/components)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'api-only',
      dependencies: { '@narduk-enterprises/narduk-core': '3.4.1' },
    })
    const checks = await evaluate(root)
    expect(statusOf('8.0', checks)).toBe('not-applicable')
    expect(checks).toHaveLength(1)
  })

  it('is not-applicable when a nuxt dependency is the only signal (no nuxt.config, no pages/components)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: { nuxt: '4.1.0' } })
    expect(statusOf('8.0', await evaluate(root))).toBe('not-applicable')
  })

  it('is not-applicable for Nuxt without pages/components (API-only Nuxt)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})')
    expect(statusOf('8.0', await evaluate(root))).toBe('not-applicable')
  })

  it('is not-applicable for pages/components without a nuxt.config at a known path', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'not-nuxt', dependencies: {} })
    writeFile(root, 'app/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.0', await evaluate(root))).toBe('not-applicable')
  })

  it('is not-applicable when nuxt.config lives at a non-candidate path', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    writeFile(root, 'config/nuxt.config.ts', 'export default {}')
    writeFile(root, 'app/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.0', await evaluate(root))).toBe('not-applicable')
  })

  it('passes a UI app that pins the shared-UI packages it uses exactly', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [UI]: '0.1.2', [CHARTS]: '2.5.1' })
    const checks = await evaluate(root)
    expect(statusOf('8.0', checks)).toBe('pass')
    expect(statusOf('8.1', checks)).toBe('not-applicable')
    expect(statusOf('8.2', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('pass')
  })

  // The #282 review finding: "published" is not "required". narduk-charts is
  // published, but a UI app that draws no charts must not be told to add it.
  it.each([
    { id: '8.1' as const, pkg: SHELL },
    { id: '8.2' as const, pkg: UI },
    { id: '8.3' as const, pkg: CHARTS },
  ])('$id is not-applicable when a published $pkg is simply not used', async ({ id, pkg }) => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root)
    const checks = await evaluate(root, ALL_PUBLISHED)
    expect(statusOf(id, checks)).toBe('not-applicable')
    expect(detailOf(id, checks)).toContain(`${pkg} is not a dependency of this app`)
    expect(detailOf(id, checks)).toContain('capability-specific')
    expect(detailOf(id, checks)).not.toContain('add an exact pin')
  })

  it('a UI app that depends on none of the three has nothing failing', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root)
    const checks = await evaluate(root, ALL_PUBLISHED)
    expect(checks.filter((c) => c.status === 'fail')).toEqual([])
  })

  it.each([
    { id: '8.1' as const, pkg: SHELL },
    { id: '8.2' as const, pkg: UI },
    { id: '8.3' as const, pkg: CHARTS },
  ])(
    '$id fails a ^/~/workspace: range on $pkg, naming the package and the fix',
    async ({ id, pkg }) => {
      const root = makeTempRepo()
      tempDirs.push(root)
      const publications = {
        [pkg]: { status: 'published' as const, latest: '2.3.4', major: 2 },
      }

      writeUiApp(root, { [pkg]: '^2.3.4' })
      let checks = await evaluate(root, publications)
      expect(statusOf(id, checks)).toBe('fail')
      expect(detailOf(id, checks)).toContain(pkg)
      expect(detailOf(id, checks)).toContain('pin it to an exact version')
      expect(detailOf(id, checks)).toContain('^2.3.4')

      writeUiApp(root, { [pkg]: '~2.3.4' })
      checks = await evaluate(root, publications)
      expect(statusOf(id, checks)).toBe('fail')
      expect(detailOf(id, checks)).toContain('~2.3.4')

      writeUiApp(root, { [pkg]: 'workspace:*' })
      checks = await evaluate(root, publications)
      expect(statusOf(id, checks)).toBe('fail')
      expect(detailOf(id, checks)).toContain('workspace:*')
    },
  )

  it('fails a loose pin that lives in devDependencies too', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'ui-app', devDependencies: { [CHARTS]: '^2.5.1' } })
    writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})')
    writeFile(root, 'app/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.3', await evaluate(root))).toBe('fail')
  })

  it('accepts an exact pin, including a prerelease, and rejects incomplete or tagged specs', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const publications = { [UI]: { status: 'published' as const, latest: '2.3.4', major: 2 } }

    writeUiApp(root, { [UI]: '2.3.4' })
    expect(statusOf('8.2', await evaluate(root, publications))).toBe('pass')

    writeUiApp(root, { [UI]: '2.3.4-alpha.1' })
    expect(statusOf('8.2', await evaluate(root, publications))).toBe('pass')

    writeUiApp(root, { [UI]: '2.3' })
    expect(statusOf('8.2', await evaluate(root, publications))).toBe('fail')

    writeUiApp(root, { [UI]: 'latest' })
    expect(statusOf('8.2', await evaluate(root, publications))).toBe('fail')
  })

  it('"has UI" is also signalled by the generated-app apps/web/ layout', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(
      root,
      { [CHARTS]: '2.5.1' },
      { nuxtConfig: 'apps/web/nuxt.config.ts', pagesDir: 'apps/web/app/pages' },
    )
    const checks = await evaluate(root)
    expect(statusOf('8.0', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('pass')
  })

  it('"has UI" is signalled by the Nuxt-3 flat layout under apps/web/ and web/', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'flat-ui', dependencies: { [UI]: '0.1.2' } })
    writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})')
    writeFile(root, 'apps/web/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.0', await evaluate(root))).toBe('pass')
    expect(statusOf('8.2', await evaluate(root))).toBe('pass')

    const webRoot = makeTempRepo()
    tempDirs.push(webRoot)
    writeJson(webRoot, 'package.json', { name: 'flat-web', dependencies: { [UI]: '0.1.2' } })
    writeFile(webRoot, 'web/nuxt.config.ts', 'export default defineNuxtConfig({})')
    writeFile(webRoot, 'web/components/Chip.vue', '<template>chip</template>')
    expect(statusOf('8.0', await evaluate(webRoot))).toBe('pass')
  })
})

// narduk-libs#282 review, task 2. The generated CI scopes the GitHub Packages
// token to the install step, so the rest of the job has no ambient token. A
// check that went UNKNOWN without one exits 2 and could not be wired in.
describe('item 8 -- decides without a registry credential', () => {
  it('reaches the same verdicts with an entirely unreadable registry', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)

    writeUiApp(root, { [UI]: '0.1.2' })
    const good = await evaluate(root, ALL_UNREADABLE)
    expect(statusOf('8.2', good)).toBe('pass')
    expect(statusOf('8.3', good)).toBe('not-applicable')
    expect(good.some((c) => c.status === 'unknown')).toBe(false)

    writeUiApp(root, { [UI]: '^0.1.2' })
    expect(statusOf('8.2', await evaluate(root, ALL_UNREADABLE))).toBe('fail')
  })

  it('still decides when every registry read throws', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [UI]: '0.1.2', [CHARTS]: '^2.5.1' })
    const checks = await evaluateItem8(new AppRepo(root), THROWING_REALITY)
    expect(statusOf('8.2', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('fail')
    expect(checks.some((c) => c.status === 'unknown')).toBe(false)
  })

  it('annotates a passing pin with the latest published version only when readable', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [CHARTS]: '2.4.0' })
    expect(detailOf('8.3', await evaluate(root))).toBe(
      `${CHARTS} is an exact pin (2.4.0); latest published is 2.5.1`,
    )
    expect(detailOf('8.3', await evaluate(root, ALL_UNREADABLE))).toBe(
      `${CHARTS} is an exact pin (2.4.0)`,
    )
  })
})

describe('item 8 -- shared-ui-pinned artefact runner', () => {
  async function run(root: string, publications: Record<string, RegistryPublication> = TODAY) {
    return runSharedUiPinnedCheck({
      root,
      toolVersion: '0.0.0-test',
      reality: reality(publications),
      appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
    })
  }

  it('rolls a UI app with exact pins up to PASS / exit 0', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [UI]: '0.1.2', [CHARTS]: '2.5.1' })
    const artefact = await run(root)
    expect(artefact.item.id).toBe(8)
    expect(artefact.item.name).toBe('shared-ui-pinned')
    expect(artefact.item.status).toBe('pass')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.tool).toBe('@narduk-enterprises/narduk-app-tools/shared-ui-pinned')
  })

  it('rolls an API-only app up to not-applicable / PASS / exit 0', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    const artefact = await run(root)
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('rolls a UI app using no shared-UI package up to PASS / exit 0', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root)
    const artefact = await run(root, ALL_PUBLISHED)
    expect(artefact.item.status).toBe('pass')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('rolls a loose pin up to FAIL / exit 1', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [UI]: '^0.1.2', [CHARTS]: '2.5.1' })
    const artefact = await run(root)
    expect(artefact.item.status).toBe('fail')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
  })

  // The exit-2 trap the #282 review found: the generated workflow never
  // exports a registry token, so an UNKNOWN-on-no-credential check would fail
  // every generated app's CI on wiring day.
  it('an unreadable registry no longer produces UNKNOWN / exit 2', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { [UI]: '0.1.2', [CHARTS]: '2.5.1' })
    const artefact = await run(root, ALL_UNREADABLE)
    expect(artefact.item.status).toBe('pass')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('rolls a missing package.json up to UNKNOWN / exit 2 -- the only UNKNOWN left', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const artefact = await run(root)
    expect(artefact.item.status).toBe('unknown')
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
  })
})
