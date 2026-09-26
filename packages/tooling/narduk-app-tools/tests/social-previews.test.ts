import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import { parseOgArgs } from '../src/commands/og.js'
import { checkSocialPreviews, socialMeta } from '../src/social/check.js'
import {
  checkRouteInventory,
  readSocialPreviewConfig,
  socialPreviewSchema,
} from '../src/social/config.js'
import type { SocialPreviewConfig } from '../src/social/config.js'
import { generateSocialImage, inspectSocialImage } from '../src/social/images.js'

let root: string
let config: SocialPreviewConfig
let server: Server | undefined
let origin = ''
let defaultPng: Buffer
let redPng: Buffer
let bluePng: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'social-previews-'))
  mkdirSync(join(root, 'public'))
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(root, 'app/pages/items'), { recursive: true })
  writeFileSync(join(root, 'app/pages/index.vue'), '<template>Public home</template>')
  writeFileSync(join(root, 'app/pages/items/[id].vue'), '<template>Public item</template>')
  ;[defaultPng, redPng, bluePng] = await Promise.all(
    ['#111111', '#ff0000', '#0000ff'].map((background) =>
      sharp({ create: { width: 1200, height: 630, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  )
  writeFileSync(join(root, 'public/og.png'), defaultPng)
  config = socialPreviewSchema.parse({
    schemaVersion: 1,
    siteUrl: 'https://example.com',
    defaultImage: { path: '/og.png', alt: 'Example app' },
    routes: [
      { source: 'index.vue', kind: 'default', paths: ['/'] },
      { source: 'items/[id].vue', kind: 'dynamic', paths: ['/items/red', '/items/blue'] },
    ],
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (server) {
    const current = server
    current.closeAllConnections()
    await new Promise<void>((done, reject) =>
      current.close((error) => (error ? reject(error) : done())),
    )
    server = undefined
  }
  rmSync(root, { recursive: true, force: true })
})

/**
 * Open Graph only. The estate stopped emitting `twitter:*` meta because Unhead 3
 * reports every one of those names as deprecated (narduk-libs#349), so the served
 * fixture is what a current app renders and the checker must accept it.
 */
function html(path: string, image = path === '/' ? '/og.png' : path + '.png'): string {
  const meta = {
    'og:title': path,
    'og:description': 'A public item',
    'og:type': 'website',
    'og:url': new URL(path, config.siteUrl).href,
    'og:image': new URL(image, config.siteUrl).href,
    'og:image:alt': 'An example',
    'og:image:width': '1200',
    'og:image:height': '630',
  }
  return (
    '<!DOCTYPE html><html><head>' +
    Object.entries(meta)
      .map(
        ([name, value]) =>
          `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${value}">`,
      )
      .join('') +
    '</head><body>Public content</body></html>'
  )
}

async function serve(
  override?: (
    path: string,
    agent: string,
  ) => { status?: number; mime?: string; location?: string; body: string | Buffer } | undefined,
): Promise<string[]> {
  const requests: string[] = []
  server = createServer((request, response) => {
    const path = request.url ?? '/'
    const agent = request.headers['user-agent'] ?? ''
    requests.push(agent + ' ' + path)
    expect(request.headers.cookie).toBeUndefined()
    expect(request.headers.authorization).toBeUndefined()
    const custom = override?.(path, agent)
    const png = path.endsWith('.png')
    response.writeHead(custom?.status ?? 200, {
      'content-type': custom?.mime ?? (png ? 'image/png' : 'text/html; charset=utf-8'),
      ...(custom?.location ? { location: custom.location } : {}),
    })
    response.end(
      custom?.body ??
        (png
          ? path === '/og.png'
            ? defaultPng
            : path.includes('red')
              ? redPng
              : bluePng
          : html(path)),
    )
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected server port')
  origin = `http://127.0.0.1:${address.port}`
  return requests
}

describe('social preview inventory and default images', () => {
  it('fails missing configuration and unclassified or stale pages', async () => {
    expect(() => readSocialPreviewConfig(root, 'Config/social-previews.json')).toThrow()
    writeFileSync(join(root, 'app/pages/new.vue'), '<template>New page</template>')
    config.routes.push({ source: 'deleted.vue', kind: 'private', reason: 'Removed page' })
    const report = await checkSocialPreviews(config, root)
    expect(report.ok).toBe(false)
    expect(report.errors).toContain('Unclassified page: new.vue')
    expect(report.errors).toContain('Stale route source: deleted.vue')
  })

  it('requires two parameterized examples and explicit private/generic decisions', () => {
    expect(() =>
      socialPreviewSchema.parse({
        ...config,
        routes: [{ source: 'items/[id].vue', kind: 'dynamic', paths: ['/items/red'] }],
      }),
    ).toThrow(/two examples/u)
    // One sample is allowed only with a stated reason: a route family that
    // genuinely has a single instance today cannot invent a second real path.
    expect(
      socialPreviewSchema.parse({
        ...config,
        routes: [
          {
            source: 'items/[id].vue',
            kind: 'dynamic',
            paths: ['/items/red'],
            reason: 'Only one item is published in the current release.',
          },
        ],
      }).routes,
    ).toHaveLength(1)
    expect(() =>
      socialPreviewSchema.parse({ ...config, routes: [{ source: 'index.vue', kind: 'private' }] }),
    ).toThrow()
    config.routes[1] = { source: 'items/[id].vue', kind: 'default', paths: ['/items/red'] }
    expect(checkRouteInventory(config, root).join(' ')).toContain('needs dynamic previews')
    expect(() => socialPreviewSchema.parse({ ...config, pagesDir: null })).toThrow(/inventoryNote/u)
  })

  it('rejects duplicate samples and source traversal', () => {
    config.routes.push({ source: 'index.vue', kind: 'default', paths: ['/'] })
    expect(checkRouteInventory(config, root)).toContain('Duplicate route sample: /')
    expect(() =>
      socialPreviewSchema.parse({
        ...config,
        defaultImage: { ...config.defaultImage, source: '../private.svg' },
      }),
    ).toThrow()
    symlinkSync(tmpdir(), join(root, 'outside'))
    expect(() => readSocialPreviewConfig(root, 'outside/example.json')).toThrow(/Symlink/u)
  })

  it('renders a real image, preserves existing artwork, and rejects corrupt files', async () => {
    writeFileSync(
      join(root, 'public/source.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="green"/></svg>',
    )
    config.defaultImage.source = 'public/source.svg'
    await expect(generateSocialImage(config, root)).rejects.toThrow(/already exists/u)
    await generateSocialImage(config, root, { ifMissing: true })
    expect(readFileSync(join(root, 'public/og.png'))).toEqual(defaultPng)
    await generateSocialImage(config, root, { force: true })
    expect((await sharp(readFileSync(join(root, 'public/og.png'))).metadata()).width).toBe(1200)
    writeFileSync(join(root, 'public/og.png'), '<html>Not an image</html>')
    expect((await checkSocialPreviews(config, root)).ok).toBe(false)
    await expect(inspectSocialImage(redPng, 'text/html')).rejects.toThrow(/Content-Type/u)
    await expect(inspectSocialImage(redPng.subarray(0, 100))).rejects.toThrow()
  })

  it('reports offline success without claiming a live probe and returns a failing CLI exit', async () => {
    const report = await checkSocialPreviews(config, root)
    expect(report).toMatchObject({ ok: true, mode: 'offline', samples: 0 })
    writeFileSync(join(root, 'Config/social-previews.json'), JSON.stringify(config))
    rmSync(join(root, 'public/og.png'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await main(['og:check', '--root', root, '--json'])).toBe(1)
    expect(() => parseOgArgs(['--base-url', origin], 'og:check')).toThrow()
    expect(() => parseOgArgs(['--force', '--if-missing'], 'og:generate')).toThrow()
  })
})

describe('crawler-visible delivery', () => {
  it('cancels after a streamed head even when Content-Length describes a large SSR body', async () => {
    await serve()
    const nativeFetch = globalThis.fetch
    let cancelled = 0
    let bodyReads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('.png')) return nativeFetch(input, options)
      let part = 0
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            part++
            if (part === 1) {
              controller.enqueue(
                new TextEncoder().encode(html(url.pathname).split('</head>')[0] + '</he'),
              )
            } else if (part === 2) {
              controller.enqueue(new TextEncoder().encode('ad>'))
            } else {
              bodyReads++
              controller.error(new Error('The unrelated SSR body must not be downloaded'))
            }
          },
          cancel() {
            cancelled++
          },
        },
        { highWaterMark: 0 },
      )
      return new Response(stream, {
        headers: {
          'content-type': 'text/html',
          'content-length': '10000000',
        },
      })
    })
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report).toMatchObject({ ok: true, samples: 6, errors: [] })
    expect(cancelled).toBe(6)
    expect(bodyReads).toBe(0)
  })

  it('does not stop at a fake head ending before duplicate metadata', async () => {
    await serve((path) =>
      path.endsWith('.png')
        ? undefined
        : {
            body: html(path).replace(
              '</head>',
              '<script>const text = "</head>"</script><!-- </head> -->' +
                '<template></head></template><meta property="og:image" content="https://example.com/duplicate.png"></head>',
            ),
          },
    )
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toContain('exactly one')
  })

  // The head is 1MB. Under a full v8 coverage run this sits past vitest's 5s default.
  it('keeps the byte ceiling on the head itself', async () => {
    await serve((path) =>
      path.endsWith('.png')
        ? undefined
        : {
            body: html(path).replace('</head>', '<!--' + 'x'.repeat(1_000_001) + '--></head>'),
          },
    )
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toContain('head exceeds byte limit')
  }, 20_000)

  it('bounds concurrent requests and cancels a stalled run within its total budget', async () => {
    await serve()
    const nativeFetch = globalThis.fetch
    let active = 0
    let peak = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      active++
      peak = Math.max(peak, active)
      try {
        await new Promise((done) => setTimeout(done, 5))
        return await nativeFetch(...args)
      } finally {
        active--
      }
    })
    expect((await checkSocialPreviews(config, root, { live: true, baseUrl: origin })).ok).toBe(true)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    const report = await checkSocialPreviews(config, root, {
      live: true,
      baseUrl: origin,
      timeoutMs: 1,
    })
    expect(report.ok).toBe(false)
    expect(report.errors).toContain('Live preview check exceeded its total time budget')
  })

  it('checks both profiles, decodes images, and caches shared image requests', async () => {
    const requests = await serve()
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report).toMatchObject({ ok: true, mode: 'live', samples: 6, errors: [] })
    expect(requests.filter((request) => request.endsWith(' /og.png'))).toHaveLength(2)
    expect(requests.some((request) => request.includes('Twitterbot'))).toBe(true)
    expect(requests.some((request) => request.includes('Applebot'))).toBe(true)
  })

  it.each([
    [
      'missing metadata',
      (_path: string) => '<html><head></head><body>Client-only metadata</body></html>',
      'server-rendered',
    ],
    [
      'duplicate metadata',
      (path: string) =>
        html(path).replace(
          '</head>',
          '<meta property="og:image" content="https://example.com/og.png"></head>',
        ),
      'exactly one',
    ],
    ['generic dynamic image', (path: string) => html(path, '/og.png'), 'reused the default'],
    [
      'an image that is not the declared 1200x630 card',
      (path: string) =>
        html(path).replace(
          'property="og:image:width" content="1200"',
          'property="og:image:width" content="600"',
        ),
      '1200x630',
    ],
    [
      'a head with no declared image dimensions',
      (path: string) =>
        html(path).replaceAll(/<meta property="og:image:(?:width|height)"[^>]*>/gu, ''),
      'exactly one nonempty og:image:width',
    ],
    [
      'wrong canonical',
      (path: string) =>
        html(path).replace(
          `content="https://example.com${path === '/' ? '/' : path}"`,
          'content="https://example.com/wrong"',
        ),
      'og:url',
    ],
  ])('rejects %s', async (_name, content, error) => {
    await serve((path) => (path.endsWith('.png') ? undefined : { body: content(path) }))
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toContain(error)
  })

  it('names both URLs and hints NUXT_PUBLIC_SITE_URL when a local dev server renders its own origin (#587)', async () => {
    // The exact symptom #587 reports: a local `nuxt dev` renders `og:url` on
    // its own origin (the `--base-url` target) instead of the canonical
    // `siteUrl`, and the old fixed-string error gave no hint why.
    await serve((path) =>
      path.endsWith('.png') ? undefined : { body: html(path).replace(config.siteUrl, origin) },
    )
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report.ok).toBe(false)
    const message = report.errors.join(' ')
    expect(message).toContain(`og:url is ${origin}/`)
    expect(message).toContain(`expected ${config.siteUrl}/`)
    expect(message).toContain('(siteUrl)')
    expect(message).toContain(`NUXT_PUBLIC_SITE_URL=${config.siteUrl}`)
  })

  it('rejects identical pixels behind different dynamic URLs', async () => {
    await serve((path) =>
      path.startsWith('/items/') && path.endsWith('.png') ? { body: redPng } : undefined,
    )
    expect(
      (await checkSocialPreviews(config, root, { live: true, baseUrl: origin })).errors.join(' '),
    ).toContain('identical pixels')
  })

  it.each([403, 404, 500])('rejects an image returning HTTP %i', async (status) => {
    await serve((path) => (path.endsWith('.png') ? { status, body: 'Unavailable' } : undefined))
    expect(
      (await checkSocialPreviews(config, root, { live: true, baseUrl: origin })).errors.join(' '),
    ).toContain(`HTTP ${status}`)
  })

  it('refuses a cross-origin auth redirect and catches oversized HTML', async () => {
    await serve((path) =>
      path === '/items/red'
        ? { status: 302, location: 'https://login.example.net/', body: '' }
        : path === '/items/blue'
          ? { body: 'a'.repeat(1_000_001) }
          : undefined,
    )
    const report = await checkSocialPreviews(config, root, { live: true, baseUrl: origin })
    expect(report.errors.join(' ')).toContain('declared origins')
    expect(report.errors.join(' ')).toContain('byte limit')
  })

  it('does not interpret commented, scripted, templated, or body metadata as head metadata', () => {
    const meta = socialMeta(
      '<html><head><!-- <meta property="og:image" content="comment"> --><script>"<meta property=\'og:image\' content=\'script\'>"</script><template><meta property="og:image" content="template"></template><meta content="https://example.com/a.png?a=1&amp;b=2" property="og:image"></head><body><meta property="og:image" content="body"></body></html>',
    )
    expect(meta.get('og:image')).toEqual(['https://example.com/a.png?a=1&b=2'])
  })
})
