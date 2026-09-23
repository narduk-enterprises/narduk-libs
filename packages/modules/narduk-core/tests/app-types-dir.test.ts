import { describe, expect, it } from 'vitest'

import { appTypesDirInclude, includeAppTypesDir } from '../src/app-types-dir'

import type { Nuxt } from '@nuxt/schema'

type Handler = (value: never) => void
const TYPES_GLOB = '../types/**/*.d.ts'

function fakeNuxt(rootDir = '/repo/apps/web', buildDir = '/repo/apps/web/.nuxt') {
  const hooks = new Map<string, Handler>()
  return {
    hooks,
    nuxt: {
      hook: (name: string, handler: Handler) => hooks.set(name, handler),
      options: { buildDir, rootDir },
    } as unknown as Pick<Nuxt, 'hook' | 'options'>,
  }
}

describe('types/ joins the generated tsconfigs (narduk-libs#669)', () => {
  it('names types/**/*.d.ts relative to the build dir', () => {
    expect(appTypesDirInclude('/repo/apps/web/.nuxt', '/repo/apps/web')).toBe(TYPES_GLOB)
    expect(appTypesDirInclude('/tmp/build', '/repo/apps/web')).toBe(
      '../../repo/apps/web/types/**/*.d.ts',
    )
  })

  it('adds it to the app, shared and node configs, once', () => {
    const { hooks, nuxt } = fakeNuxt()
    includeAppTypesDir(nuxt)
    const context = {
      nodeTsConfig: {},
      sharedTsConfig: { include: ['../shared/**/*.d.ts'] },
      tsConfig: { include: ['../app/**/*', TYPES_GLOB] },
    }

    ;(hooks.get('prepare:types') as (value: typeof context) => void)(context)

    expect(context.tsConfig.include).toEqual(['../app/**/*', TYPES_GLOB])
    expect(context.sharedTsConfig.include).toEqual(['../shared/**/*.d.ts', TYPES_GLOB])
    expect(context.nodeTsConfig).toEqual({ include: [TYPES_GLOB] })
  })

  it('adds it to the server config Nitro generates', () => {
    const { hooks, nuxt } = fakeNuxt()
    includeAppTypesDir(nuxt)
    const empty: { typescript?: { tsConfig?: { include?: string[] } } } = {}
    const existing = { typescript: { tsConfig: { include: ['../server/**/*'] } } }

    const nitroConfig = hooks.get('nitro:config') as (value: object) => void
    nitroConfig(empty)
    nitroConfig(existing)

    expect(empty.typescript?.tsConfig?.include).toEqual([TYPES_GLOB])
    expect(existing.typescript.tsConfig.include).toEqual(['../server/**/*', TYPES_GLOB])
  })
})
