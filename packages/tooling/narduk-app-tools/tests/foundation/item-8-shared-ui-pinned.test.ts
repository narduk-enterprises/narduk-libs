import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runSharedUiPinnedCheck } from '../../src/foundation/evaluate-shared-ui-pinned.js'
import { evaluateItem8 } from '../../src/foundation/items/item-8-shared-ui-pinned.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { FoundationStatus, FoundationSubCheck } from '../../src/foundation/types.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

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

describe('item 8 -- shared-ui-pinned', () => {
  it('8.0 is unknown when no package.json is readable at a known path', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.0', checks)).toBe('unknown')
    expect(checks).toHaveLength(1)
  })

  it('8.0 is not-applicable for an API-only app (no nuxt.config, no pages/components)', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'api-only',
      dependencies: { '@narduk-enterprises/narduk-core': '3.4.1' },
    })
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.0', checks)).toBe('not-applicable')
    expect(checks).toHaveLength(1)
  })

  it('is not-applicable when a nuxt dependency is the only signal (no nuxt.config, no pages/components)', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: { nuxt: '4.1.0' } })
    expect(statusOf('8.0', evaluateItem8(new AppRepo(root)))).toBe('not-applicable')
  })

  it('is not-applicable for Nuxt without pages/components (API-only Nuxt)', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})')
    expect(statusOf('8.0', evaluateItem8(new AppRepo(root)))).toBe('not-applicable')
  })

  it('is not-applicable for pages/components without a nuxt.config at a known path', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'not-nuxt', dependencies: {} })
    writeFile(root, 'app/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.0', evaluateItem8(new AppRepo(root)))).toBe('not-applicable')
  })

  it('is not-applicable when nuxt.config lives at a non-candidate path', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    writeFile(root, 'config/nuxt.config.ts', 'export default {}')
    writeFile(root, 'app/pages/index.vue', '<template>home</template>')
    expect(statusOf('8.0', evaluateItem8(new AppRepo(root)))).toBe('not-applicable')
  })

  it('passes a UI app that pins every present shared-UI package exactly', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, {
      '@narduk-enterprises/narduk-shell': '1.0.0',
      '@narduk-enterprises/narduk-ui': '2.3.4',
      '@narduk-enterprises/narduk-charts': '1.2.0',
    })
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.0', checks)).toBe('pass')
    expect(statusOf('8.1', checks)).toBe('pass')
    expect(statusOf('8.2', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('pass')
  })

  it('passes a UI app with none of the three packages -- presence is not required', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root)
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.0', checks)).toBe('pass')
    expect(statusOf('8.1', checks)).toBe('not-applicable')
    expect(statusOf('8.2', checks)).toBe('not-applicable')
    expect(statusOf('8.3', checks)).toBe('not-applicable')
  })

  it('treats a missing narduk-shell the same as a missing narduk-ui or narduk-charts', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { '@narduk-enterprises/narduk-ui': '2.3.4' })
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.1', checks)).toBe('not-applicable')
    expect(statusOf('8.2', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('not-applicable')
  })

  it.each([
    { id: '8.1' as const, pkg: '@narduk-enterprises/narduk-shell' },
    { id: '8.2' as const, pkg: '@narduk-enterprises/narduk-ui' },
    { id: '8.3' as const, pkg: '@narduk-enterprises/narduk-charts' },
  ])('$id fails a ^/~/workspace: range on $pkg, naming the package and the fix', ({ id, pkg }) => {
    const root = makeTempRepo()
    tempDirs.push(root)

    writeUiApp(root, { [pkg]: '^2.3.4' })
    let checks = evaluateItem8(new AppRepo(root))
    expect(statusOf(id, checks)).toBe('fail')
    expect(detailOf(id, checks)).toContain(pkg)
    expect(detailOf(id, checks)).toContain('pin it to an exact version')
    expect(detailOf(id, checks)).toContain('^2.3.4')

    writeUiApp(root, { [pkg]: '~2.3.4' })
    checks = evaluateItem8(new AppRepo(root))
    expect(statusOf(id, checks)).toBe('fail')
    expect(detailOf(id, checks)).toContain(pkg)
    expect(detailOf(id, checks)).toContain('~2.3.4')

    writeUiApp(root, { [pkg]: 'workspace:*' })
    checks = evaluateItem8(new AppRepo(root))
    expect(statusOf(id, checks)).toBe('fail')
    expect(detailOf(id, checks)).toContain(pkg)
    expect(detailOf(id, checks)).toContain('workspace:*')
  })

  it('accepts an exact pin, including a prerelease, and rejects incomplete or tagged specs', () => {
    const root = makeTempRepo()
    tempDirs.push(root)

    writeUiApp(root, { '@narduk-enterprises/narduk-ui': '2.3.4' })
    expect(statusOf('8.2', evaluateItem8(new AppRepo(root)))).toBe('pass')

    writeUiApp(root, { '@narduk-enterprises/narduk-ui': '2.3.4-alpha.1' })
    expect(statusOf('8.2', evaluateItem8(new AppRepo(root)))).toBe('pass')

    writeUiApp(root, { '@narduk-enterprises/narduk-ui': '2.3' })
    expect(statusOf('8.2', evaluateItem8(new AppRepo(root)))).toBe('fail')

    writeUiApp(root, { '@narduk-enterprises/narduk-ui': 'latest' })
    expect(statusOf('8.2', evaluateItem8(new AppRepo(root)))).toBe('fail')
  })

  it('"has UI" is also signalled by the generated-app apps/web/ layout', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(
      root,
      { '@narduk-enterprises/narduk-charts': '1.2.0' },
      { nuxtConfig: 'apps/web/nuxt.config.ts', pagesDir: 'apps/web/app/pages' },
    )
    const checks = evaluateItem8(new AppRepo(root))
    expect(statusOf('8.0', checks)).toBe('pass')
    expect(statusOf('8.3', checks)).toBe('pass')
  })
})

describe('item 8 -- shared-ui-pinned artefact runner', () => {
  function run(root: string) {
    return runSharedUiPinnedCheck({
      root,
      toolVersion: '0.0.0-test',
      appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
    })
  }

  it('rolls a fully exact-pinned UI app up to PASS / exit 0', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, {
      '@narduk-enterprises/narduk-shell': '1.0.0',
      '@narduk-enterprises/narduk-ui': '2.3.4',
      '@narduk-enterprises/narduk-charts': '1.2.0',
    })
    const artefact = run(root)
    expect(artefact.item.id).toBe(8)
    expect(artefact.item.name).toBe('shared-ui-pinned')
    expect(artefact.item.status).toBe('pass')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.tool).toBe('@narduk-enterprises/narduk-app-tools/shared-ui-pinned')
  })

  it('rolls an API-only app up to not-applicable / PASS / exit 0', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    const artefact = run(root)
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('rolls a present-but-loose pin up to FAIL / exit 1', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeUiApp(root, { '@narduk-enterprises/narduk-ui': '^2.3.4' })
    const artefact = run(root)
    expect(artefact.item.status).toBe('fail')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
  })

  it('rolls a missing package.json up to UNKNOWN / exit 2', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const artefact = run(root)
    expect(artefact.item.status).toBe('unknown')
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
  })
})
