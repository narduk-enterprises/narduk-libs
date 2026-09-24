import { beforeAll, describe, expect, it } from 'vitest'

/**
 * narduk-libs#167: `composeSharedConfigs()` / `createAppLintConfig()` always
 * bundled the community tail. These assertions fail on the pre-opt-out API
 * (`{ packs, communityLayer: false }` was an unknown preset) and they fail if
 * the flag is accepted but ignored.
 */

type FlatConfig = {
  name?: string
  rules?: Record<string, unknown>
}

interface AppConfigModule {
  composeSharedConfigs: (
    ...args: Array<string | string[] | { packs?: string | string[]; communityLayer?: boolean }>
  ) => FlatConfig[]
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
}

/** Named entries that exist only because `sharedTailConfigs` is composed. */
const COMMUNITY_TAIL_CONFIG_NAMES = [
  'narduk/vue-house-style',
  'narduk/imports',
  'narduk/modern-js',
  'narduk/promise-safety',
  'narduk/eslint-directive-hygiene',
  'narduk/vitest',
  'narduk/security',
] as const

/** Rule prefixes the issue listed as the unplanned finding wave. */
const COMMUNITY_TAIL_RULE_PREFIXES = [
  'import-x/',
  'unicorn/',
  'promise/',
  'security/',
  'regexp/',
  '@eslint-community/eslint-comments/',
  'vitest/',
] as const

const PRETTIER_CONFIG_NAME = 'narduk/prettier-disable'

let appConfig: AppConfigModule

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

const namedEntries = (configs: FlatConfig[]): string[] =>
  configs.map((entry) => entry.name).filter((name): name is string => Boolean(name))

const ruleNames = (configs: FlatConfig[]): string[] =>
  [...new Set(configs.flatMap((entry) => Object.keys(entry.rules ?? {})))].sort()

const communityTailRules = (configs: FlatConfig[]): string[] =>
  ruleNames(configs.filter((entry) => entry.name !== PRETTIER_CONFIG_NAME)).filter((ruleName) =>
    COMMUNITY_TAIL_RULE_PREFIXES.some((prefix) => ruleName.startsWith(prefix)),
  )

describe('composeSharedConfigs community-layer opt-out', () => {
  it('keeps the community tail on the existing pack-name call', () => {
    const composed = appConfig.composeSharedConfigs('a11y')
    const names = namedEntries(composed)
    const rules = ruleNames(composed)

    expect(names).toEqual(expect.arrayContaining([...COMMUNITY_TAIL_CONFIG_NAMES]))
    expect(rules).toContain('unicorn/no-for-each')
    expect(rules).toContain('import-x/named')
    expect(rules).toContain('vue/define-macros-order')
    expect(communityTailRules(composed).length).toBeGreaterThan(0)
    expect(rules.some((ruleName) => ruleName.startsWith('vuejs-accessibility/'))).toBe(true)
    expect(composed.at(-1)?.name).toBe(PRETTIER_CONFIG_NAME)
  })

  it('treats an options object without communityLayer as today', () => {
    expect(ruleNames(appConfig.composeSharedConfigs({ packs: ['a11y'] }))).toEqual(
      ruleNames(appConfig.composeSharedConfigs('a11y')),
    )
    expect(namedEntries(appConfig.composeSharedConfigs({ packs: ['a11y'] }))).toEqual(
      namedEntries(appConfig.composeSharedConfigs('a11y')),
    )
  })

  it('omits the community tail when communityLayer is false', () => {
    const composed = appConfig.composeSharedConfigs({
      packs: ['a11y'],
      communityLayer: false,
    })
    const names = namedEntries(composed)
    const rules = ruleNames(composed)

    for (const tailName of COMMUNITY_TAIL_CONFIG_NAMES) {
      expect(names).not.toContain(tailName)
    }

    expect(communityTailRules(composed)).toEqual([])
    expect(rules).not.toContain('vue/define-macros-order')
    expect(rules.some((ruleName) => ruleName.startsWith('vuejs-accessibility/'))).toBe(true)
    expect(composed.at(-1)?.name).toBe(PRETTIER_CONFIG_NAME)
  })

  it('still rejects an unknown pack when the tail is opted out', () => {
    expect(() =>
      appConfig.composeSharedConfigs({ packs: ['not-a-pack'], communityLayer: false }),
    ).toThrow(/not-a-pack/)
  })

  it('rejects mixing pack names with an options object', () => {
    expect(() => appConfig.composeSharedConfigs('a11y', { communityLayer: false })).toThrow(
      /single \{ packs, communityLayer \} object/,
    )
  })
})

describe('createAppLintConfig community-layer opt-out', () => {
  const withNuxt = (...configs: FlatConfig[]): FlatConfig[] => configs

  it('keeps the community tail when communityLayer is omitted', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt,
      capabilityPacks: ['a11y'],
      appRootDir: '/app',
    })

    expect(namedEntries(composed)).toEqual(expect.arrayContaining([...COMMUNITY_TAIL_CONFIG_NAMES]))
    expect(ruleNames(composed)).toContain('unicorn/no-for-each')
  })

  it('omits the community tail when communityLayer is false', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt,
      capabilityPacks: ['a11y'],
      communityLayer: false,
      appRootDir: '/app',
    })

    for (const tailName of COMMUNITY_TAIL_CONFIG_NAMES) {
      expect(namedEntries(composed)).not.toContain(tailName)
    }

    expect(communityTailRules(composed)).toEqual([])
    expect(
      ruleNames(composed).some((ruleName) => ruleName.startsWith('vuejs-accessibility/')),
    ).toBe(true)
  })
})
