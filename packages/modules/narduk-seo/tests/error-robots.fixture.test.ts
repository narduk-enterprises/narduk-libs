import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = join(packageRoot, 'tests', 'fixtures', 'error-robots')
const port = 7000 + Math.floor(Math.random() * 1000)

function writeFixture(): void {
  rmSync(fixtureRoot, { force: true, recursive: true })
  const authStub = join(fixtureRoot, 'stubs', 'auth.ts')
  mkdirSync(join(fixtureRoot, 'app', 'pages'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'stubs'), { recursive: true })
  writeFileSync(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'error-robots-fixture', private: true, type: 'module' }),
  )
  writeFileSync(
    join(fixtureRoot, 'nuxt.config.ts'),
    `export default defineNuxtConfig({
  compatibilityDate: '2026-09-26',
  alias: { '#layer/server/utils/auth': ${JSON.stringify(authStub)} },
  modules: [${JSON.stringify(join(packageRoot, 'src', 'module.ts'))}],
  ogImage: { enabled: false },
  site: { url: 'https://example.com', indexable: true },
  nitro: { preset: 'node-server' },
})
`,
  )
  writeFileSync(authStub, 'export async function requireAdmin(_event: unknown): Promise<void> {}\n')
  writeFileSync(join(fixtureRoot, 'app', 'app.vue'), '<template><NuxtPage /></template>\n')
  writeFileSync(
    join(fixtureRoot, 'app', 'pages', 'index.vue'),
    '<template><p>home</p></template>\n',
  )
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`server at ${url} did not start`)
}

describe('error responses never advertise index (narduk-libs#1415)', () => {
  let server: ChildProcess | undefined

  afterAll(() => {
    server?.kill()
    rmSync(fixtureRoot, { force: true, recursive: true })
  })

  it('sends noindex on a 404 page and a 404 API route, index on a 200 page', async () => {
    writeFixture()
    const env = { ...process.env, NUXT_TELEMETRY_DISABLED: '1' }
    delete env.NUXT_OG_IMAGE_SECRET
    delete env.WORKERS_CI
    execFileSync(join(packageRoot, 'node_modules', '.bin', 'nuxt'), ['build'], {
      cwd: fixtureRoot,
      env,
      stdio: 'ignore',
    })

    server = spawn(process.execPath, [join(fixtureRoot, '.output', 'server', 'index.mjs')], {
      env: { ...env, PORT: String(port) },
      stdio: 'ignore',
    })
    const origin = `http://127.0.0.1:${port}`
    await waitForServer(`${origin}/robots.txt`)

    const missingPage = await fetch(`${origin}/definitely-missing`)
    expect(missingPage.status).toBe(404)
    expect(missingPage.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    const missingApi = await fetch(`${origin}/api/definitely-missing`)
    expect(missingApi.status).toBe(404)
    expect(missingApi.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    const home = await fetch(`${origin}/`)
    expect(home.status).toBe(200)
    expect(home.headers.get('x-robots-tag')).toMatch(/^index, follow/)
  }, 360_000)
})
