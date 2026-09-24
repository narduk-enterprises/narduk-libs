import { join, relative } from 'node:path'

import type { Nuxt } from '@nuxt/schema'

/**
 * Nuxt's generated tsconfigs include `app/`, `server/`, `shared/**\/*.d.ts` and
 * the root `*.d.ts`, but not `types/`. A `nuxt/schema` augmentation an app puts
 * in `types/` -- the obvious place, and where apps have put one -- is in no
 * program at all, and because `RuntimeConfig` is an open record the keys it
 * claims to type silently stay `unknown` (narduk-libs#669). This adds
 * `types/**\/*.d.ts` to all four generated configs, so that location types
 * what it says.
 */

interface TsConfigLike {
  include?: string[]
}

interface PrepareTypesContext {
  nodeTsConfig?: TsConfigLike
  sharedTsConfig?: TsConfigLike
  tsConfig?: TsConfigLike
}

interface NitroConfigLike {
  typescript?: { tsConfig?: TsConfigLike }
}

/** The `types/**\/*.d.ts` glob, relative to the build dir as the generated configs are. */
export function appTypesDirInclude(buildDir: string, rootDir: string): string {
  return relative(buildDir, join(rootDir, 'types/**/*.d.ts'))
}

function addInclude(config: TsConfigLike | undefined, entry: string): void {
  if (!config) return
  config.include ||= []
  if (!config.include.includes(entry)) config.include.push(entry)
}

export function includeAppTypesDir(nuxt: Pick<Nuxt, 'hook' | 'options'>): void {
  const entry = () => appTypesDirInclude(nuxt.options.buildDir, nuxt.options.rootDir)
  nuxt.hook('prepare:types', (context: PrepareTypesContext) => {
    addInclude(context.tsConfig, entry())
    addInclude(context.sharedTsConfig, entry())
    addInclude(context.nodeTsConfig, entry())
  })
  // `nitro:config` is declared by nitropack's augmentation, which this file
  // does not load, so the hook name is typed by hand here.
  const hookNitro = nuxt.hook.bind(nuxt) as unknown as (
    name: 'nitro:config',
    handler: (config: NitroConfigLike) => void,
  ) => unknown
  hookNitro('nitro:config', (config) => {
    config.typescript ||= {}
    config.typescript.tsConfig ||= {}
    addInclude(config.typescript.tsConfig, entry())
  })
}
