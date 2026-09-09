import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildWorkerEntrySource,
  createWorkerEntryHook,
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
