import { describe, expect, it } from 'vitest'

/**
 * DESIGN.md build-time drop record: v1's standalone
 * `eslint-plugin-redundant-nuxt-auto-import` is dropped (it regex-parsed
 * `.nuxt/imports.d.ts` with brace counting, silently no-opped on reformatted
 * export blocks, and walked the filesystem per linted file), but the
 * `eslint-nuxt-flat-fragments` subpath survives as a compat shim so
 * `narduk-core`'s re-export and consumer `eslint.config.mjs` files keep
 * resolving without an edit.
 *
 * Two things therefore have to hold at once, and each fails silently on its
 * own: the subpath must still resolve with BOTH named exports (or a consumer
 * config throws at load), and the redundant-auto-import fragment must carry no
 * rules (or ESLint errors with "Definition for rule … was not found" on every
 * file, since the plugin that defined it is gone).
 */

interface FragmentsModule {
  importXVueCoreModuleFragment: {
    files?: string[]
    settings?: Record<string, unknown>
    rules?: Record<string, unknown>
    plugins?: Record<string, unknown>
  }
  redundantNuxtAutoImportFlatConfig: {
    files?: string[]
    settings?: Record<string, unknown>
    rules?: Record<string, unknown>
    plugins?: Record<string, unknown>
  }
}

const SUBPATH = '@narduk-enterprises/eslint-config/eslint-nuxt-flat-fragments'

describe('eslint-nuxt-flat-fragments compat shim', () => {
  it('resolves through the published package subpath', async () => {
    // Self-reference: exercises the `exports` entry a consumer would use,
    // rather than the relative file path only this package can see.
    const fragments = (await import(SUBPATH)) as unknown as FragmentsModule

    expect(fragments.importXVueCoreModuleFragment).toBeTypeOf('object')
    expect(fragments.redundantNuxtAutoImportFlatConfig).toBeTypeOf('object')
  })

  it('keeps the import-x core-modules settings fragment intact', async () => {
    const { importXVueCoreModuleFragment } = (await import(SUBPATH)) as unknown as FragmentsModule

    expect(importXVueCoreModuleFragment.files).toEqual(['**/*.ts', '**/*.mts', '**/*.vue'])
    expect(importXVueCoreModuleFragment.settings).toEqual({
      'import-x/core-modules': ['vue'],
    })
  })

  it('leaves the redundant-auto-import fragment inert — no rules, no plugin', async () => {
    const { redundantNuxtAutoImportFlatConfig } = (await import(
      SUBPATH
    )) as unknown as FragmentsModule

    expect(redundantNuxtAutoImportFlatConfig.rules).toEqual({})
    expect(redundantNuxtAutoImportFlatConfig.plugins).toBeUndefined()
    // Shape preserved so an existing `...spread` in a consumer config still
    // produces a valid flat-config entry.
    expect(redundantNuxtAutoImportFlatConfig.files).toEqual(['**/*.vue', '**/*.ts', '**/*.mts'])
  })

  it('references the dropped plugin nowhere', async () => {
    const fragments = (await import(SUBPATH)) as unknown as FragmentsModule
    const serialized = JSON.stringify(fragments)

    expect(serialized).not.toContain('redundant-auto-import/')
    expect(serialized).not.toContain('nuxt-redundant-auto-import')
  })

  it('exports nothing beyond the two v1 fragments', async () => {
    const fragments = (await import(SUBPATH)) as unknown as Record<string, unknown>

    expect(
      Object.keys(fragments)
        .filter((key) => key !== 'default' && key !== Symbol.toStringTag.toString())
        .sort(),
    ).toEqual(['importXVueCoreModuleFragment', 'redundantNuxtAutoImportFlatConfig'])
  })
})
