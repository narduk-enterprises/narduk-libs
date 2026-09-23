/**
 * The static shared-component list against the real component files in this
 * workspace (narduk-libs#260). A component added to, renamed in or removed
 * from an owner without the list following fails here, with the difference.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SHARED_COMPONENT_OWNERS,
  nuxtComponentName,
} from '../../../src/rules/utils/shared-components'

const PACKAGES = resolve(__dirname, '../../../..', '..')

function packageRoot(pkg: string): string {
  for (const group of ['design', 'modules']) {
    const candidate = join(PACKAGES, group, pkg)
    try {
      readdirSync(candidate)
      return candidate
    } catch {
      // Try the next group.
    }
  }
  throw new Error(`no workspace package ${pkg} under ${PACKAGES}`)
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => basename(file, '.vue'))
}

function reexportedVueNames(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/export \{ default as (\w+) \} from ['"][^'"]+\.vue['"]/g)].map(
    (match) => match[1] ?? '',
  )
}

/** What each owner really publishes, read the way it registers or exports. */
function realNames(pkg: string): string[] {
  const root = packageRoot(pkg)
  switch (pkg) {
    case 'narduk-shell': {
      const registry = readFileSync(join(root, 'src/registry.ts'), 'utf8')
      return [...registry.matchAll(/name: '(\w+)'/g)].map((match) => match[1] ?? '')
    }
    case 'narduk-core':
      return vueFiles(join(root, 'runtime/app/components'))
    case 'narduk-auth':
      return vueFiles(join(root, 'app/components'))
    case 'narduk-ui':
      return reexportedVueNames(join(root, 'instruments/index.ts'))
    case 'narduk-charts':
      return reexportedVueNames(join(root, 'src/index.ts'))
    default:
      throw new Error(`no reader for ${pkg}; add one when adding an owner`)
  }
}

describe('shared component list', () => {
  for (const owner of SHARED_COMPONENT_OWNERS) {
    it(`matches ${owner.pkg}'s real components`, () => {
      expect([...owner.names].sort()).toEqual(realNames(owner.pkg).sort())
    })

    it(`${owner.pkg} keeps its components under ${owner.sourceDir}`, () => {
      expect(readdirSync(join(packageRoot(owner.pkg), owner.sourceDir)).length).toBeGreaterThan(0)
    })
  }

  it('gives every name one owner', () => {
    const names = SHARED_COMPONENT_OWNERS.flatMap((owner) => owner.names)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('nuxtComponentName', () => {
  it.each([
    ['AppTabs.vue', 'AppTabs'],
    ['shared/AppTabs.vue', 'SharedAppTabs'],
    ['app/AppHeader.vue', 'AppHeader'],
    ['ne/StatePanel.vue', 'NeStatePanel'],
    ['orders/parts/Row.vue', 'OrdersPartsRow'],
    ['orders/index.vue', 'Orders'],
    ['base/base-button.vue', 'BaseButton'],
    ['HTMLParser.vue', 'HTMLParser'],
    ['charts/Chart2D.vue', 'ChartsChart2D'],
    ['ui/AB2.vue', 'UiAB2'],
  ])('%s registers as %s', (path, name) => {
    expect(nuxtComponentName(path)).toBe(name)
  })
})
