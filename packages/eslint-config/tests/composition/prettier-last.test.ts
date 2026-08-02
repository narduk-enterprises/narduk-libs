import { beforeAll, describe, expect, it } from 'vitest'

type FlatConfig = {
  name?: string
  files?: string[]
  rules?: Record<string, unknown>
}

interface AppConfigModule {
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
  sharedConfigs: FlatConfig[]
}

const CAPABILITY_PACK_NAMES = [
  'core',
  'design-system',
  'nuxt-ui',
  'seo',
  'cloudflare',
  'server',
  'auth',
  'template',
  'correctness',
  'a11y',
  'complexity',
  'formatting',
  'e2e',
  'monorepo',
]

const PRETTIER_CONFIG_NAME = 'narduk/prettier-disable'

let appConfig: AppConfigModule

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

/**
 * `eslint-config-prettier` only turns off the rules that fight Prettier. If any
 * later config re-enables a stylistic rule, that config wins and ESLint and
 * Prettier disagree — so the disable config must be the final entry in every
 * composition, not merely present in it.
 */
describe('prettier disable stays last', () => {
  it('is the final entry of the default composition', () => {
    expect(appConfig.sharedConfigs.at(-1)?.name).toBe(PRETTIER_CONFIG_NAME)
  })

  it.each(CAPABILITY_PACK_NAMES)('is the final entry when %s is selected', (packName) => {
    expect(appConfig.composeSharedConfigs(packName).at(-1)?.name).toBe(PRETTIER_CONFIG_NAME)
  })

  it('is the final entry with every pack selected', () => {
    expect(appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES).at(-1)?.name).toBe(
      PRETTIER_CONFIG_NAME,
    )
  })

  it('stays last even after the formatting pack, which re-enables ordering rules', () => {
    const composed = appConfig.composeSharedConfigs('core', 'formatting')
    const formattingIndex = composed.findIndex((entry) => entry.name === 'narduk/formatting')

    expect(formattingIndex).toBeGreaterThanOrEqual(0)
    expect(composed.at(-1)?.name).toBe(PRETTIER_CONFIG_NAME)
    expect(formattingIndex).toBeLessThan(composed.length - 1)
  })

  it('appears exactly once', () => {
    const composed = appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES)
    const occurrences = composed.filter((entry) => entry.name === PRETTIER_CONFIG_NAME)

    expect(occurrences).toHaveLength(1)
  })

  it('does not disable perfectionist ordering', () => {
    // Ordering is not formatting; the README documents the fix order.
    const prettierConfig = appConfig.sharedConfigs.at(-1)
    const disabledRules = Object.keys(prettierConfig?.rules ?? {})

    expect(disabledRules.filter((rule) => rule.startsWith('perfectionist/'))).toEqual([])
  })
})
