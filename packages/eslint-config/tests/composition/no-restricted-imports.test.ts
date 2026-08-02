/**
 * `no-restricted-imports` must not depend on how a consumer ordered its packs.
 *
 * Flat config replaces a rule's options rather than merging them: for a given
 * file the last matching entry's `no-restricted-imports` is the *only* one that
 * applies. Three concerns land on `server/**` — the Cloudflare Node-built-in
 * ban, the server relative-import ban, and the layer-source ban.
 *
 * v2's first cut had each pack restate the bans of the packs it expected to
 * sort before it. That is correct for the orders it was written against and
 * silently wrong for the rest: the adversarial pass composed
 * `core, server, auth, template, cloudflare` — a legal array a consumer can
 * write today — and the Cloudflare pack's paths-only entry sorted last and
 * deleted the relative-import and layer-source `patterns` for every Nitro
 * handler in the app.
 *
 * All three packs now assign one shared constant
 * (`configs/restricted-imports.mjs`), so the merged option is identical under
 * every order. This suite proves that, not just that one order works.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

type RestrictedImportsOption = {
  paths?: Array<{ name: string; message?: string }>
  patterns?: Array<{ group: string[]; message?: string }>
}

type FlatConfig = {
  name?: string
  files?: string[]
  rules?: Record<string, unknown>
}

interface AppConfigModule {
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
}

let appConfig: AppConfigModule

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

/** Entries that set `no-restricted-imports` for Nitro server sources. */
function serverRestrictedImportEntries(configs: FlatConfig[]): FlatConfig[] {
  return configs.filter(
    (entry) =>
      entry.rules?.['no-restricted-imports'] !== undefined &&
      (entry.files ?? []).some((glob) => glob.includes('server/')),
  )
}

function optionOf(entry: FlatConfig): RestrictedImportsOption {
  const setting = entry.rules?.['no-restricted-imports']
  expect(Array.isArray(setting)).toBe(true)

  return (setting as [string, RestrictedImportsOption])[1] ?? {}
}

/**
 * The option ESLint itself resolves for a real server file — the thing that
 * actually decides what is banned, and the thing `--print-config` shows.
 */
async function resolvedOption(
  packs: string[],
  filePath = 'server/api/things.post.ts',
): Promise<RestrictedImportsOption> {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig: appConfig.composeSharedConfigs(...packs) as never,
  })
  const config = (await eslint.calculateConfigForFile(filePath)) as FlatConfig
  const setting = config.rules?.['no-restricted-imports'] as [string, RestrictedImportsOption]
  return setting?.[1] ?? {}
}

function restrictedNames(option: RestrictedImportsOption): string[] {
  return (option.paths ?? []).map((path) => path.name)
}

function restrictedGroups(option: RestrictedImportsOption): string[] {
  return (option.patterns ?? []).flatMap((pattern) => pattern.group)
}

describe('no-restricted-imports survives pack composition', () => {
  it('bans Node built-ins in worker files when only cloudflare is selected', () => {
    const entries = serverRestrictedImportEntries(appConfig.composeSharedConfigs('cloudflare'))

    expect(entries.length).toBeGreaterThan(0)
    expect(restrictedNames(optionOf(entries.at(-1) as FlatConfig))).toContain('node:fs')
  })

  it('keeps the Node built-in ban when server is selected', () => {
    const lastEntry = serverRestrictedImportEntries(appConfig.composeSharedConfigs('server')).at(
      -1,
    ) as FlatConfig
    const option = optionOf(lastEntry)

    expect(restrictedNames(option)).toEqual(
      expect.arrayContaining(['fs', 'node:fs', 'child_process']),
    )
    expect(restrictedGroups(option)).toEqual(expect.arrayContaining(['../*', '../**']))
  })

  it('keeps every ban when server and template are both selected', () => {
    const lastEntry = serverRestrictedImportEntries(
      appConfig.composeSharedConfigs('server', 'template'),
    ).at(-1) as FlatConfig
    const option = optionOf(lastEntry)

    // Cloudflare: Node built-ins.
    expect(restrictedNames(option)).toEqual(expect.arrayContaining(['fs', 'node:fs']))
    // Replaces narduk/no-relative-server-imports.
    expect(restrictedGroups(option)).toEqual(expect.arrayContaining(['../*', '../**']))
    // Replaces narduk/no-direct-layer-source-imports.
    expect(restrictedGroups(option)).toEqual(
      expect.arrayContaining(['**/layers/*/server/**', '**/layers/*/app/**']),
    )
  })

  it('keeps every ban in the default preset order', () => {
    const lastEntry = serverRestrictedImportEntries(appConfig.composeSharedConfigs()).at(
      -1,
    ) as FlatConfig
    const option = optionOf(lastEntry)

    expect(restrictedNames(option)).toEqual(expect.arrayContaining(['node:fs']))
    expect(restrictedGroups(option)).toEqual(
      expect.arrayContaining(['../*', '**/layers/*/server/**']),
    )
  })

  it('is not re-declared by the shared tail after the packs', () => {
    // v1 set the edge ban in the shared tail, which sorts after every pack and
    // would have replaced the pack-level bans wholesale.
    const composed = appConfig.composeSharedConfigs('server', 'template')
    const lastIndex = composed.findLastIndex(
      (entry) => entry.rules?.['no-restricted-imports'] !== undefined,
    )

    expect(composed[lastIndex]?.name).toBe('narduk/template-server')
  })
})

/**
 * ADVERSARIAL 8. The order below is the one that broke it. These assertions go
 * through ESLint's own resolver, because the failure was invisible in the
 * config array — every entry was present and correct; the *last* one simply won.
 */
describe('the merged option is order-independent', () => {
  const DEFAULT_ORDER = ['core', 'design-system', 'nuxt-ui', 'seo', 'server', 'auth', 'template']
  const ADVERSARIAL_ORDER = ['core', 'server', 'auth', 'template', 'cloudflare']

  it('resolves an identical option under both orders', async () => {
    const fromDefault = await resolvedOption(DEFAULT_ORDER)
    const fromAdversarial = await resolvedOption(ADVERSARIAL_ORDER)

    expect(fromAdversarial).toEqual(fromDefault)
  })

  it('keeps all three ban families under the adversarial order', async () => {
    const option = await resolvedOption(ADVERSARIAL_ORDER)

    expect(restrictedNames(option)).toEqual(
      expect.arrayContaining(['fs', 'node:fs', 'child_process', 'node:worker_threads']),
    )
    expect(restrictedGroups(option)).toEqual(
      expect.arrayContaining(['../*', '../**', '**/layers/*/server/**', '**/layers/*/app/**']),
    )
  })

  it('is order-independent for every permutation of the three contributing packs', async () => {
    const permutations = [
      ['cloudflare', 'server', 'template'],
      ['cloudflare', 'template', 'server'],
      ['server', 'cloudflare', 'template'],
      ['server', 'template', 'cloudflare'],
      ['template', 'cloudflare', 'server'],
      ['template', 'server', 'cloudflare'],
    ]

    const resolved = await Promise.all(permutations.map((packs) => resolvedOption(packs)))

    for (const option of resolved) {
      expect(option).toEqual(resolved[0])
    }
  })

  it('applies at a nested server tree too', async () => {
    const nested = await resolvedOption(ADVERSARIAL_ORDER, 'apps/web/server/api/things.post.ts')
    const root = await resolvedOption(ADVERSARIAL_ORDER)

    expect(nested).toEqual(root)
    expect(restrictedGroups(nested)).toEqual(expect.arrayContaining(['../*']))
  })
})
