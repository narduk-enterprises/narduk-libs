// @ts-check
/**
 * v1-compatible flat-config fragments for Nuxt apps.
 *
 * Kept in v2 so `@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments`
 * re-exports (and the package configs importing through them) keep resolving.
 *
 * `redundantNuxtAutoImportFlatConfig` no longer carries a rule: v1's
 * eslint-plugin-redundant-nuxt-auto-import regex-parsed `.nuxt/imports.d.ts`
 * with brace counting, silently no-opped on any reformatted export block, and
 * walked the filesystem per linted file (deep review, narduk-libs#50 —
 * SHAKY). Per this package's replace-by-default design it is dropped rather
 * than shipped shaky; the fragment stays as an inert, spread-compatible
 * config entry so consumer configs need no edit. A hardened rebuild (real
 * TypeScript parse, cached discovery) can restore it behind the same name.
 */

export const importXVueCoreModuleFragment = {
  files: ['**/*.ts', '**/*.mts', '**/*.vue'],
  settings: {
    'import-x/core-modules': ['vue'],
  },
}

export const redundantNuxtAutoImportFlatConfig = {
  files: ['**/*.vue', '**/*.ts', '**/*.mts'],
  // Intentionally empty: see the header. Shape preserved for spreads.
  rules: {},
}
