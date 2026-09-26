import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { inferUpgradeProfile, upgradeNardukApp } from '../src/index.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function checkout(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-checkout-'))
  tempDirectories.push(directory)
  return directory
}

async function write(directory: string, path: string, contents: string): Promise<void> {
  const absolute = join(directory, path)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

function packageJson(scripts: Record<string, string>): string {
  return JSON.stringify({ name: 'gonogo', private: true, scripts }, null, 2) + '\n'
}

describe('upgrade checkout inference', () => {
  it('reads a root app dev port and does not call a web package', async () => {
    const targetDir = await checkout()
    await write(
      targetDir,
      'nuxt.config.ts',
      'export default defineNuxtConfig({ devServer: { port: 8787 } })\n',
    )
    await write(
      targetDir,
      'wrangler.jsonc',
      JSON.stringify(
        { name: 'gonogo', d1_databases: [{ binding: 'DB', database_name: 'gonogo-db' }] },
        null,
        2,
      ) + '\n',
    )
    await write(
      targetDir,
      'package.json',
      packageJson({
        build: 'nuxt build',
        'db:migrate:remote': 'wrangler d1 migrations apply gonogo-db --remote',
      }),
    )

    const profile = await inferUpgradeProfile(targetDir)
    expect(profile.localPort).toBe(8787)
    expect(profile.databaseBackend).toBe('d1')
    expect(profile.notes.join(' ')).toContain('root Nuxt app')

    const report = await upgradeNardukApp({
      only: ['package.json'],
      targetDir,
      write: true,
    })
    const scripts = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')).scripts
    expect(scripts['db:migrate:local']).toBe('wrangler d1 migrations apply gonogo-db --local')
    expect(scripts['db:migrate:remote']).toBe('wrangler d1 migrations apply gonogo-db --remote')
    expect(JSON.stringify(scripts)).not.toContain('--filter web')
    expect(scripts['build:ci']).not.toContain('NUXT_SESSION_PASSWORD')
    expect(report.changes.find((change) => change.path === 'package.json')?.detail).not.toContain(
      'db:migrate:remote',
    )
  })

  it('leaves a working migrate command alone when the web package has no db script', async () => {
    const targetDir = await checkout()
    const command =
      'pnpm -C apps/web exec narduk-app db migrate --config migrations.sources.json --database riverstatus-db --local'
    await write(targetDir, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
    await write(
      targetDir,
      'apps/web/package.json',
      JSON.stringify({ name: 'web', scripts: { build: 'nuxt build' } }, null, 2) + '\n',
    )
    await write(
      targetDir,
      'apps/web/wrangler.json',
      JSON.stringify(
        { name: 'riverstatus', d1_databases: [{ binding: 'DB', database_name: 'riverstatus-db' }] },
        null,
        2,
      ),
    )
    await write(
      targetDir,
      'package.json',
      packageJson({ build: 'pnpm --filter web run build', 'db:migrate:local': command }),
    )

    await upgradeNardukApp({ only: ['package.json'], targetDir, write: true })
    const scripts = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')).scripts
    expect(scripts['db:migrate:local']).toBe(command)
    expect(scripts['db:migrate:remote']).toBeUndefined()
    expect(scripts['build:ci']).not.toContain('NUXT_SESSION_PASSWORD')
  })

  it('infers database none when neither manifest binds D1', async () => {
    const targetDir = await checkout()
    await write(targetDir, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
    await write(
      targetDir,
      'apps/web/wrangler.json',
      JSON.stringify({ name: 'borderwaitstat' }, null, 2),
    )
    await write(
      targetDir,
      'Config/cloudflare-app.json',
      JSON.stringify({ bindings: { d1: [] } }, null, 2),
    )
    await write(targetDir, 'package.json', packageJson({ build: 'pnpm --filter web run build' }))

    const profile = await inferUpgradeProfile(targetDir)
    expect(profile.databaseBackend).toBe('none')
    expect(profile.inferred).toContain('databaseBackend')

    await upgradeNardukApp({ only: ['package.json'], targetDir, write: true })
    const scripts = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')).scripts
    expect(scripts['db:migrate:local']).toBeUndefined()
    expect(scripts['db:migrate:remote']).toBeUndefined()
  })

  it('edits the wrangler file the checkout has, including wrangler.json', async () => {
    const targetDir = await checkout()
    await write(targetDir, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
    await write(
      targetDir,
      'Config/project-lifecycle.json',
      JSON.stringify({ nativeManifests: { wrangler: 'apps/web/wrangler.json' } }, null, 2),
    )
    await write(
      targetDir,
      'apps/web/wrangler.json',
      JSON.stringify(
        { name: 'borderwaitstat', vars: { SITE: 'https://borderwaitstat.us' } },
        null,
        2,
      ) + '\n',
    )
    await write(targetDir, 'package.json', packageJson({ build: 'pnpm --filter web run build' }))

    const report = await upgradeNardukApp({ targetDir, write: true })
    const change = report.changes.find((entry) => entry.path === 'apps/web/wrangler.json')
    expect(change?.status).toBe('drift')
    expect(report.changes.some((entry) => entry.path === 'apps/web/wrangler.jsonc')).toBe(false)
    const wrangler = JSON.parse(await readFile(join(targetDir, 'apps/web/wrangler.json'), 'utf8'))
    expect(wrangler.cache).toEqual({ enabled: true })
    expect(wrangler.vars).toEqual({ SITE: 'https://borderwaitstat.us' })
  })
})
