import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
 * them on only when the app's entry point actually exists on disk. These tests
 * pin all three states, because a regression in either direction is silent:
 * enabling too eagerly floods a consumer with false unknown-class errors,
 * disabling too eagerly loses the Tailwind token gate altogether.
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

/** Capture what `createAppLintConfig` hands to the app's `withNuxt()`. */
const captureWithNuxt = (...configs: FlatConfig[]): FlatConfig[] => configs

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
