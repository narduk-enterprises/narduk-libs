import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startStaticFixtureServer } from '../src/e2e/fixture-server.js'

import type { StaticFixtureServer } from '../src/e2e/fixture-server.js'

const roots: string[] = []
const servers: StaticFixtureServer[] = []

/** A minimal built app: an HTML entry, one hashed asset, and a fixtures directory beside it. */
function buildFixtureApp(options: { withShell?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'narduk-fixture-server-'))
  roots.push(root)
  const assets = join(root, 'dist')
  const fixtures = join(root, 'fixtures')
  mkdirSync(join(assets, 'assets'), { recursive: true })
  mkdirSync(fixtures, { recursive: true })
  if (options.withShell !== false) {
    writeFileSync(join(assets, 'index.html'), '<!doctype html><title>app</title>', 'utf8')
  }
  writeFileSync(join(assets, 'assets', 'index-abc.js'), 'export const built = true\n', 'utf8')
  writeFileSync(join(fixtures, 'overview.json'), JSON.stringify({ items: [1, 2] }), 'utf8')
  writeFileSync(join(root, 'secret.txt'), 'do not serve me', 'utf8')
  return { assets, fixtures, root }
}

async function start(
  options: Parameters<typeof startStaticFixtureServer>[0],
): Promise<StaticFixtureServer> {
  const server = await startStaticFixtureServer({ silent: true, ...options })
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('startStaticFixtureServer', () => {
  it('refuses to start without a build, and names the command that makes one', async () => {
    const app = buildFixtureApp({ withShell: false })

    await expect(start({ assets: app.assets, buildCommand: 'pnpm run build' })).rejects.toThrow(
      /index\.html is missing\. Run `pnpm run build` first\./,
    )
  })

  it('binds an ephemeral port by default, so two suites can run at once', async () => {
    const app = buildFixtureApp()
    const first = await start({ assets: app.assets })
    const second = await start({ assets: app.assets })

    expect(first.port).toBeGreaterThan(0)
    expect(second.port).toBeGreaterThan(0)
    expect(first.port).not.toBe(second.port)
    expect(first.origin).toBe(`http://127.0.0.1:${first.port}`)
  })

  it('serves the built assets with their own content types', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets })

    const response = await fetch(`${server.origin}/assets/index-abc.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.toContain('built = true')
  })

  it('rewrites every extensionless path to the shell, which is what makes a deep link a deep link', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets })

    for (const path of ['/', '/day/2026-08-29', '/map']) {
      const response = await fetch(`${server.origin}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      await expect(response.text()).resolves.toContain('<title>app</title>')
    }
  })

  it('answers a missing asset the way a static host does, or with a 404 when asked', async () => {
    const app = buildFixtureApp()
    const lenient = await start({ assets: app.assets })
    await expect(fetch(`${lenient.origin}/assets/gone.js`).then((r) => r.status)).resolves.toBe(200)

    const strict = await start({ assets: app.assets, missingAsset: '404' })
    await expect(fetch(`${strict.origin}/assets/gone.js`).then((r) => r.status)).resolves.toBe(404)
  })

  it('serves a recorded fixture file for a route', async () => {
    const app = buildFixtureApp()
    const server = await start({
      assets: app.assets,
      fixtures: app.fixtures,
      routes: { '/api/overview': { file: 'overview.json' } },
    })

    const response = await fetch(`${server.origin}/api/overview?boatClass=bay`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    await expect(response.json()).resolves.toEqual({ items: [1, 2] })
  })

  it('serves an inline body, with a status and headers when the route names them', async () => {
    const app = buildFixtureApp()
    const server = await start({
      assets: app.assets,
      routes: {
        '/api/invalid': {
          body: { error: 'invalid_boat_class' },
          headers: { 'X-Fixture': 'yes' },
          status: 400,
        },
      },
    })

    const response = await fetch(`${server.origin}/api/invalid`)
    expect(response.status).toBe(400)
    expect(response.headers.get('x-fixture')).toBe('yes')
    await expect(response.json()).resolves.toEqual({ error: 'invalid_boat_class' })
  })

  it('gives a route function the parsed URL, the method and the headers', async () => {
    const app = buildFixtureApp()
    const server = await start({
      assets: app.assets,
      routes: {
        '/api/echo': ({ headers, method, url }) => ({
          body: { class: url.searchParams.get('class'), method, mode: headers['x-mode'] ?? null },
        }),
      },
    })

    const response = await fetch(`${server.origin}/api/echo?class=bay`, {
      headers: { 'X-Mode': 'degraded' },
      method: 'POST',
    })
    await expect(response.json()).resolves.toEqual({
      class: 'bay',
      method: 'POST',
      mode: 'degraded',
    })
  })

  it('prefers an exact route over a prefix, and the longest prefix otherwise', async () => {
    const app = buildFixtureApp()
    const server = await start({
      assets: app.assets,
      routes: {
        '/api/': { body: 'catch-all' },
        '/api/routes/': { body: 'by-prefix' },
        '/api/routes/exact': { body: 'exact' },
      },
    })

    await expect(fetch(`${server.origin}/api/routes/exact`).then((r) => r.text())).resolves.toBe(
      'exact',
    )
    await expect(fetch(`${server.origin}/api/routes/other`).then((r) => r.text())).resolves.toBe(
      'by-prefix',
    )
    await expect(fetch(`${server.origin}/api/anything`).then((r) => r.text())).resolves.toBe(
      'catch-all',
    )
  })

  it('answers an unrecorded API path 501 rather than a plausible empty body', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets, routes: { '/api/overview': { body: {} } } })

    const response = await fetch(`${server.origin}/api/unknown?x=1`)
    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toEqual({
      error: 'not_recorded',
      message: 'No fixture recorded for /api/unknown?x=1',
    })
  })

  it('says which fixture file is missing when a route points at one that is not there', async () => {
    const app = buildFixtureApp()
    const server = await start({
      assets: app.assets,
      fixtures: app.fixtures,
      routes: { '/api/overview': { file: 'never-recorded.json' } },
    })

    const response = await fetch(`${server.origin}/api/overview`)
    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toMatchObject({ error: 'fixture_missing' })
  })

  it('cannot be walked out of the assets directory', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets })

    const response = await fetch(`${server.origin}/..%2Fsecret.txt`)
    const body = await response.text()
    expect(body).not.toContain('do not serve me')
  })

  it('records what it answered, in order', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets, routes: { '/api/ok': { body: 1 } } })

    await fetch(`${server.origin}/api/ok`)
    await fetch(`${server.origin}/api/missing`)
    await fetch(`${server.origin}/map`)

    expect(server.requests).toEqual([
      { method: 'GET', path: '/api/ok', status: 200 },
      { method: 'GET', path: '/api/missing', status: 501 },
      { method: 'GET', path: '/map', status: 200 },
    ])
  })

  it('scopes the 501 rule to the prefix it was given', async () => {
    const app = buildFixtureApp()
    const server = await start({ assets: app.assets, scope: '/rpc/' })

    await expect(fetch(`${server.origin}/rpc/thing`).then((r) => r.status)).resolves.toBe(501)
    // Outside the scope an unmatched extensionless path is still a deep link.
    await expect(fetch(`${server.origin}/api/thing`).then((r) => r.status)).resolves.toBe(200)
  })
})
