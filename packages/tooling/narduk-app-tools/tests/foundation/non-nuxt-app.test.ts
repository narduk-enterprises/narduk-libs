import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import type { FoundationCheckArtefact, FoundationSubCheck } from '../../src/foundation/types.js'
import {
  CONFORMANT_REALITY,
  itemStatus,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeJson,
} from './helpers.js'

/**
 * narduk-libs#157: narduk-core, narduk-seo, narduk-analytics, narduk-auth and
 * narduk-uploads are Nuxt modules. In an app with no Nuxt (my-farm/web is React
 * + Vite) the checks that require them are not-applicable, with the reason --
 * never fail, and never pass (Logan, 2026-09-25: "Not-applicable
 * (Recommended)").
 */

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const FRAMEWORK_INDEPENDENT = {
  '@narduk-enterprises/narduk-testkit': '2.0.0',
  '@narduk-enterprises/narduk-app-tools': '0.1.3',
  '@narduk-enterprises/eslint-config': '2.0.0',
}

/** A React + Vite Worker: the conformant baseline with no nuxt.config, no
 * `nuxt` dependency, and none of the Nuxt-module packages. */
function writeNonNuxtApp(root: string, deps: Record<string, string> = FRAMEWORK_INDEPENDENT): void {
  writeConformantBaseline(root)
  rmSync(join(root, 'nuxt.config.ts'), { force: true })
  writeJson(root, 'package.json', {
    name: 'fixture-app',
    scripts: { 'manifests:validate': 'true' },
    dependencies: { ...deps, react: '19.1.0' },
    devDependencies: { vite: '7.1.0' },
  })
}

async function run(root: string): Promise<FoundationCheckArtefact> {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality: CONFORMANT_REALITY,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

function subCheck(artefact: FoundationCheckArtefact, subId: string): FoundationSubCheck {
  for (const item of artefact.items) {
    const sub = item.checks.find((c) => c.id === subId)
    if (sub) return sub
  }
  throw new Error(`no sub-check ${subId} in artefact`)
}

async function fixture(write: (root: string) => void): Promise<FoundationCheckArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return run(root)
}

describe('a non-Nuxt app (narduk-libs#157)', () => {
  it('passes 2.1 on the three framework-independent packages, without narduk-core', async () => {
    const artefact = await fixture((root) => writeNonNuxtApp(root))

    const sub = subCheck(artefact, '2.1')
    expect(sub.status).toBe('pass')
    expect(sub.name).toContain('non-Nuxt app')
    expect(sub.name).not.toContain('narduk-core')
  })

  it('still fails 2.1 when a framework-independent package is missing', async () => {
    const artefact = await fixture((root) =>
      writeNonNuxtApp(root, {
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/eslint-config': '2.0.0',
      }),
    )

    const sub = subCheck(artefact, '2.1')
    expect(sub.status).toBe('fail')
    expect(sub.detail).toContain('@narduk-enterprises/narduk-app-tools')
    expect(sub.detail).not.toContain('narduk-core')
  })

  it.each(['2.1c', '2.3', '3.1', '3.2', '3.3'])(
    'reports %s as not-applicable with the reason, never pass',
    async (subId) => {
      const artefact = await fixture((root) => writeNonNuxtApp(root))

      const sub = subCheck(artefact, subId)
      expect(sub.status).toBe('not-applicable')
      expect(sub.detail).toContain('not a Nuxt app')
      expect(sub.detail).toContain('no nuxt.config.* at a known path and no nuxt dependency')
    },
  )

  it('names each Nuxt module in its reason, in the right number', async () => {
    const artefact = await fixture((root) => writeNonNuxtApp(root))

    expect(subCheck(artefact, '2.1c').detail).toContain('narduk-core is a Nuxt module')
    expect(subCheck(artefact, '3.1').detail).toContain(
      'narduk-seo and narduk-analytics are Nuxt modules',
    )
    expect(subCheck(artefact, '3.2').detail).toContain('narduk-auth is a Nuxt module')
    expect(subCheck(artefact, '3.3').detail).toContain('narduk-uploads is a Nuxt module')
  })

  it('leaves items 2 and 3 passing overall, rather than failing on the Nuxt modules', async () => {
    const artefact = await fixture((root) => writeNonNuxtApp(root))

    expect(itemStatus(artefact, 2)).toBe('pass')
    expect(itemStatus(artefact, 3)).not.toBe('fail')
  })

  it('still runs 2.3 when a non-Nuxt app depends on narduk-core anyway', async () => {
    const artefact = await fixture((root) =>
      writeNonNuxtApp(root, {
        ...FRAMEWORK_INDEPENDENT,
        '@narduk-enterprises/narduk-core': '3.4.1',
      }),
    )

    expect(subCheckStatus(artefact, '2.3')).toBe('pass')
  })
})

describe('a Nuxt app is still held to narduk-core (narduk-libs#157)', () => {
  it('requires narduk-core when only a nuxt dependency marks it as Nuxt', async () => {
    const artefact = await fixture((root) =>
      writeNonNuxtApp(root, { ...FRAMEWORK_INDEPENDENT, nuxt: '4.1.2' }),
    )

    const sub = subCheck(artefact, '2.1')
    expect(sub.status).toBe('fail')
    expect(sub.detail).toContain('@narduk-enterprises/narduk-core')
    expect(artefact.items.flatMap((item) => item.checks).map((c) => c.id)).not.toContain('2.1c')
  })

  it('requires narduk-core when a nuxt.config exists without a nuxt dependency', async () => {
    const artefact = await fixture((root) => {
      writeConformantBaseline(root)
      writeJson(root, 'package.json', {
        name: 'fixture-app',
        scripts: { 'manifests:validate': 'true' },
        dependencies: FRAMEWORK_INDEPENDENT,
      })
    })

    expect(subCheckStatus(artefact, '2.1')).toBe('fail')
    expect(subCheckStatus(artefact, '3.1')).toBe('fail')
  })
})
