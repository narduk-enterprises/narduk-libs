import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildWorkerEntrySource,
  createWorkerEntryHook,
  UPGRADE_ROUTER_MODULE,
  WORKER_ENTRY_FILENAME,
} from '../src/worker-entry.js'
import type { NitroEntryContext, RollupEntryConfig } from '../src/worker-entry.js'

const temporaryDirectories: string[] = []

const CLOUDFLARE_ENTRY =
  '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs'
const PRERENDER_ENTRY = '/app/node_modules/nitropack/dist/runtime/entries/nitro-prerenderer.mjs'

async function makeBuildDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'narduk-realtime-'))
  temporaryDirectories.push(directory)
  return directory
}

function nitro(entry: string, buildDir: string): NitroEntryContext {
  return { options: { buildDir, entry } }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('worker entry hook', () => {
  it('writes the generated entry and repoints rollup for the Cloudflare preset build', async () => {
    const buildDir = await makeBuildDir()
    const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }

    createWorkerEntryHook([
      { className: 'VesselDO', modulePath: '/app/server/durable/vessel-do.ts' },
    ])(nitro(CLOUDFLARE_ENTRY, join(buildDir, 'nested')), rollupConfig)

    const entryPath = join(buildDir, 'nested', WORKER_ENTRY_FILENAME)
    expect(rollupConfig.input).toBe(entryPath)
    expect(await readFile(entryPath, 'utf8')).toBe(
      [
        `export { default } from "${CLOUDFLARE_ENTRY}"`,
        'export { VesselDO } from "/app/server/durable/vessel-do.ts"',
        '',
      ].join('\n'),
    )
  })

  // Nuxt builds Nitro twice. The prerenderer entry has no default export, so
  // re-exporting `default` from it fails the build -- the marker guard is the
  // whole reason this hook is not simply unconditional.
  it('leaves the prerenderer build untouched', async () => {
    const buildDir = await makeBuildDir()
    const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }

    createWorkerEntryHook([
      { className: 'VesselDO', modulePath: '/app/server/durable/vessel-do.ts' },
    ])(nitro(PRERENDER_ENTRY, buildDir), rollupConfig)

    expect(rollupConfig.input).toBe('/original/input.mjs')
    expect(existsSync(join(buildDir, WORKER_ENTRY_FILENAME))).toBe(false)
  })

  it('is a no-op when no Durable Objects are declared', async () => {
    const buildDir = await makeBuildDir()
    const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }

    createWorkerEntryHook([])(nitro(CLOUDFLARE_ENTRY, buildDir), rollupConfig)

    expect(rollupConfig.input).toBe('/original/input.mjs')
    expect(existsSync(join(buildDir, WORKER_ENTRY_FILENAME))).toBe(false)
  })

  it('emits one re-export per class alongside the default handler', () => {
    expect(
      buildWorkerEntrySource('/nitro/entry.mjs', [
        { className: 'FleetDO', modulePath: '/app/server/durable/fleet.ts' },
        { className: 'VesselDO', modulePath: '/app/server/durable/vessel.ts' },
      ]),
    ).toBe(
      [
        'export { default } from "/nitro/entry.mjs"',
        'export { FleetDO } from "/app/server/durable/fleet.ts"',
        'export { VesselDO } from "/app/server/durable/vessel.ts"',
        '',
      ].join('\n'),
    )
  })

  it('escapes paths that would otherwise break the generated module', () => {
    expect(
      buildWorkerEntrySource('/nitro/entry.mjs', [
        { className: 'QuoteDO', modulePath: '/app/server/it\'s "quoted".ts' },
      ]),
    ).toContain('export { QuoteDO } from "/app/server/it\'s \\"quoted\\".ts"')
  })
})

describe('worker entry upgrade router wiring', () => {
  const VESSEL_UPGRADE = {
    path: '/api/app/vessels/:vesselId/live',
    binding: 'VESSEL_DO',
    idFrom: 'vesselId',
    forwardHeaders: ['cf-connecting-ip'],
    authorizeModulePath: '/app/server/upgrades/vessel-live.ts',
  }

  // The 0.1.0 shape, unchanged: an app that declares no upgrade must not import
  // the router, `nitropack/runtime`, or anything else new.
  it('emits the plain re-export when no upgrade is declared', () => {
    const source = buildWorkerEntrySource('/nitro/entry.mjs', [
      { className: 'VesselDO', modulePath: '/app/server/durable/vessel.ts' },
    ])

    expect(source).toBe(
      [
        'export { default } from "/nitro/entry.mjs"',
        'export { VesselDO } from "/app/server/durable/vessel.ts"',
        '',
      ].join('\n'),
    )
    expect(source).not.toContain('createUpgradeRouter')
    expect(source).not.toContain('nitropack/runtime')
  })

  it('wraps the Nitro handler and configures every declared upgrade', () => {
    expect(
      buildWorkerEntrySource(
        '/nitro/entry.mjs',
        [{ className: 'VesselDO', modulePath: '/app/server/durable/vessel.ts' }],
        [VESSEL_UPGRADE],
      ),
    ).toBe(
      [
        'import { useNitroApp } from "nitropack/runtime"',
        `import { createUpgradeRouter, withUpgradeRouter } from "${UPGRADE_ROUTER_MODULE}"`,
        'import nardukRealtimeHandler from "/nitro/entry.mjs"',
        'import nardukRealtimeAuthorize0 from "/app/server/upgrades/vessel-live.ts"',
        'export { VesselDO } from "/app/server/durable/vessel.ts"',
        '',
        'const nardukRealtimeRouter = createUpgradeRouter({',
        '  localFetch: (path, init) => useNitroApp().localFetch(path, init),',
        '  upgrades: [',
        '    {',
        '      path: "/api/app/vessels/:vesselId/live",',
        '      binding: "VESSEL_DO",',
        '      idFrom: "vesselId",',
        '      forwardHeaders: ["cf-connecting-ip"],',
        '      authorize: nardukRealtimeAuthorize0,',
        '    },',
        '  ],',
        '})',
        '',
        'export default withUpgradeRouter(nardukRealtimeHandler, nardukRealtimeRouter)',
        '',
      ].join('\n'),
    )
  })

  it('omits the authorize key and its import for a route without an authoriser', () => {
    const source = buildWorkerEntrySource(
      '/nitro/entry.mjs',
      [],
      [
        {
          path: '/api/edge/v1/session',
          binding: 'FLEET_DO',
          idFrom: 'name:fleet',
          forwardHeaders: [],
        },
      ],
    )

    expect(source).not.toContain('nardukRealtimeAuthorize')
    expect(source).toContain('      idFrom: "name:fleet",')
    expect(source).toContain('      forwardHeaders: [],')
  })

  it('numbers one authoriser import per route that has one', () => {
    const source = buildWorkerEntrySource(
      '/nitro/entry.mjs',
      [],
      [
        { path: '/api/a/:id', binding: 'A_DO', idFrom: 'id', forwardHeaders: [] },
        { ...VESSEL_UPGRADE, path: '/api/b/:id', idFrom: 'id' },
      ],
    )

    expect(source).toContain(
      'import nardukRealtimeAuthorize1 from "/app/server/upgrades/vessel-live.ts"',
    )
    expect(source).not.toContain('nardukRealtimeAuthorize0')
    expect(source).toContain('      authorize: nardukRealtimeAuthorize1,')
  })

  // An app can declare an upgrade without exporting any class of its own (the
  // object may live in a package), so the hook must still write the entry.
  it('writes the entry for an upgrade-only configuration', async () => {
    const buildDir = await makeBuildDir()
    const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }

    createWorkerEntryHook([], [VESSEL_UPGRADE])(nitro(CLOUDFLARE_ENTRY, buildDir), rollupConfig)

    const entryPath = join(buildDir, WORKER_ENTRY_FILENAME)
    expect(rollupConfig.input).toBe(entryPath)
    expect(await readFile(entryPath, 'utf8')).toContain('createUpgradeRouter({')
  })

  it('leaves the prerenderer build untouched for an upgrade-only configuration', async () => {
    const buildDir = await makeBuildDir()
    const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }

    createWorkerEntryHook([], [VESSEL_UPGRADE])(nitro(PRERENDER_ENTRY, buildDir), rollupConfig)

    expect(rollupConfig.input).toBe('/original/input.mjs')
    expect(existsSync(join(buildDir, WORKER_ENTRY_FILENAME))).toBe(false)
  })

  it('escapes an authoriser path that would otherwise break the generated module', () => {
    expect(
      buildWorkerEntrySource(
        '/nitro/entry.mjs',
        [],
        [{ ...VESSEL_UPGRADE, authorizeModulePath: '/app/it\'s "quoted".ts' }],
      ),
    ).toContain('import nardukRealtimeAuthorize0 from "/app/it\'s \\"quoted\\".ts"')
  })
})
