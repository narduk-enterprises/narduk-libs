import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = join(packageRoot, 'tests', 'fixtures', 'og-image-runtime-secret')
const RUNTIME_SECRET = 'runtime-only-og-secret-for-fixture'

interface OgImageUrlEncoding {
  verifyOgImageSignature: (encoded: string, signature: string, secret: string) => boolean
}

// Same loader as `og-image-prerender-signing.test.ts`: the pinned release's own
// verifier, so the signature is checked exactly as nuxt-og-image checks it.
async function loadOgImageUrlEncoding(): Promise<OgImageUrlEncoding> {
  const ogImageRoot = realpathSync(join(packageRoot, 'node_modules', 'nuxt-og-image'))
  const modulePath = join(ogImageRoot, 'dist', 'runtime', 'shared', 'urlEncoding.js')
  return (await import(pathToFileURL(modulePath).href)) as OgImageUrlEncoding
}

/** A build with none of the deploy or secret signals a CI runner lacks. */
function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, NUXT_TELEMETRY_DISABLED: '1' }
  delete env.NUXT_OG_IMAGE_SECRET
  delete env.NARDUK_CLOUDFLARE_BUILD
  delete env.WORKERS_CI
  delete env.WORKERS_CI_BRANCH
  delete env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY
  return env
}

function writeFixture(): void {
  rmSync(fixtureRoot, { force: true, recursive: true })
  mkdirSync(join(fixtureRoot, 'app', 'pages'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'stubs'), { recursive: true })
  const seoModule = join(packageRoot, 'src', 'module.ts')
  const authStub = join(fixtureRoot, 'stubs', 'auth.ts')
  writeFileSync(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'og-image-runtime-secret-fixture', private: true, type: 'module' }),
  )
  writeFileSync(
    join(fixtureRoot, 'nuxt.config.ts'),
    `export default defineNuxtConfig({
  compatibilityDate: '2026-09-26',
  buildDir: '.nuxt',
  alias: { '#layer/server/utils/auth': ${JSON.stringify(authStub)} },
  modules: [${JSON.stringify(seoModule)}],
  site: { url: 'http://localhost', name: 'Fixture' },
  nitro: { preset: 'node-server' },
  ssr: true,
})
`,
  )
  writeFileSync(authStub, 'export async function requireAdmin(_event: unknown): Promise<void> {}\n')
  writeFileSync(join(fixtureRoot, 'app', 'app.vue'), '<template><NuxtPage /></template>\n')
  writeFileSync(
    join(fixtureRoot, 'app', 'pages', 'index.vue'),
    `<script setup lang="ts">
useSeo({ title: 'Runtime secret', description: 'Signed at request time' })
</script>
<template><p>runtime secret</p></template>
`,
  )
}

function buildFixture(): { output: string; status: number } {
  const nuxtBin = join(packageRoot, 'node_modules', '.bin', 'nuxt')
  try {
    const output = execFileSync(nuxtBin, ['build'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { output, status: 0 }
  } catch (error) {
    const failed = error as { status?: number; stderr?: string; stdout?: string }
    return { output: `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`, status: failed.status ?? 1 }
  }
}

/** The bundled runtime config: the chunk that carries nuxt-og-image's security block. */
function readBundledRuntimeConfig(): string {
  const chunks = join(fixtureRoot, '.output', 'server', 'chunks')
  for (const entry of readdirSync(chunks, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.mjs')) continue
    const source = readFileSync(join(chunks, entry), 'utf8')
    if (source.includes('"restrictRuntimeImagesToOrigin"')) return source
  }
  throw new Error('bundled nuxt-og-image runtime config not found')
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

interface RunningServer {
  child: ChildProcess
  logs: () => string
  origin: string
}

/** Start the one built artifact with the given runtime env. */
async function startServer(runtimeSecret: string | undefined): Promise<RunningServer> {
  const port = await freePort()
  const env = buildEnv()
  env.PORT = String(port)
  env.HOST = '127.0.0.1'
  if (runtimeSecret !== undefined) env.NUXT_OG_IMAGE_SECRET = runtimeSecret
  const child = spawn(process.execPath, [join(fixtureRoot, '.output', 'server', 'index.mjs')], {
    cwd: fixtureRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout?.on('data', (chunk: Buffer) => (logs += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (logs += chunk.toString()))
  const origin = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${origin}/robots.txt`)
      return { child, logs: () => logs, origin }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  child.kill()
  throw new Error(`fixture server did not start:\n${logs}`)
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    server.child.once('exit', () => resolve())
    server.child.kill()
  })
}

async function ogImagePath(origin: string): Promise<string> {
  const html = await (await fetch(`${origin}/`)).text()
  const content = /<meta property="og:image" content="([^"]+)"/u.exec(html)?.[1]
  if (!content) throw new Error(`no og:image on the page:\n${html.slice(0, 2000)}`)
  return new URL(content).pathname
}

// One production build with no secret, then the same artifact run twice: the
// brief for cloudflare-runner-builds is that CI builds what Workers Builds
// builds, and only the Worker's runtime secret signs.
describe('production build with no NUXT_OG_IMAGE_SECRET', () => {
  let build: { output: string; status: number }

  beforeAll(() => {
    writeFixture()
    build = buildFixture()
  }, 360_000)

  afterAll(() => {
    rmSync(fixtureRoot, { force: true, recursive: true })
  })

  it('builds, and bakes no signing secret into the output', () => {
    expect(build.status, build.output).toBe(0)
    const bundled = readBundledRuntimeConfig()
    // nuxt-og-image would bake a fresh random secret here; narduk-seo blanks it.
    expect(bundled).toMatch(/"restrictRuntimeImagesToOrigin": false,\s*"secret": ""/u)
    expect(bundled).toMatch(/"ogImage": \{\s*"secret": ""\s*\}/u)
  })

  it('signs and verifies with the runtime secret', async () => {
    expect(build.status, build.output).toBe(0)
    const { verifyOgImageSignature } = await loadOgImageUrlEncoding()
    const server = await startServer(RUNTIME_SECRET)
    try {
      const path = await ogImagePath(server.origin)
      const signed = /^\/_og\/d\/(.+),s_([^,]+)\.png$/u.exec(path)
      expect(signed, path).not.toBeNull()
      expect(verifyOgImageSignature(signed![1], signed![2], RUNTIME_SECRET)).toBe(true)

      const valid = await fetch(`${server.origin}${path}`)
      expect(valid.status, server.logs()).toBe(200)
      const tampered = path.replace(/,s_[^,]+\.png$/u, ',s_AAAAAAAAAAAAAAAA.png')
      expect((await fetch(`${server.origin}${tampered}`)).status).toBe(403)
    } finally {
      await stopServer(server)
    }
  }, 60_000)

  it('fails closed when the Worker has no runtime secret', async () => {
    expect(build.status, build.output).toBe(0)
    const server = await startServer(undefined)
    try {
      const page = await fetch(`${server.origin}/`)
      expect(page.status).toBe(200)
      const path = await ogImagePath(server.origin)
      expect(path).not.toMatch(/,s_[^,]+\.png$/u)
      expect((await fetch(`${server.origin}${path}`)).status).toBe(503)
      const forged = path.replace(/\.png$/u, ',s_AAAAAAAAAAAAAAAA.png')
      expect((await fetch(`${server.origin}${forged}`)).status).toBe(503)
      expect(server.logs()).toContain('no NUXT_OG_IMAGE_SECRET')
    } finally {
      await stopServer(server)
    }
  }, 60_000)
})
