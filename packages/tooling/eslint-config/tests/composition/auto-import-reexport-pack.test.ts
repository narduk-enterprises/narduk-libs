/**
 * `narduk/no-auto-import-reexport` is on, at error, in the `core` pack that every
 * app composes by default; the rule's own cases live in
 * `tests/rules/general/no-auto-import-reexport.test.ts`.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

type FlatConfig = { rules?: Record<string, unknown> }

interface AppConfigModule {
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => unknown[]
  defaultCapabilityPresetOrder: string[]
}

let appConfig: AppConfigModule

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

describe('core pack: auto-import re-exports', () => {
  it('lints a sibling re-export as an error under the default pack order', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: appConfig.composeSharedConfigs(
        ...appConfig.defaultCapabilityPresetOrder,
      ) as never,
    })
    const config = (await eslint.calculateConfigForFile('app/utils/format.ts')) as FlatConfig
    expect(config.rules?.['narduk/no-auto-import-reexport']).toEqual([2])
  })

  it('reports it through ESLint with the explanation', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: appConfig.composeSharedConfigs('core') as never,
    })
    const [result] = await eslint.lintText("export { x } from './sibling'\n", {
      filePath: 'app/utils/format.ts',
    })
    const hits = result?.messages.filter((m) => m.ruleId === 'narduk/no-auto-import-reexport')
    expect(hits).toHaveLength(1)
    expect(hits?.[0]?.severity).toBe(2)
    expect(hits?.[0]?.message).toContain('Duplicated imports')
  })
})
