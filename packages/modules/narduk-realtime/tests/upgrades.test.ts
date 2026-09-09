import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NardukRealtimeConfigurationError, resolveUpgrades } from '../src/options.js'
import type { NardukRealtimeUpgrade } from '../src/options.js'
import { installRealtimeWorkerEntry } from '../src/setup.js'
import type { NitroHookHost, NuxtHookRegistry } from '../src/setup.js'
import { WORKER_ENTRY_FILENAME } from '../src/worker-entry.js'
import type { NitroEntryContext, RollupEntryConfig } from '../src/worker-entry.js'

const CLOUDFLARE_ENTRY =
  '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs'

let rootDir = ''

function live(overrides: Partial<NardukRealtimeUpgrade> = {}): NardukRealtimeUpgrade {
  return {
    path: '/api/app/vessels/:vesselId/live',
    binding: 'VESSEL_DO',
    idFrom: 'vesselId',
    ...overrides,
  }
}

/** Records hook registrations and can drive them like Nuxt and Nitro would. */
function fakeNuxtHooks() {
  const nitroInit: Array<(nitro: NitroHookHost) => void> = []
  const rollupBefore: Array<(nitro: NitroEntryContext, config: RollupEntryConfig) => void> = []

  const nitro: NitroHookHost = {
    hooks: {
      hook(_name, handler) {
        rollupBefore.push(handler)
      },
    },
  }

  return {
    nitroInit,
    registry: {
      hook(_name, handler) {
        nitroInit.push(handler)
      },
    } satisfies NuxtHookRegistry,
    runBuild(buildDir: string, entry = CLOUDFLARE_ENTRY): RollupEntryConfig {
      for (const handler of nitroInit) handler(nitro)
      const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }
      for (const handler of rollupBefore) handler({ options: { buildDir, entry } }, rollupConfig)
      return rollupConfig
    },
  }
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'narduk-realtime-upgrades-'))
  await mkdir(join(rootDir, 'server/upgrades'), { recursive: true })
  await mkdir(join(rootDir, 'server/durable'), { recursive: true })
  await writeFile(join(rootDir, 'server/upgrades/vessel-live.ts'), 'export default () => {}\n')
  await writeFile(join(rootDir, 'server/durable/vessel-do.ts'), 'export class VesselDO {}\n')
})

afterEach(async () => {
  await rm(rootDir, { force: true, recursive: true })
})

describe('resolveUpgrades', () => {
  it('resolves a route, its authoriser module and its forwarded headers', () => {
    expect(
      resolveUpgrades(
        [
          live({
            authorize: './server/upgrades/vessel-live',
            forwardHeaders: ['CF-Connecting-IP'],
          }),
        ],
        rootDir,
      ),
    ).toEqual([
      {
        path: '/api/app/vessels/:vesselId/live',
        binding: 'VESSEL_DO',
        idFrom: 'vesselId',
        forwardHeaders: ['cf-connecting-ip'],
        authorizeModulePath: join(rootDir, 'server/upgrades/vessel-live.ts'),
      },
    ])
  })

  it('accepts a fixed object name and a parameterless path', () => {
    expect(
      resolveUpgrades(
        [{ path: '/api/edge/v1/session', binding: 'FLEET_DO', idFrom: 'name:fleet' }],
        rootDir,
      ),
    ).toEqual([
      {
        path: '/api/edge/v1/session',
        binding: 'FLEET_DO',
        idFrom: 'name:fleet',
        forwardHeaders: [],
      },
    ])
  })

  it('preserves declaration order, because the first match wins at runtime', () => {
    expect(
      resolveUpgrades(
        [live({ path: '/api/b/:id', idFrom: 'id' }), live({ path: '/api/a/:id', idFrom: 'id' })],
        rootDir,
      ).map(({ path }) => path),
    ).toEqual(['/api/b/:id', '/api/a/:id'])
  })

  it('returns nothing for an absent or empty option', () => {
    expect(resolveUpgrades(undefined, rootDir)).toEqual([])
    expect(resolveUpgrades([], rootDir)).toEqual([])
  })

  it('deduplicates forwardHeaders case-insensitively', () => {
    expect(
      resolveUpgrades([live({ forwardHeaders: ['Cookie', 'cookie'] })], rootDir)[0]?.forwardHeaders,
    ).toEqual(['cookie'])
  })

  it.each([
    ['a wildcard path', live({ path: '/api/**' }), /wildcard/u],
    ['a relative path', live({ path: 'api/live' }), /starting with "\/"/u],
    ['an empty path', live({ path: '  ' }), /realtime\.upgrades\[0\]\.path needs a value/u],
    ['a bad binding', live({ binding: 'vessel-do' }), /not a valid binding name/u],
    ['an empty binding', live({ binding: '' }), /binding needs a value/u],
    ['an undeclared idFrom', live({ idFrom: 'orgId' }), /which the route path does not declare/u],
    ['an empty name: literal', live({ idFrom: 'name:' }), /no name after the prefix/u],
    [
      'a missing authoriser',
      live({ authorize: './server/upgrades/absent' }),
      /does not resolve to a file/u,
    ],
    [
      'a non-array forwardHeaders',
      live({ forwardHeaders: 'cookie' as unknown as string[] }),
      /must be an array/u,
    ],
    [
      'a non-header forwardHeaders entry',
      live({ forwardHeaders: ['not a header'] }),
      /is not a header name/u,
    ],
  ])('rejects %s', (_case, upgrade, message) => {
    expect(() => resolveUpgrades([upgrade], rootDir)).toThrow(NardukRealtimeConfigurationError)
    expect(() => resolveUpgrades([upgrade], rootDir)).toThrow(message)
  })

  // Only the first would ever match, so the second is dead configuration.
  it('rejects the same path declared twice', () => {
    expect(() => resolveUpgrades([live(), live()], rootDir)).toThrow(/is declared twice/u)
  })

  // The router strips this prefix from every inbound request so a Durable
  // Object can trust what it finds there. Forwarding one back in would hand
  // that channel to whoever set the header.
  it("refuses to forward a header in the router's own prefix", () => {
    expect(() =>
      resolveUpgrades([live({ forwardHeaders: ['x-narduk-principal'] })], rootDir),
    ).toThrow(/trust channel/u)
  })

  it.each([
    ['a non-array option', 'nope' as unknown as NardukRealtimeUpgrade[], /must be an array/u],
    ['a non-object entry', ['nope'] as unknown as NardukRealtimeUpgrade[], /must be an object/u],
    ['a null entry', [null] as unknown as NardukRealtimeUpgrade[], /must be an object/u],
  ])('rejects %s', (_case, upgrades, message) => {
    expect(() => resolveUpgrades(upgrades, rootDir)).toThrow(message)
  })

  it('names the failing entry by index', () => {
    expect(() => resolveUpgrades([live(), live({ path: '/api/**' })], rootDir)).toThrow(
      /realtime\.upgrades\[1\]\.path/u,
    )
  })
})

describe('installRealtimeWorkerEntry', () => {
  it('writes an entry carrying the router when only an upgrade is declared', async () => {
    const hooks = fakeNuxtHooks()

    const installed = installRealtimeWorkerEntry({
      upgrades: [live({ authorize: './server/upgrades/vessel-live' })],
      rootDir,
      hooks: hooks.registry,
    })

    expect(installed.durableObjects).toEqual([])
    expect(installed.upgrades).toHaveLength(1)

    const buildDir = join(rootDir, '.nuxt/dist/nitro')
    expect(hooks.runBuild(buildDir).input).toBe(join(buildDir, WORKER_ENTRY_FILENAME))

    const generated = await readFile(join(buildDir, WORKER_ENTRY_FILENAME), 'utf8')
    expect(generated).toContain('withUpgradeRouter(nardukRealtimeHandler, nardukRealtimeRouter)')
    expect(generated).toContain(join(rootDir, 'server/upgrades/vessel-live.ts'))
  })

  it('wires Durable Object exports and upgrades together', async () => {
    const hooks = fakeNuxtHooks()

    installRealtimeWorkerEntry({
      durableObjects: { VesselDO: './server/durable/vessel-do' },
      upgrades: [live()],
      rootDir,
      hooks: hooks.registry,
    })

    const buildDir = join(rootDir, '.nuxt/dist/nitro')
    hooks.runBuild(buildDir)
    const generated = await readFile(join(buildDir, WORKER_ENTRY_FILENAME), 'utf8')

    expect(generated).toContain(
      `export { VesselDO } from "${join(rootDir, 'server/durable/vessel-do.ts')}"`,
    )
    expect(generated).toContain('createUpgradeRouter({')
    expect(hooks.nitroInit).toHaveLength(1)
  })

  it('registers no hook when neither option is declared', () => {
    const hooks = fakeNuxtHooks()

    expect(installRealtimeWorkerEntry({ rootDir, hooks: hooks.registry })).toEqual({
      durableObjects: [],
      upgrades: [],
    })
    expect(hooks.nitroInit).toHaveLength(0)
  })

  it('fails at configuration time rather than during the Cloudflare build', () => {
    const hooks = fakeNuxtHooks()

    expect(() =>
      installRealtimeWorkerEntry({
        upgrades: [live({ idFrom: 'orgId' })],
        rootDir,
        hooks: hooks.registry,
      }),
    ).toThrow(NardukRealtimeConfigurationError)
    expect(hooks.nitroInit).toHaveLength(0)
  })
})
