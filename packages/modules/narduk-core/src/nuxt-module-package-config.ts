/**
 * Shared Nuxt config fragment for **server-only module packages** — a
 * `packages/modules/*` package that publishes a Nuxt module but ships no `app/`
 * tree of its own (narduk-tenancy today; narduk-realtime and narduk-devices
 * when they adopt `nuxt typecheck`).
 *
 * Such a package keeps the package root as `srcDir`, so Nuxt generates
 * `include: ['../**\/*']` in `.nuxt/tsconfig.json`. That include is what puts
 * `src/module.ts` into a project for typed linting, but it also drags the flat
 * ESLint config — and through it the untyped `.mjs` sources of
 * `@narduk-enterprises/eslint-config` — into `nuxt typecheck`, which then
 * reports dozens of errors that have nothing to do with the package
 * (narduk-libs#176).
 *
 * Excluding the config file keeps both properties: typed lint coverage of
 * everything the package publishes, and a typecheck scoped to the package's own
 * sources.
 *
 * ```ts
 * import { modulePackageTypeScript } from '@narduk-enterprises/narduk-core/nuxt-module-package-config'
 *
 * export default defineNuxtConfig({
 *   modules: ['@narduk-enterprises/narduk-core/nuxt', './src/module'],
 *   typescript: modulePackageTypeScript(),
 * })
 * ```
 *
 * A package that sets an explicit `srcDir` (narduk-core, narduk-uploads) does
 * not need this: its generated include never reaches the package root.
 */

/** Paths every server-only module package excludes from `nuxt typecheck`. */
export const modulePackageTsConfigExclude: readonly string[] = Object.freeze([
  '../eslint.config.mjs',
])

export interface ModulePackageTypeScriptOptions {
  /** Extra paths to exclude, relative to the generated `.nuxt/` directory. */
  exclude?: readonly string[]
}

/** Build the `typescript` block for a server-only module package's `nuxt.config`. */
export function modulePackageTypeScript(options: ModulePackageTypeScriptOptions = {}): {
  tsConfig: { exclude: string[] }
} {
  return {
    tsConfig: {
      exclude: [...modulePackageTsConfigExclude, ...(options.exclude ?? [])],
    },
  }
}
