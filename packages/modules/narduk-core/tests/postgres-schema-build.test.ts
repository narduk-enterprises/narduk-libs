/**
 * narduk-libs#1953, proved on real builds: `nardukCore.postgresSchema` reaches
 * the Nitro bundle's Drizzle tables.
 *
 * `runtime/server/database/pg-table.ts` imports the name from
 * `#narduk-core/postgres-schema`, an alias the module points at the static
 * `public` module or, for a named schema, at a generated file. Unit tests cannot
 * show what Nitro's bundler resolves it to, so this builds `fixtures/postgres-schema-app` twice (default, then `narduk`),
 * runs each server bundle and asks it which schema its `api_keys` table is in.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/postgres-schema-app')
const require = createRequire(fileURLToPath(import.meta.url))
const nuxtManifestPath = require.resolve('nuxt/package.json')
const nuxtBinField = (
  JSON.parse(readFileSync(nuxtManifestPath, 'utf8')) as { bin?: { nuxt?: string } }
).bin?.nuxt
if (!nuxtBinField) throw new Error('nuxt package.json has no bin.nuxt')
const nuxtBin = join(dirname(nuxtManifestPath), nuxtBinField)

function run(args: string[], env: Record<string, string>, ready?: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: fixtureRoot,
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', ...env },
    })
    let log = ''
    const onData = (chunk: Buffer) => {
      log += chunk.toString()
      if (ready?.test(log)) resolve(log)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (ready) reject(new Error(`server exited ${code} before it was ready\n${log}`))
      else if (code === 0) resolve(log)
      else reject(new Error(`${args.join(' ')} exited ${code}\n${log}`))
    })
    if (ready) servers.push(child)
  })
}

const servers: Array<ReturnType<typeof spawn>> = []

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function tableSchemaOf(name: string, env: Record<string, string>) {
  const outDir = `.output/${name}`
  await run([nuxtBin, 'build'], { FIXTURE_OUT_DIR: outDir, ...env })
  const port = await freePort()
  await run(
    [join(fixtureRoot, outDir, 'output/server/index.mjs')],
    {
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(port),
    },
    /Listening/u,
  )
  const response = await fetch(`http://127.0.0.1:${port}/api/table-schema`)
  return (await response.json()) as { schema: string; table: string }
}

describe('postgresSchema in a real Nitro bundle', () => {
  it('keeps api_keys in public by default and moves it to the named schema', async () => {
    try {
      const [defaults, named] = await Promise.all([
        tableSchemaOf('default', {}),
        tableSchemaOf('narduk', { FIXTURE_SCHEMA: 'narduk' }),
      ])
      expect(defaults).toEqual({ schema: 'public', table: 'api_keys' })
      expect(named).toEqual({ schema: 'narduk', table: 'api_keys' })
    } finally {
      for (const child of servers) child.kill()
    }
  }, 240_000)
})
