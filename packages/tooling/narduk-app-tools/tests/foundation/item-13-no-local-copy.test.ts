import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  SHARED_COMPONENT_OWNERS as LINT_OWNERS,
  nuxtComponentName as lintNuxtComponentName,
} from '../../../eslint-config/src/rules/utils/shared-components.js'
import { runNoLocalCopyCheck } from '../../src/foundation/evaluate-component-suite.js'
import { evaluateItem13 } from '../../src/foundation/items/item-13-no-local-copy.js'
import {
  SHARED_COMPONENT_OWNERS,
  nuxtComponentName,
} from '../../src/foundation/shared-components.js'
import { AppRepo } from '../../src/foundation/source.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const CORE = '@narduk-enterprises/narduk-core'
const SHELL = '@narduk-enterprises/narduk-shell'
const SFC = '<template><div /></template>\n'

function uiApp(dependencies: Record<string, string>): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture', dependencies })
  writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
  writeFile(root, 'app/pages/index.vue', SFC)
  return root
}

function byId(root: string) {
  return new Map(evaluateItem13(new AppRepo(root)).map((sub) => [sub.id, sub]))
}

describe('item 13 no-local-copy', () => {
  it('matches the eslint-config list the drift test pins', () => {
    const lint = LINT_OWNERS.map((o) => [`@narduk-enterprises/${o.pkg}`, [...o.names].sort()])
    const tools = SHARED_COMPONENT_OWNERS.map((o) => [o.pkg, [...o.names].sort()])
    expect(tools).toEqual(lint)
  })

  it.each([
    'AppTabs.vue',
    'shared/AppTabs.vue',
    'app/AppHeader.vue',
    'ne/StatePanel.vue',
    'orders/parts/Row.vue',
    'orders/index.vue',
    'base/base-button.vue',
    'HTMLParser.vue',
    'charts/Chart2D.vue',
    'ui/AB2.vue',
    'my-app/data_table/Ne.DataTable.vue',
  ])('derives the same Nuxt name as the lint rule for %s', (relativePath) => {
    expect(nuxtComponentName(relativePath)).toBe(lintNuxtComponentName(relativePath))
  })

  it('passes an app whose components are its own', () => {
    const root = uiApp({ [CORE]: '2.10.1', [SHELL]: '0.6.0' })
    writeFile(root, 'app/components/orders/OrderRow.vue', SFC)

    const artefact = runNoLocalCopyCheck({ root, toolVersion: 'test' })
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.item).toMatchObject({ id: 13, name: 'no-local-copy', status: 'pass' })
  })

  it('fails a copy of an installed package, by file name or by Nuxt name', () => {
    const root = uiApp({ [CORE]: '2.10.1', [SHELL]: '0.6.0' })
    writeFile(root, 'app/components/shared/AppTabs.vue', SFC)
    writeFile(root, 'app/components/ne/StatePanel.vue', SFC)

    const subs = byId(root)
    expect(subs.get('13.1')?.status).toBe('fail')
    expect(subs.get('13.1')?.detail).toContain('app/components/ne/StatePanel.vue (NeStatePanel)')
    expect(subs.get('13.2')?.status).toBe('fail')
    expect(subs.get('13.2')?.detail).toContain('app/components/shared/AppTabs.vue (AppTabs)')
    expect(runNoLocalCopyCheck({ root, toolVersion: 'test' }).exitCode).toBe(1)
  })

  it('finds components at the apps/web monorepo prefix', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'apps/web/package.json', { name: 'web', dependencies: { [CORE]: '2.10.1' } })
    writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
    writeFile(root, 'apps/web/app/components/layout/LayerAppFooter.vue', SFC)

    expect(byId(root).get('13.2')?.status).toBe('fail')
  })

  it('is N/A for a package the app does not install, and still names the file', () => {
    const root = uiApp({ [CORE]: '2.10.1' })
    writeFile(root, 'app/components/charts/NardukLineChart.vue', SFC)

    const charts = byId(root).get('13.5')
    expect(charts?.status).toBe('not-applicable')
    expect(charts?.detail).toContain('NardukLineChart')
    expect(runNoLocalCopyCheck({ root, toolVersion: 'test' }).result).toBe('PASS')
  })

  it('is N/A in full for an app with no UI', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'api', dependencies: { [CORE]: '2.10.1' } })

    const artefact = runNoLocalCopyCheck({ root, toolVersion: 'test' })
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.exitCode).toBe(0)
  })
})
