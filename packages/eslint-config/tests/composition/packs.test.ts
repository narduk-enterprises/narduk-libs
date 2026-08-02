import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

/**
 * `eslint-app-config.mjs` and the packs it composes are plain ESM with no type
 * declarations, and the packs import the built `dist/index.js`. Loading them
 * through a computed URL keeps TypeScript out of the way and makes the
 * dependency on `pnpm run build` explicit rather than a resolution error.
 */
type FlatConfig = {
  name?: string
  files?: string[]
  ignores?: string[]
  plugins?: Record<string, unknown>
  rules?: Record<string, unknown>
  settings?: Record<string, unknown>
}

interface AppConfigModule {
  capabilityConfigs: Record<string, FlatConfig[]>
  capabilityPackAliases: Record<string, string>
  defaultCapabilityPresetOrder: string[]
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
  resolveCapabilityPackName: (presetName: string) => string
  sharedConfigs: FlatConfig[]
  NUXT_BUILT_IN_COMPONENTS: string[]
}

interface NardukPlugin {
  meta: { name: string; version: string }
  rules: Record<string, unknown>
}

/** DESIGN.md: "the 14 capability pack names survive". */
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

const LEGACY_PRESET_NAMES = [
  'recommended',
  'nuxt',
  'vue',
  'vue-strict',
  'app',
  'all',
  'styling',
  'hydration',
  'nuxtCore',
  'vueCore',
  'pinia',
  'serverData',
  'serverRuntime',
  'templateVue',
  'templateProject',
  'templateServer',
  'clientAppPerf',
]

let appConfig: AppConfigModule
let plugin: NardukPlugin

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule

  const pluginModule = (await import(new URL('../../dist/index.js', import.meta.url).href)) as {
    default: NardukPlugin
  }

  plugin = pluginModule.default
})

describe('capability packs', () => {
  it('registers exactly the fourteen pack names', () => {
    expect(Object.keys(appConfig.capabilityConfigs).sort()).toEqual(
      [...CAPABILITY_PACK_NAMES].sort(),
    )
  })

  it('registers no legacy preset', () => {
    for (const legacyName of LEGACY_PRESET_NAMES) {
      expect(appConfig.capabilityConfigs).not.toHaveProperty(legacyName)
    }
  })

  it.each(CAPABILITY_PACK_NAMES)('composes %s without throwing', (packName) => {
    expect(() => appConfig.composeSharedConfigs(packName)).not.toThrow()
    expect(appConfig.composeSharedConfigs(packName).length).toBeGreaterThan(0)
  })

  it('composes every pack together without throwing', () => {
    expect(() => appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES)).not.toThrow()
  })

  it('composes the default preset order when called with no arguments', () => {
    expect(() => appConfig.composeSharedConfigs()).not.toThrow()
    expect(appConfig.sharedConfigs.length).toBeGreaterThan(0)

    for (const packName of appConfig.defaultCapabilityPresetOrder) {
      expect(CAPABILITY_PACK_NAMES).toContain(packName)
    }
  })

  it('accepts an array argument as well as varargs', () => {
    const viaVarargs = appConfig.composeSharedConfigs('core', 'server')
    const viaArray = appConfig.composeSharedConfigs(['core', 'server'])

    expect(viaArray).toHaveLength(viaVarargs.length)
  })

  it('keeps v1 camelCase spellings working', () => {
    expect(appConfig.resolveCapabilityPackName('designSystem')).toBe('design-system')
    expect(appConfig.resolveCapabilityPackName('nuxtUi')).toBe('nuxt-ui')

    expect(appConfig.composeSharedConfigs('designSystem')).toHaveLength(
      appConfig.composeSharedConfigs('design-system').length,
    )
  })

  it('rejects an unknown pack name and names the valid ones', () => {
    expect(() => appConfig.composeSharedConfigs('not-a-pack')).toThrow(/not-a-pack/)
    expect(() => appConfig.composeSharedConfigs('not-a-pack')).toThrow(/design-system/)
  })

  it.each(LEGACY_PRESET_NAMES)('rejects the legacy preset name %s', (legacyName) => {
    expect(() => appConfig.composeSharedConfigs(legacyName)).toThrow(/Unknown eslint config preset/)
  })

  it('produces only plain flat-config objects', () => {
    for (const entry of appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES)) {
      expect(entry).toBeTypeOf('object')
      expect(entry).not.toBeNull()
      expect(Array.isArray(entry)).toBe(false)
    }
  })
})

describe('rule manifest and packs agree', () => {
  const nardukRulesUsedBy = (configs: FlatConfig[]): string[] =>
    [
      ...new Set(
        configs.flatMap((entry) =>
          Object.keys(entry.rules ?? {})
            .filter((ruleName) => ruleName.startsWith('narduk/'))
            .map((ruleName) => ruleName.slice('narduk/'.length)),
        ),
      ),
    ].sort()

  it('references no rule the plugin does not ship', () => {
    const referenced = nardukRulesUsedBy(appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES))
    const shipped = new Set(Object.keys(plugin.rules))
    const missing = referenced.filter((ruleName) => !shipped.has(ruleName))

    expect(missing).toEqual([])
  })

  it('ships no rule that is never enabled by a pack', () => {
    const referenced = new Set(
      nardukRulesUsedBy(appConfig.composeSharedConfigs(CAPABILITY_PACK_NAMES)),
    )
    const orphans = Object.keys(plugin.rules)
      .filter((ruleName) => !referenced.has(ruleName))
      .sort()

    expect(orphans).toEqual([])
  })

  it('registers every rule module that exists on disk', () => {
    // Guards the drift a parallel build cannot otherwise catch: a lane landing
    // `src/rules/<tier>/<rule>.ts` without a manifest entry would ship a rule
    // nothing can enable, invisibly.
    const rulesDir = fileURLToPath(new URL('../../src/rules', import.meta.url))
    const tiers = readdirSync(rulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'utils')
      .map((entry) => entry.name)

    const onDisk = tiers
      .flatMap((tier) =>
        readdirSync(new URL(`../../src/rules/${tier}/`, import.meta.url))
          .filter((file) => file.endsWith('.ts') && !file.startsWith('_'))
          .map((file) => file.replace(/\.ts$/, '')),
      )
      .sort()

    expect(onDisk.length).toBeGreaterThan(0)

    const unregistered = onDisk.filter((ruleName) => !Object.hasOwn(plugin.rules, ruleName))

    expect(unregistered).toEqual([])
    expect(Object.keys(plugin.rules).sort()).toEqual(onDisk)
  })

  it('exposes no `configs` surface on the plugin object', () => {
    // v1's legacy presets lived on plugin.configs; v2 has capability packs only.
    expect(plugin).not.toHaveProperty('configs')
  })

  it('stamps the plugin with its package identity', () => {
    expect(plugin.meta.name).toBe('@narduk-enterprises/eslint-config')
    expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

/**
 * Flat config replaces a rule's options rather than merging them. Any entry that
 * re-declares a rule already set by an earlier, broader entry must restate that
 * entry's configuration, or the earlier one is silently switched off for every
 * file both match. `no-restricted-imports` has its own suite; this covers the
 * other rule configured at two scopes.
 */
describe('flat config replaces rule options rather than merging them', () => {
  it('keeps the full restricted-element list on pages, at the same severity', () => {
    const composed = appConfig.composeSharedConfigs('design-system')
    const entries = composed.filter(
      (entry) => entry.rules?.['vue/no-restricted-html-elements'] !== undefined,
    )

    expect(entries.length).toBeGreaterThan(1)

    const settings = entries.map(
      (entry) =>
        entry.rules?.['vue/no-restricted-html-elements'] as [
          string,
          ...Array<{ element: string | string[] }>,
        ],
    )

    const [baseSeverity, ...baseElements] = settings[0] as [
      string,
      ...Array<{ element: string | string[] }>,
    ]
    const [pageSeverity, ...pageElements] = settings.at(-1) as [
      string,
      ...Array<{ element: string | string[] }>,
    ]

    const flatten = (entries_: Array<{ element: string | string[] }>): string[] =>
      entries_.flatMap((restriction) =>
        Array.isArray(restriction.element) ? restriction.element : [restriction.element],
      )

    expect(pageSeverity).toBe(baseSeverity)
    expect(flatten(pageElements)).toEqual(expect.arrayContaining(flatten(baseElements)))
    // …and adds the page-scoped layout elements on top.
    expect(flatten(pageElements)).toEqual(
      expect.arrayContaining(['header', 'footer', 'main', 'nav']),
    )
  })
})
