import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkBrandAssets, checkLiveBrandAssets, isLegacyTemplateCard } from '../src/brand/check.js'
import { brandMonogram, parseBrandConfig, readBrandConfig } from '../src/brand/config.js'
import { generateBrandAssets, renderDefaultCard } from '../src/brand/generate.js'
import { decodeIco, encodeIco } from '../src/brand/ico.js'
import { contrast } from '../src/brand/render.js'
import { main } from '../src/cli.js'
import { parseAssetsArgs } from '../src/commands/assets.js'
import { inspectSocialImage } from '../src/social/images.js'

const BRAND = {
  schemaVersion: 1,
  name: 'Newton County Broadband',
  tagline: 'Where fiber reaches today, and where it goes next.',
  colors: { primary: '#1f6f5c', accent: '#f2b33d', ink: '#0f1f1b', paper: '#f4efe4' },
  og: { layout: 'poster', pattern: 'grid' },
}

/** The card create-narduk-app scaffolded before brand.json existed. */
const LEGACY_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101b30"/><stop offset="1" stop-color="#192f4b"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <path d="M920 0H1200V630H1080Z" fill="#223d57"/>
  <rect x="88" y="96" width="72" height="8" rx="4" fill="#f4b26b"/>
  <text x="88" y="242" fill="#ffffff" font-family="Arial" font-size="66" font-weight="700">Edgerton KS Concept</text>
</svg>`

let root: string
const servers: Server[] = []

function writeBrand(value: unknown = BRAND): void {
  mkdirSync(join(root, 'Config'), { recursive: true })
  writeFileSync(join(root, 'Config/brand.json'), JSON.stringify(value))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brand-assets-'))
})

afterEach(async () => {
  rmSync(root, { force: true, recursive: true })
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
})

describe('brand config', () => {
  it('validates colours, layouts and paths', () => {
    expect(() =>
      parseBrandConfig({ ...BRAND, colors: { ...BRAND.colors, primary: 'teal' } }),
    ).toThrow(/colors.primary: Expected a #rrggbb colour/u)
    expect(() => parseBrandConfig({ ...BRAND, og: { layout: 'gradient' } })).toThrow(/og.layout/u)
    expect(() => parseBrandConfig({ ...BRAND, icon: '../icon.png' })).toThrow(/inside the app/u)
    expect(parseBrandConfig({ ...BRAND, og: undefined }).og).toEqual({
      layout: 'poster',
      pattern: 'grid',
    })
  })

  it('derives a monogram from the name, skipping filler words', () => {
    expect(brandMonogram(parseBrandConfig({ ...BRAND, name: 'City of Edgerton' }))).toBe('CE')
    expect(brandMonogram(parseBrandConfig({ ...BRAND, name: 'newton' }))).toBe('N')
    expect(brandMonogram(parseBrandConfig({ ...BRAND, monogram: 'Nb' }))).toBe('Nb')
  })
})

describe('ico', () => {
  it('round-trips PNG entries and rejects text placeholders', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#f00' } })
      .png()
      .toBuffer()
    const ico = encodeIco([
      { size: 16, png },
      { size: 256, png },
    ])
    const entries = decodeIco(ico)
    expect(entries.map((entry) => [entry.width, entry.png])).toEqual([
      [16, true],
      [256, true],
    ])
    expect(() => decodeIco(Buffer.from('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP'))).toThrow(
      /not an ICO/u,
    )
  })
})

describe('assets generate', () => {
  it('writes the full set from Config/brand.json and the check passes', async () => {
    writeBrand()
    const result = await generateBrandAssets({ root })
    expect(result.written.map((path) => path.slice(root.length + 1)).sort()).toEqual([
      'public/apple-touch-icon.png',
      'public/favicon-32x32.png',
      'public/favicon.ico',
      'public/favicon.svg',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/icon-mask.png',
      'public/site.webmanifest',
    ])
    expect(result.og).toMatchObject({ action: 'written' })
    expect(decodeIco(readFileSync(join(root, 'public/favicon.ico'))).map((e) => e.width)).toEqual([
      16, 32, 48,
    ])
    const manifest = JSON.parse(readFileSync(join(root, 'public/site.webmanifest'), 'utf8'))
    expect(manifest).toMatchObject({
      name: 'Newton County Broadband',
      short_name: 'Newton',
      theme_color: '#1f6f5c',
      background_color: '#f4efe4',
    })
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toEqual([
      'any',
      'any',
      'maskable',
    ])
    const apple = await sharp(readFileSync(join(root, 'public/apple-touch-icon.png'))).stats()
    expect(apple.isOpaque).toBe(true)
    expect(readFileSync(join(root, 'public/favicon.svg'), 'utf8')).toContain(
      'prefers-color-scheme:dark',
    )
    await inspectSocialImage(readFileSync(join(root, 'public/og.png')))

    const report = await checkBrandAssets(root)
    expect(report.errors).toEqual([])
    expect(report.ok).toBe(true)
  }, 30_000)

  it('keeps existing files unless forced', async () => {
    writeBrand()
    await generateBrandAssets({ root })
    const again = await generateBrandAssets({ root })
    expect(again.written).toEqual([])
    expect(again.kept).toHaveLength(8)
    expect(again.og).toMatchObject({ action: 'kept' })
    const forced = await generateBrandAssets({ root, force: true, skipOg: true })
    expect(forced.written).toHaveLength(8)
    expect(forced.og).toBeNull()
  }, 30_000)

  it('renders every layout as a 1200x630 card that keeps the type on the card', async () => {
    const hashes = new Set<string>()
    for (const layout of ['poster', 'split', 'stamp', 'ledger'] as const) {
      const brand = readBrandConfigFrom({ ...BRAND, og: { layout, pattern: 'contours' } })
      const card = await renderDefaultCard(brand, root)
      hashes.add(await inspectSocialImage(card))
      expect(await isLegacyTemplateCard(card)).toBe(false)
    }
    // A very long title still fits: the renderer shrinks it rather than spill.
    const long = readBrandConfigFrom({ ...BRAND, name: 'A'.repeat(20) + ' ' + 'B'.repeat(39) })
    await inspectSocialImage(await renderDefaultCard(long, root))
    expect(hashes.size).toBe(4)
  }, 30_000)

  it('uses a raster icon from the brand for every size', async () => {
    mkdirSync(join(root, 'brand'), { recursive: true })
    const icon = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#335577' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 400, height: 400, channels: 3, background: '#ffcc00' },
          })
            .png()
            .toBuffer(),
          left: 312,
          top: 312,
        },
      ])
      .png()
      .toBuffer()
    writeFileSync(join(root, 'brand/app-icon.png'), icon)
    writeBrand({ ...BRAND, icon: 'brand/app-icon.png' })
    await generateBrandAssets({ root })
    expect(readFileSync(join(root, 'public/favicon.svg'), 'utf8')).toContain(
      'data:image/png;base64,',
    )
    const report = await checkBrandAssets(root)
    expect(report.errors).toEqual([])
  }, 30_000)
})

function readBrandConfigFrom(value: unknown) {
  writeBrand(value)
  return readBrandConfig(root)
}

describe('assets check', () => {
  it('names every missing file', async () => {
    const report = await checkBrandAssets(root)
    expect(report.ok).toBe(false)
    expect(report.errors).toEqual(
      expect.arrayContaining([
        'public/favicon.ico is missing (narduk-app assets generate)',
        'public/apple-touch-icon.png is missing (narduk-app assets generate)',
        'public/site.webmanifest is missing (narduk-app assets generate)',
        'public/og.png is missing (narduk-app assets generate)',
      ]),
    )
  })

  it('fails the placeholder favicon, a transparent apple icon and the legacy card', async () => {
    writeBrand()
    await generateBrandAssets({ root })
    // The 78-byte text file the live demos served as favicon.ico.
    writeFileSync(
      join(root, 'public/favicon.ico'),
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    )
    writeFileSync(
      join(root, 'public/apple-touch-icon.png'),
      await sharp({
        create: {
          width: 180,
          height: 180,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: await sharp({
              create: { width: 40, height: 40, channels: 3, background: '#f00' },
            })
              .png()
              .toBuffer(),
            left: 70,
            top: 70,
          },
        ])
        .png()
        .toBuffer(),
    )
    writeFileSync(
      join(root, 'public/og.png'),
      await sharp(Buffer.from(LEGACY_SOURCE)).png().toBuffer(),
    )
    const report = await checkBrandAssets(root)
    expect(report.errors).toEqual([
      'public/favicon.ico is a 78-byte placeholder, not an icon',
      'public/apple-touch-icon.png has transparent pixels; iOS paints them black',
      expect.stringContaining('public/og.png is the legacy generic create-narduk-app card'),
    ])
  }, 30_000)

  it('recognises a recoloured copy of the legacy card', async () => {
    const recoloured = LEGACY_SOURCE.replaceAll('#101b30', '#0f2f2e')
      .replaceAll('#192f4b', '#0f2f2e')
      .replaceAll('#223d57', '#134e4a')
      .replaceAll('#f4b26b', '#5eead4')
    expect(await isLegacyTemplateCard(await sharp(Buffer.from(recoloured)).png().toBuffer())).toBe(
      true,
    )
  })

  it('checks a live site: head links, the icon bytes and the share image', async () => {
    writeBrand()
    await generateBrandAssets({ root })
    const head = (links: boolean) =>
      `<!doctype html><html><head><title>x</title>${
        links
          ? '<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#1f6f5c">'
          : ''
      }<meta property="og:image" content="/og.png"></head><body></body></html>`
    let withLinks = true
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://x').pathname
      if (path === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(head(withLinks))
        return
      }
      try {
        const bytes = readFileSync(join(root, 'public', path))
        const types: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml' }
        response
          .writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
          .end(bytes)
      } catch {
        response.writeHead(404).end()
      }
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
    const pass = await checkLiveBrandAssets(url)
    expect(pass.errors).toEqual([])
    withLinks = false
    const fail = await checkLiveBrandAssets(url)
    expect(fail.errors).toEqual([
      'head has no <link rel="icon">',
      'head has no SVG <link rel="icon" type="image/svg+xml">',
      'head has no <link rel="apple-touch-icon">',
      'head has no <link rel="manifest">',
      'head has no <meta name="theme-color">',
    ])
  }, 30_000)
})

describe('assets CLI', () => {
  it('parses flags and runs generate then check', async () => {
    expect(parseAssetsArgs(['--live'], 'check', root).live).toBe('')
    expect(parseAssetsArgs(['--live', 'https://a.example'], 'check', root).live).toBe(
      'https://a.example',
    )
    expect(() => parseAssetsArgs(['--force', '--if-missing'], 'generate', root)).toThrow(/Choose/u)
    expect(() => parseAssetsArgs(['--force'], 'check', root)).toThrow(
      /Unknown assets check option/u,
    )
    writeBrand()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['assets', 'check', '--root', root])).toBe(1)
      expect(await main(['assets', 'generate', '--root', root])).toBe(0)
      expect(await main(['assets', 'check', '--root', root, '--json'])).toBe(0)
      const json = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
      expect(json).toMatchObject({ schemaVersion: 1, ok: true, mode: 'offline' })
    } finally {
      log.mockRestore()
    }
  }, 30_000)
})

describe('starter palettes', () => {
  it('keeps the card text readable', () => {
    expect(contrast('#0f1f1b', '#f4efe4')).toBeGreaterThan(12)
  })
})
