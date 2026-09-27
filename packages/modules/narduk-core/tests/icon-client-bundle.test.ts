/**
 * narduk-libs#1195: a consumer that does not list `@nuxt/icon` still has to
 * get the client-bundle template. `@nuxt/ui` 4.11.1 does not register the
 * icon module from the app root under pnpm, and Rolldown then fails with
 * "Could not load .nuxt/nuxt-icon-client-bundle".
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/icon-client-bundle-app')
const require = createRequire(fileURLToPath(import.meta.url))
const nuxtManifestPath = require.resolve('nuxt/package.json')
const nuxtBinField = (
  JSON.parse(readFileSync(nuxtManifestPath, 'utf8')) as { bin?: { nuxt?: string } }
).bin?.nuxt
if (!nuxtBinField) throw new Error('nuxt package.json has no bin.nuxt')
const nuxtBin = join(dirname(nuxtManifestPath), nuxtBinField)

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

afterAll(() => {
  rmSync(join(fixtureRoot, '.nuxt'), { force: true, recursive: true })
  rmSync(join(fixtureRoot, '.output'), { force: true, recursive: true })
  rmSync(join(fixtureRoot, '.data'), { force: true, recursive: true })
})

describe('icon client bundle without an app-level @nuxt/icon (narduk-libs#1195)', () => {
  it('prepares the client bundle template', () => {
    const manifest = readFileSync(join(fixtureRoot, 'package.json'), 'utf8')
    expect(manifest).not.toContain('@nuxt/icon')

    const result = spawnSync(process.execPath, [nuxtBin, 'prepare'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
      timeout: 180_000,
    })
    if (result.status !== 0) {
      throw new Error(
        `nuxt prepare exited ${result.status ?? 'null'}\n${result.stdout}\n${result.stderr}`,
      )
    }

    const generated = walk(join(fixtureRoot, '.nuxt'))
    expect(generated.some((path) => path.includes('nuxt-icon-client-bundle'))).toBe(true)
  }, 180_000)
})
