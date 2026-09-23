/**
 * The shared imports block pins eslint-plugin-import-x's own Node resolver
 * (narduk-libs#562). Without one, import-x falls back to its legacy `node`
 * probe, which crashes `import-x/no-cycle` on a `vitest.config.ts` with "node
 * with invalid interface loaded as resolver". narduk-core and narduk-auth lint
 * their own `vitest.config.ts` with the rule on, which is the behavioural proof.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped resolver output
type FlatConfig = Record<string, any>

let composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]

beforeAll(async () => {
  ;({ composeSharedConfigs } = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as { composeSharedConfigs: typeof composeSharedConfigs })
})

describe('import-x resolver (narduk-libs#562)', () => {
  it('sets a modern resolver wherever import-x/no-cycle runs', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: composeSharedConfigs() as never,
    })
    const config = (await eslint.calculateConfigForFile('apps/web/vitest.config.ts')) as FlatConfig

    expect(config.rules?.['import-x/no-cycle']?.[0]).toBe(2)
    const resolvers = config.settings?.['import-x/resolver-next']
    expect(Array.isArray(resolvers)).toBe(true)
    expect(resolvers).toHaveLength(1)
    expect(resolvers[0]).toMatchObject({ interfaceVersion: 3 })
    expect(typeof resolvers[0].resolve).toBe('function')
  })
})
