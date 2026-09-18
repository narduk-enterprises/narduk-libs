/**
 * The 2026-09-18 rule additions, asserted through ESLint's own resolver.
 *
 * Errors from day one: server promise rules, no-render-clock, the
 * runtimeConfig secrets rule. Warn (budgeted by narduk-lint): the client-side
 * type-aware set, require-fetch-timeout, prefer-db-batch, sonarjs/sql-queries,
 * server no-console, unused disable directives.
 *
 * The server promise rules must stay `error` whatever order an app lists its
 * packs in — the correctness pack's `warn` copies exclude `server/**` for
 * exactly that reason — and the server entry must carry its own project
 * service so it works without the correctness pack.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

// Resolved configs are deeply dynamic; the assertions below read known paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped resolver output
type FlatConfig = Record<string, any>

interface AppConfigModule {
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
}

let appConfig: AppConfigModule

async function printConfig(filePath: string, packs: string[]): Promise<FlatConfig> {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig: appConfig.composeSharedConfigs(...packs) as never,
  })
  return (await eslint.calculateConfigForFile(filePath)) as FlatConfig
}

function severity(config: FlatConfig, ruleId: string): number | undefined {
  const entry = config.rules?.[ruleId]
  if (entry === undefined) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

describe('server promise rules', () => {
  for (const packs of [['server'], ['server', 'correctness'], ['correctness', 'server']]) {
    it(`are errors with a project service for packs ${packs.join(', ')}`, async () => {
      const config = await printConfig('apps/web/server/api/things.get.ts', packs)
      expect(severity(config, '@typescript-eslint/no-floating-promises')).toBe(2)
      expect(severity(config, '@typescript-eslint/no-misused-promises')).toBe(2)
      expect(config.languageOptions?.parserOptions?.projectService).toBeTruthy()
    })
  }

  it('do not reach server test trees', async () => {
    const config = await printConfig('server/__tests__/things.test.ts', ['server'])
    expect(severity(config, '@typescript-eslint/no-floating-promises')).toBeUndefined()
  })

  it('createAppLintConfig points the server entry at the app tsconfig', () => {
    const configs = appConfig.createAppLintConfig({
      withNuxt: (...entries: FlatConfig[]) => entries,
      capabilityPacks: ['server'],
      appRootDir: '/app',
    })
    const entry = configs.find((config) => config.name === 'narduk/server-type-aware')
    expect(entry?.languageOptions.parserOptions.projectService.defaultProject).toBe(
      '/app/.nuxt/tsconfig.json',
    )
    expect(entry?.languageOptions.parserOptions.tsconfigRootDir).toBe('/app')
  })
})

describe('correctness type-aware warnings', () => {
  it('warn outside server/**', async () => {
    const config = await printConfig('app/composables/useThing.ts', ['correctness'])
    for (const ruleId of [
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      '@typescript-eslint/await-thenable',
      '@typescript-eslint/switch-exhaustiveness-check',
    ]) {
      expect(severity(config, ruleId), ruleId).toBe(1)
    }
  })
})

describe('core additions', () => {
  it('no-render-clock is an error in .vue files', async () => {
    const config = await printConfig('app/components/StationHero.vue', ['core'])
    expect(severity(config, 'narduk/no-render-clock')).toBe(2)
  })

  it('the runtimeConfig secrets rule is an error in nuxt.config only', async () => {
    expect(
      severity(
        await printConfig('apps/web/nuxt.config.ts', ['core']),
        'narduk/no-secret-in-public-runtime-config',
      ),
    ).toBe(2)
    expect(
      severity(
        await printConfig('app/app.config.ts', ['core']),
        'narduk/no-secret-in-public-runtime-config',
      ),
    ).toBeUndefined()
  })
})

describe('server warn additions', () => {
  it('attach to server sources', async () => {
    const config = await printConfig('server/utils/upstream.ts', ['server'])
    expect(severity(config, 'narduk/require-fetch-timeout')).toBe(1)
    expect(severity(config, 'narduk/prefer-db-batch')).toBe(1)
    expect(severity(config, 'sonarjs/sql-queries')).toBe(1)
  })

  it('no-console warns on every console method in server code', async () => {
    const server = await printConfig('server/utils/upstream.ts', ['server'])
    expect(server.rules['no-console']).toEqual([1, {}])
    const client = await printConfig('app/composables/useThing.ts', ['core'])
    expect(client.rules['no-console']).toEqual([1, { allow: ['warn', 'error'] }])
  })

  it('reports unused disable directives as warnings', async () => {
    const config = await printConfig('app/composables/useThing.ts', ['core'])
    expect(config.linterOptions?.reportUnusedDisableDirectives).toBe(1)
  })
})
