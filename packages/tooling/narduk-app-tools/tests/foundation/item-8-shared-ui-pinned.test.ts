import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runSharedUiPinnedCheck } from '../../src/foundation/evaluate-shared-ui-pinned.js'
import type { SharedUiPinnedArtefact } from '../../src/foundation/evaluate-shared-ui-pinned.js'
import type { FoundationStatus } from '../../src/foundation/types.js'
import { fakeReality, makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const SHELL_PUBLISHED = fakeReality({
  latestMajors: { '@narduk-enterprises/narduk-shell': 1 },
})
const SHELL_NOT_PUBLISHED = fakeReality()

async function run(root: string, reality = SHELL_NOT_PUBLISHED) {
  return runSharedUiPinnedCheck({
    root,
    toolVersion: '0.0.0-test',
    reality,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

function subStatus(artefact: SharedUiPinnedArtefact, id: string): FoundationStatus {
  const sub = artefact.item.checks.find((c) => c.id === id)
  if (!sub) throw new Error(`no sub-check ${id} in artefact`)
  return sub.status
}

describe('shared-ui-pinned (components-library-plan.md #2 item 6, narduk-libs#253)', () => {
  it('8.0 is unknown when no package.json is readable at a known path', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const artefact = await run(root)
    expect(subStatus(artefact, '8.0')).toBe('unknown')
    expect(artefact.item.status).toBe('unknown')
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
  })

  it('8.0 is not-applicable for an API-only app (no nuxt dependency, no nuxt.config.*)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'api-only',
      dependencies: { '@narduk-enterprises/narduk-core': '3.4.1' },
    })
    const artefact = await run(root)
    expect(subStatus(artefact, '8.0')).toBe('not-applicable')
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('is not-applicable for an API-only app even with an unrelated nuxt.config.js typo path', async () => {
    // Guards against a false "has UI" positive: only the exact
    // NUXT_CONFIG_CANDIDATES paths (and a real `nuxt` dependency) count.
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api-only', dependencies: {} })
    writeFile(root, 'config/nuxt.config.ts', 'export default {}')
    const artefact = await run(root)
    expect(artefact.item.status).toBe('not-applicable')
  })

  it('passes a fully exact-pinned UI app once narduk-shell is published', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: {
        nuxt: '4.1.0',
        '@narduk-enterprises/narduk-shell': '1.0.0',
        '@narduk-enterprises/narduk-ui': '2.3.4',
        '@narduk-enterprises/narduk-charts': '1.2.0',
      },
    })
    const artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('pass')
    expect(subStatus(artefact, '8.2')).toBe('pass')
    expect(subStatus(artefact, '8.3')).toBe('pass')
    expect(artefact.item.status).toBe('pass')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('passes a UI app with only narduk-shell (narduk-ui/narduk-charts are not required)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: { nuxt: '4.1.0', '@narduk-enterprises/narduk-shell': '1.0.0' },
    })
    const artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('pass')
    expect(subStatus(artefact, '8.2')).toBe('not-applicable')
    expect(subStatus(artefact, '8.3')).toBe('not-applicable')
    expect(artefact.item.status).toBe('pass')
  })

  it('8.2 fails a ^/~/workspace: range on narduk-ui, naming the package and the fix', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: {
        nuxt: '4.1.0',
        '@narduk-enterprises/narduk-shell': '1.0.0',
        '@narduk-enterprises/narduk-ui': '^2.3.4',
      },
    })
    let artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.2')).toBe('fail')
    let detail = artefact.item.checks.find((c) => c.id === '8.2')!.detail
    expect(detail).toContain('@narduk-enterprises/narduk-ui')
    expect(detail).toContain('pin it to an exact version')
    expect(artefact.item.status).toBe('fail')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)

    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: {
        nuxt: '4.1.0',
        '@narduk-enterprises/narduk-shell': '1.0.0',
        '@narduk-enterprises/narduk-ui': 'workspace:*',
      },
    })
    artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.2')).toBe('fail')
    detail = artefact.item.checks.find((c) => c.id === '8.2')!.detail
    expect(detail).toContain('@narduk-enterprises/narduk-ui')

    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: {
        nuxt: '4.1.0',
        '@narduk-enterprises/narduk-shell': '1.0.0',
        '@narduk-enterprises/narduk-ui': '~2.3.4',
      },
    })
    artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.2')).toBe('fail')
  })

  it('8.1 is unknown (not fail) while narduk-shell is not yet published, even if missing', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'ui-app', dependencies: { nuxt: '4.1.0' } })
    const artefact = await run(root, SHELL_NOT_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('unknown')
    expect(artefact.item.status).toBe('unknown')
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
  })

  it('8.1 fails a missing narduk-shell once it is published, passes once added as an exact pin', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'ui-app', dependencies: { nuxt: '4.1.0' } })
    let artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('fail')
    expect(artefact.item.checks.find((c) => c.id === '8.1')!.detail).toContain(
      '@narduk-enterprises/narduk-shell',
    )

    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: { nuxt: '4.1.0', '@narduk-enterprises/narduk-shell': '^1.0.0' },
    })
    artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('fail')

    writeJson(root, 'package.json', {
      name: 'ui-app',
      dependencies: { nuxt: '4.1.0', '@narduk-enterprises/narduk-shell': '1.0.0' },
    })
    artefact = await run(root, SHELL_PUBLISHED)
    expect(subStatus(artefact, '8.1')).toBe('pass')
  })

  it('"has UI" is also signalled by a bare nuxt.config.ts with no nuxt dependency listed', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'ui-app', dependencies: {} })
    writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})')
    const artefact = await run(root, SHELL_PUBLISHED)
    expect(artefact.item.status).not.toBe('not-applicable')
    expect(subStatus(artefact, '8.1')).toBe('fail')
  })
})
