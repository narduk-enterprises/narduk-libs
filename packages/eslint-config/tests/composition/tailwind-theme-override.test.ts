import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import nuxtPlugin from '@nuxt/eslint-plugin'
import { ESLint } from 'eslint'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `no-unknown-classes`, `no-deprecated-classes` and `enforce-canonical-classes`
 * all resolve classes against the app's *compiled* Tailwind theme. Without a
 * resolvable entry stylesheet they do not fail quietly — the plugin's shared
 * context reports "No tailwind css entry point found at `…`. Option
 * `entryPoint` may be misconfigured" per class, which is what the workspace's
 * own library packages (no CSS entry) produced.
 *
 * So the design-system pack ships them OFF, and `createAppLintConfig()` turns
 * them on only when BOTH the pack that registers the `better-tailwindcss`
 * plugin is selected AND the app's entry point exists on disk. These tests pin
 * every state, because a regression in any direction is severe:
 *
 * - enabling too eagerly floods a consumer with false unknown-class errors;
 * - disabling too eagerly loses the Tailwind token gate altogether;
 * - **enabling without the pack does not degrade at all** — ESLint throws
 *   `Could not find plugin "better-tailwindcss" in configuration` while
 *   normalising the config and lints nothing. v2 gated on file existence alone,
 *   so a non-design-system app whose CSS sat at the default
 *   `app/assets/css/main.css` crashed out of the box. Found by the first
 *   consumer migration (spacex-ipo#8 escalation).
 */

type FlatConfig = {
  name?: string
  files?: string[]
  rules?: Record<string, unknown>
  settings?: Record<string, unknown>
}

interface AppConfigModule {
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
}

const THEME_OVERRIDE_NAME = 'narduk/design-system-tailwind-theme'
const PACK_ENTRY_NAME = 'narduk/design-system-tailwind'
/** Every rule that needs the compiled Tailwind theme to run. */
const THEME_RULES = {
  'better-tailwindcss/no-unknown-classes': 'error',
  'better-tailwindcss/no-deprecated-classes': 'error',
  'better-tailwindcss/enforce-canonical-classes': 'warn',
} as const
const THEME_RULE_NAMES = Object.keys(THEME_RULES) as Array<keyof typeof THEME_RULES>

/** A real non-design-system selection: the shape the migrated consumer ships. */
const PACKS_WITHOUT_DESIGN_SYSTEM = ['core', 'server']

/** Capture what `createAppLintConfig` hands to the app's `withNuxt()`. */
const captureWithNuxt = (...configs: FlatConfig[]): FlatConfig[] => configs

/**
 * Stand-in for the app's generated `withNuxt()`. `createAppLintConfig` strips
 * the plugins Nuxt's own flat config registers (`vue`, `@typescript-eslint`,
 * `nuxt`), so the captured array is only lintable once something puts them
 * back — which is exactly what the real wrapper does.
 */
const withNuxtLike = (...configs: FlatConfig[]): FlatConfig[] => [
  {
    name: 'test/nuxt-managed-plugins',
    plugins: { '@typescript-eslint': tseslint.plugin, nuxt: nuxtPlugin, vue: vuePlugin },
  } as FlatConfig,
  ...configs,
]

let appConfig: AppConfigModule
let appRootWithEntry: string
let appRootWithoutEntry: string

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule

  appRootWithEntry = mkdtempSync(join(tmpdir(), 'narduk-eslint-tw-yes-'))
  mkdirSync(join(appRootWithEntry, 'app/assets/css'), { recursive: true })
  writeFileSync(join(appRootWithEntry, 'app/assets/css/main.css'), '@import "tailwindcss";\n')

  appRootWithoutEntry = mkdtempSync(join(tmpdir(), 'narduk-eslint-tw-no-'))
})

afterAll(() => {
  for (const dir of [appRootWithEntry, appRootWithoutEntry]) {
    if (dir) rmSync(dir, { force: true, recursive: true })
  }
})

const themeOverrideIn = (configs: FlatConfig[]): FlatConfig | undefined =>
  configs.find((entry) => entry.name === THEME_OVERRIDE_NAME)

/**
 * Every `better-tailwindcss/*` rule the composed config leaves *enabled*.
 * ESLint skips validation at severity 0, so an `off` entry (the content
 * preset's `no-restricted-classes`) resolves no plugin and cannot crash;
 * anything else here without the pack is the crash.
 */
const enabledBetterTailwindRulesIn = (configs: FlatConfig[]): string[] =>
  configs.flatMap((entry) =>
    Object.entries(entry.rules ?? {})
      .filter(
        ([ruleName, setting]) =>
          ruleName.startsWith('better-tailwindcss/') && setting !== 'off' && setting !== 0,
      )
      .map(([ruleName]) => ruleName),
  )

describe('design-system pack on its own', () => {
  it('ships every theme-resolving rule off', () => {
    const packEntry = appConfig
      .composeSharedConfigs('design-system')
      .find((entry) => entry.name === PACK_ENTRY_NAME)

    expect(packEntry).toBeDefined()

    for (const ruleName of THEME_RULE_NAMES) {
      expect(packEntry?.rules?.[ruleName]).toBe('off')
    }
  })

  it('still enables the tailwind rule that needs no compiled theme', () => {
    const packEntry = appConfig
      .composeSharedConfigs('design-system')
      .find((entry) => entry.name === PACK_ENTRY_NAME)

    // no-restricted-classes matches literal class text, so gating it would be a
    // regression: it is the narduk/no-raw-tailwind-colors replacement and has to
    // keep working in packages with no CSS entry.
    expect(packEntry?.rules?.['better-tailwindcss/no-restricted-classes']).toBeDefined()
    expect(packEntry?.rules?.['better-tailwindcss/no-restricted-classes']).not.toBe('off')
  })

  it('adds no theme override — composeSharedConfigs never touches the disk', () => {
    expect(themeOverrideIn(appConfig.composeSharedConfigs('design-system'))).toBeUndefined()
  })
})

describe('createAppLintConfig with an existing tailwind entry point', () => {
  it('appends the override with the resolved absolute entry point', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['design-system'],
      appRootDir: appRootWithEntry,
    })

    const override = themeOverrideIn(composed)

    expect(override).toBeDefined()
    expect(override?.files).toEqual(['**/*.vue'])
    expect(override?.settings).toEqual({
      'better-tailwindcss': { entryPoint: join(appRootWithEntry, 'app/assets/css/main.css') },
    })
  })

  it('enables every theme rule at the severity the pack would have used', () => {
    const override = themeOverrideIn(
      appConfig.createAppLintConfig({
        withNuxt: captureWithNuxt,
        capabilityPacks: ['design-system'],
        appRootDir: appRootWithEntry,
      }),
    )

    for (const [ruleName, severity] of Object.entries(THEME_RULES)) {
      expect(override?.rules?.[ruleName]).toBe(severity)
    }
  })

  it('sorts after the pack entry that switched the rules off', () => {
    // Flat config is last-wins; an override placed before the pack would be
    // silently overwritten by the pack's `off`.
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['design-system'],
      appRootDir: appRootWithEntry,
    })

    const packIndex = composed.findIndex((entry) => entry.name === PACK_ENTRY_NAME)
    const overrideIndex = composed.findIndex((entry) => entry.name === THEME_OVERRIDE_NAME)

    expect(packIndex).toBeGreaterThanOrEqual(0)
    expect(overrideIndex).toBeGreaterThan(packIndex)
  })

  it('honours a non-default entry point that exists', () => {
    mkdirSync(join(appRootWithEntry, 'assets'), { recursive: true })
    writeFileSync(join(appRootWithEntry, 'assets/tailwind.css'), '@import "tailwindcss";\n')

    const override = themeOverrideIn(
      appConfig.createAppLintConfig({
        withNuxt: captureWithNuxt,
        capabilityPacks: ['design-system'],
        appRootDir: appRootWithEntry,
        tailwindEntryPoint: 'assets/tailwind.css',
      }),
    )

    expect(override?.settings).toEqual({
      'better-tailwindcss': { entryPoint: join(appRootWithEntry, 'assets/tailwind.css') },
    })
  })
})

describe('createAppLintConfig without a tailwind entry point', () => {
  it('adds no override when the default entry point is absent', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['design-system'],
      appRootDir: appRootWithoutEntry,
    })

    expect(themeOverrideIn(composed)).toBeUndefined()
  })

  it('leaves every theme rule off, so no misconfiguration banner can fire', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['design-system'],
      appRootDir: appRootWithoutEntry,
    })

    const effective = new Map<string, unknown>()
    for (const entry of composed) {
      for (const [ruleName, setting] of Object.entries(entry.rules ?? {})) {
        effective.set(ruleName, setting)
      }
    }

    for (const ruleName of THEME_RULE_NAMES) {
      expect(effective.get(ruleName)).toBe('off')
    }
  })

  it('adds no override when a configured entry point does not exist', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['design-system'],
      appRootDir: appRootWithEntry,
      tailwindEntryPoint: 'app/assets/css/does-not-exist.css',
    })

    expect(themeOverrideIn(composed)).toBeUndefined()
  })

  // `undefined` is deliberately absent: it falls through to the default
  // `app/assets/css/main.css`, which the covering suite above asserts.
  it.each([
    { entryPoint: '', label: 'an empty string' },
    { entryPoint: null, label: 'null' },
    { entryPoint: 42, label: 'a number' },
  ])(
    'adds no override when the entry point is $label',
    ({ entryPoint }: { entryPoint: unknown }) => {
      const composed = appConfig.createAppLintConfig({
        withNuxt: captureWithNuxt,
        capabilityPacks: ['design-system'],
        appRootDir: appRootWithEntry,
        tailwindEntryPoint: entryPoint,
      })

      expect(themeOverrideIn(composed)).toBeUndefined()
    },
  )
})

/**
 * The pack half of the gate. `design-system` is the only pack that registers the
 * `better-tailwindcss` plugin, so emitting its rules without it is not a
 * degraded lint — it is no lint at all.
 */
describe('createAppLintConfig without the design-system pack', () => {
  it('adds no override even though the default entry point exists on disk', () => {
    // Case (b) from the escalation, and the one that bit a real app: nothing
    // about this config mentions Tailwind, and the app is only "guilty" of
    // keeping its stylesheet where Nuxt UI puts it.
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: PACKS_WITHOUT_DESIGN_SYSTEM,
      appRootDir: appRootWithEntry,
    })

    expect(themeOverrideIn(composed)).toBeUndefined()
  })

  it('leaves no better-tailwindcss rule enabled anywhere in the composed config', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: PACKS_WITHOUT_DESIGN_SYSTEM,
      appRootDir: appRootWithEntry,
      // The content preset is the other place a `better-tailwindcss` rule name
      // appears; it sets one to `off`, which must stay harmless.
      appType: 'content',
    })

    expect(enabledBetterTailwindRulesIn(composed)).toEqual([])
  })

  it('lints a trivial .vue file instead of aborting inside plugin resolution', async () => {
    // The regression proper. The three assertions above read the config array —
    // which is exactly how the bug hid, since the array was "correct" and it was
    // ESLint's own normalisation that threw. So run the real resolver.
    const composed = appConfig.createAppLintConfig({
      withNuxt: withNuxtLike,
      capabilityPacks: PACKS_WITHOUT_DESIGN_SYSTEM,
      appRootDir: appRootWithEntry,
    })

    const eslint = new ESLint({
      baseConfig: composed as never,
      cwd: appRootWithEntry,
      overrideConfigFile: true,
    })

    const results = await eslint.lintText(
      '<template>\n  <div class="text-sm">ok</div>\n</template>\n',
      { filePath: join(appRootWithEntry, 'app/components/Trivial.vue') },
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.messages.filter((message) => message.fatal)).toEqual([])
  })

  it.each([
    { entryPoint: 'app/assets/css/main.css', label: 'the default path, spelled out loud' },
    { entryPoint: 'assets/tailwind.css', label: 'a custom path' },
    { entryPoint: 'app/assets/css/does-not-exist.css', label: 'a path that does not exist' },
  ])(
    'throws a named configuration error when tailwindEntryPoint is $label',
    ({ entryPoint }: { entryPoint: string }) => {
      // Case (a): the app asked for Tailwind linting and did not select the pack
      // that can provide it. Fail loud at compose time, naming the requirement,
      // rather than letting ESLint die with a message that never says
      // `capabilityPacks`. Note the throw does not depend on the file existing —
      // the contradiction is in the configuration, not on disk.
      const compose = (): FlatConfig[] =>
        appConfig.createAppLintConfig({
          withNuxt: captureWithNuxt,
          capabilityPacks: PACKS_WITHOUT_DESIGN_SYSTEM,
          appRootDir: appRootWithEntry,
          tailwindEntryPoint: entryPoint,
        })

      expect(compose).toThrow(/tailwindEntryPoint requires the design-system capability pack/)
      expect(compose).toThrow(/better-tailwindcss/)
    },
  )

  it.each([
    { entryPoint: '', label: 'an empty string' },
    { entryPoint: null, label: 'null' },
    { entryPoint: 42, label: 'a number' },
  ])(
    'stays silent when the explicit entry point is $label',
    ({ entryPoint }: { entryPoint: unknown }) => {
      // Only a value that asked for theme linting contradicts the missing pack.
      // These have always meant "no override" and must not start throwing.
      const composed = appConfig.createAppLintConfig({
        withNuxt: captureWithNuxt,
        capabilityPacks: PACKS_WITHOUT_DESIGN_SYSTEM,
        appRootDir: appRootWithEntry,
        tailwindEntryPoint: entryPoint,
      })

      expect(themeOverrideIn(composed)).toBeUndefined()
    },
  )
})

describe('how the design-system pack is named', () => {
  it('accepts the v1 camelCase alias', () => {
    // `capabilityPackAliases` maps designSystem -> design-system, so the gate has
    // to resolve the alias too or a v1-spelled consumer silently loses the rules.
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['designSystem'],
      appRootDir: appRootWithEntry,
    })

    expect(themeOverrideIn(composed)).toBeDefined()
  })

  it('counts the default preset order when capabilityPacks is omitted', () => {
    // An omitted/empty array composes `defaultCapabilityPresetOrder`, which
    // includes design-system — so the plugin *is* registered and the override
    // belongs there.
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      appRootDir: appRootWithEntry,
    })

    expect(themeOverrideIn(composed)).toBeDefined()
  })

  it('does not mistake another pack for it', () => {
    const composed = appConfig.createAppLintConfig({
      withNuxt: captureWithNuxt,
      capabilityPacks: ['nuxt-ui'],
      appRootDir: appRootWithEntry,
    })

    expect(themeOverrideIn(composed)).toBeUndefined()
  })
})
