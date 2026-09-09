import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installDurableObjectExports } from '../src/setup.js'
import type { NitroHookHost, NuxtHookRegistry } from '../src/setup.js'
import type { NitroEntryContext, RollupEntryConfig } from '../src/worker-entry.js'
import { WORKER_ENTRY_FILENAME } from '../src/worker-entry.js'

const CLOUDFLARE_ENTRY =
  '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs'

let rootDir = ''

/** Records hook registrations and can drive them like Nuxt and Nitro would. */
function fakeNuxtHooks() {
  const nitroInit: Array<(nitro: NitroHookHost) => void> = []
  const rollupBefore: Array<(nitro: NitroEntryContext, config: RollupEntryConfig) => void> = []

  const registry: NuxtHookRegistry = {
    hook(name, handler) {
      expect(name).toBe('nitro:init')
      nitroInit.push(handler)
    },
  }

  const nitro: NitroHookHost = {
    hooks: {
      hook(name, handler) {
        expect(name).toBe('rollup:before')
        rollupBefore.push(handler)
      },
    },
  }

  return {
    nitroInit,
    registry,
    rollupBefore,
    runBuild(entry: string, buildDir: string): RollupEntryConfig {
      for (const handler of nitroInit) handler(nitro)
      const rollupConfig: RollupEntryConfig = { input: '/original/input.mjs' }
      for (const handler of rollupBefore) handler({ options: { buildDir, entry } }, rollupConfig)
      return rollupConfig
    },
  }
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'narduk-realtime-app-'))
  await mkdir(join(rootDir, 'server/durable'), { recursive: true })
  await writeFile(join(rootDir, 'server/durable/vessel-do.ts'), 'export class VesselDO {}\n')
})

afterEach(async () => {
  await rm(rootDir, { force: true, recursive: true })
})

describe('installDurableObjectExports', () => {
  it('wires a declared Durable Object through to the generated Worker entry', async () => {
    const hooks = fakeNuxtHooks()

    const resolved = installDurableObjectExports(
      { VesselDO: './server/durable/vessel-do' },
      rootDir,
      hooks.registry,
    )

    expect(resolved).toEqual([
      { className: 'VesselDO', modulePath: join(rootDir, 'server/durable/vessel-do.ts') },
    ])
    expect(hooks.nitroInit).toHaveLength(1)

    const buildDir = join(rootDir, '.nuxt/dist/nitro')
    const rollupConfig = hooks.runBuild(CLOUDFLARE_ENTRY, buildDir)
    const entryPath = join(buildDir, WORKER_ENTRY_FILENAME)

    expect(rollupConfig.input).toBe(entryPath)
    expect(await readFile(entryPath, 'utf8')).toBe(
      [
        `export { default } from "${CLOUDFLARE_ENTRY}"`,
        `export { VesselDO } from "${join(rootDir, 'server/durable/vessel-do.ts')}"`,
        '',
      ].join('\n'),
    )
  })

  // An app that installs the module but declares nothing must not pay for a
  // build hook, and must not have its rollup input rewritten.
  it('registers no hook when nothing is declared', () => {
    const hooks = fakeNuxtHooks()

    expect(installDurableObjectExports({}, rootDir, hooks.registry)).toEqual([])
    expect(hooks.nitroInit).toHaveLength(0)

    const buildDir = join(rootDir, '.nuxt/dist/nitro')
    expect(hooks.runBuild(CLOUDFLARE_ENTRY, buildDir).input).toBe('/original/input.mjs')
    expect(existsSync(join(buildDir, WORKER_ENTRY_FILENAME))).toBe(false)
  })

  it('fails at configuration time rather than during the Cloudflare build', () => {
    const hooks = fakeNuxtHooks()

    expect(() =>
      installDurableObjectExports({ VesselDO: './server/durable/absent' }, rootDir, hooks.registry),
    ).toThrow(/does not resolve to a file/u)
    expect(hooks.nitroInit).toHaveLength(0)
  })
})
