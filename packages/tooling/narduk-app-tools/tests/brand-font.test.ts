import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { checkBrandAssets } from '../src/brand/check.js'
import { parseBrandConfig, readBrandConfig } from '../src/brand/config.js'
import {
  BRAND_DISPLAY_FONT_PUBLIC_PATH,
  downloadGoogleFont,
  googleFontCssUrl,
  googleFontFileUrl,
  readFontInfo,
  resolveBrandDisplayFont,
} from '../src/brand/font.js'
import { generateBrandAssets, renderDefaultCard } from '../src/brand/generate.js'
import { brandFontFile, displayFace, ensureFontconfig } from '../src/brand/render.js'

const BRAND = {
  schemaVersion: 1,
  name: 'Newton County Broadband',
  tagline: 'Where fiber reaches today, and where it goes next.',
  colors: { primary: '#1f6f5c', accent: '#f2b33d', ink: '#0f1f1b', paper: '#f4efe4' },
  og: { layout: 'poster', pattern: 'none' },
}

const CASLON = { family: 'Libre Caslon Condensed', weight: 700 }
const GSTATIC = 'https://fonts.gstatic.com/s/librecasloncondensed/v1/caslon-700.ttf'
/**
 * A copy of a font whose family is renamed to a same-length name the bundled
 * fonts do not use, so a render in that family proves this file was loaded.
 */
function renamed(bytes: Buffer, from: string, to: string): Buffer {
  const copy = Buffer.from(bytes)
  for (const encode of [(v: string) => Buffer.from(v, 'latin1'), utf16be]) {
    const [needle, value] = [encode(from), encode(to)]
    for (let at = copy.indexOf(needle); at !== -1; at = copy.indexOf(needle, at + 1))
      value.copy(copy, at)
  }
  return copy
}

function utf16be(value: string): Buffer {
  return Buffer.from(value, 'utf16le').swap16()
}

// A downloaded Google font stand-in: the bundled mono face (a real static TTF,
// no network) under a family name the renderer has not otherwise seen, ending
// in a style word as "Libre Caslon Condensed" does.
const MONO = renamed(readFileSync(brandFontFile('mono')), 'NE Brand Mono', 'Z Q Condensed')

let root: string

function writeBrand(value: unknown): void {
  mkdirSync(join(root, 'Config'), { recursive: true })
  writeFileSync(join(root, 'Config/brand.json'), JSON.stringify(value))
}

/** A fetch stub that answers like Google Fonts css2 and gstatic, recording each URL. */
function googleStub(options: { status?: number; css?: string; bytes?: Buffer } = {}) {
  const urls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (url.startsWith('https://fonts.googleapis.com/'))
      return new Response(
        options.css ??
          `@font-face {\n  font-family: 'Libre Caslon Condensed';\n  font-style: normal;\n  font-weight: 700;\n  src: url(${GSTATIC}) format('truetype');\n}\n`,
        { status: options.status ?? 200 },
      )
    if (url === GSTATIC) return new Response(new Uint8Array(options.bytes ?? MONO))
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { fetcher, urls }
}

/** A copy of `bytes` whose `post` table is retagged `fvar`, which marks it variable. */
function asVariable(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes)
  const count = copy.readUInt16BE(4)
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16
    if (copy.toString('latin1', at, at + 4) === 'post') copy.write('fvar', at, 'latin1')
  }
  return copy
}

async function pixels(png: Buffer): Promise<Buffer> {
  return sharp(png).removeAlpha().raw().toBuffer()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brand-font-'))
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
})

describe('fonts.display config', () => {
  it('defaults weight and style and accepts a local TrueType file', () => {
    expect(
      parseBrandConfig({ ...BRAND, fonts: { display: { family: 'Instrument Serif' } } }).fonts,
    ).toEqual({ display: { family: 'Instrument Serif', weight: 700, style: 'normal' } })
    expect(
      parseBrandConfig({
        ...BRAND,
        fonts: {
          display: { family: 'House Face', weight: 400, style: 'italic', file: 'brand/house.ttf' },
        },
      }).fonts?.display,
    ).toEqual({ family: 'House Face', weight: 400, style: 'italic', file: 'brand/house.ttf' })
  })

  it.each([
    [{ family: '' }, /fonts.display.family/u],
    [{ family: 'Bad<script>' }, /Expected a font family name/u],
    [{ family: 'Inter', weight: 750 }, /fonts.display.weight/u],
    [{ family: 'Inter', weight: 1000 }, /fonts.display.weight/u],
    [{ family: 'Inter', style: 'oblique' }, /fonts.display.style/u],
    [{ family: 'Inter', file: '../face.ttf' }, /inside the app/u],
    [{ family: 'Inter', file: 'brand/face.woff2' }, /Expected a .ttf file/u],
    [{ family: 'Inter', url: 'https://example.com/face.ttf' }, /fonts.display/u],
  ])('rejects %j', (display, message) => {
    expect(() => parseBrandConfig({ ...BRAND, fonts: { display } })).toThrow(message)
  })

  it('rejects unknown font roles', () => {
    expect(() => parseBrandConfig({ ...BRAND, fonts: { body: { family: 'Inter' } } })).toThrow(
      /fonts/u,
    )
  })
})

describe('font files', () => {
  it('reads the family, weight and style a file declares', () => {
    expect(readFontInfo(MONO)).toEqual({
      family: 'Z Q Condensed',
      weight: 400,
      italic: false,
      variable: false,
    })
    expect(readFontInfo(readFileSync(brandFontFile('display'))).family).toBe('NE Brand Display')
    expect(readFontInfo(asVariable(MONO)).variable).toBe(true)
    expect(() => readFontInfo(Buffer.from('<html>not a font</html>'))).toThrow(/not a TrueType/u)
  })

  it('asks Google Fonts for one static instance and finds its TrueType file', () => {
    expect(googleFontCssUrl({ ...CASLON, style: 'normal' })).toBe(
      'https://fonts.googleapis.com/css2?family=Libre+Caslon+Condensed:ital,wght@0,700',
    )
    expect(googleFontCssUrl({ family: 'Instrument Serif', weight: 400, style: 'italic' })).toBe(
      'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital,wght@1,400',
    )
    expect(googleFontFileUrl(`src: url(${GSTATIC}) format('truetype');`)).toBe(GSTATIC)
    expect(
      googleFontFileUrl("src: url(https://fonts.gstatic.com/x.woff2) format('woff2');"),
    ).toBeNull()
  })

  it('downloads the face, and names the family when Google Fonts has no such face', async () => {
    const ok = googleStub()
    expect(await downloadGoogleFont({ ...CASLON, style: 'normal' }, ok.fetcher)).toEqual(MONO)
    expect(ok.urls).toEqual([googleFontCssUrl({ ...CASLON, style: 'normal' }), GSTATIC])

    await expect(
      downloadGoogleFont(
        { family: 'Instrument Serif', weight: 700, style: 'normal' },
        googleStub({ status: 400 }).fetcher,
      ),
    ).rejects.toThrow(/Google Fonts has no "Instrument Serif" at weight 700/u)
    await expect(
      downloadGoogleFont(
        { ...CASLON, style: 'normal' },
        googleStub({ css: '/* empty */' }).fetcher,
      ),
    ).rejects.toThrow(/no TrueType file/u)
  })
})

describe('resolveBrandDisplayFont', () => {
  it('does nothing when brand.json names no display font', async () => {
    writeBrand(BRAND)
    expect(await resolveBrandDisplayFont(readBrandConfig(root), root)).toBeNull()
  })

  it('writes the Google face once, keeps it, and replaces it when forced', async () => {
    writeBrand({ ...BRAND, fonts: { display: CASLON } })
    const brand = readBrandConfig(root)
    const first = googleStub()
    const written = await resolveBrandDisplayFont(brand, root, { fetcher: first.fetcher })
    expect(written).toMatchObject({
      action: 'written',
      info: { family: 'Z Q Condensed' },
      warnings: [],
    })
    expect(readFileSync(join(root, 'public', BRAND_DISPLAY_FONT_PUBLIC_PATH))).toEqual(MONO)

    const second = googleStub()
    const kept = await resolveBrandDisplayFont(brand, root, { fetcher: second.fetcher })
    expect(kept).toMatchObject({ action: 'kept' })
    expect(second.urls).toEqual([])
    // The stand-in's family is not the configured one: a stale file is named.
    expect(kept?.warnings).toEqual([
      'public/fonts/brand-display.ttf is "Z Q Condensed", not fonts.display "Libre Caslon Condensed"; run assets generate --force',
    ])

    const forced = googleStub()
    expect(
      await resolveBrandDisplayFont(brand, root, { force: true, fetcher: forced.fetcher }),
    ).toMatchObject({
      action: 'written',
    })
    expect(forced.urls).toHaveLength(2)
  })

  it('copies a local file and warns about a variable font', async () => {
    mkdirSync(join(root, 'brand'), { recursive: true })
    writeFileSync(join(root, 'brand/house.ttf'), asVariable(MONO))
    writeBrand({ ...BRAND, fonts: { display: { family: 'House Face', file: 'brand/house.ttf' } } })
    const result = await resolveBrandDisplayFont(readBrandConfig(root), root, {
      fetcher: googleStub().fetcher,
    })
    expect(result).toMatchObject({ action: 'written' })
    expect(result?.warnings.join()).toMatch(/variable font/u)
  })

  it('returns a failure rather than throwing, and writes nothing', async () => {
    writeBrand({ ...BRAND, fonts: { display: { family: 'Not A Real Face' } } })
    const result = await resolveBrandDisplayFont(readBrandConfig(root), root, {
      fetcher: googleStub({ status: 400 }).fetcher,
    })
    expect(result).toMatchObject({ action: 'failed' })
    expect(result?.error).toMatch(/Google Fonts has no "Not A Real Face"/u)
    expect(existsSync(join(root, 'public', BRAND_DISPLAY_FONT_PUBLIC_PATH))).toBe(false)
  })
})

describe('the card in the brand face', () => {
  it('points fontconfig at the files it is given, respecting a caller setting', () => {
    const env: NodeJS.ProcessEnv = {}
    ensureFontconfig(env)
    expect(env.PANGOCAIRO_BACKEND).toBe('fc')
    expect(readFileSync(env.FONTCONFIG_FILE ?? '', 'utf8')).toContain('<fontconfig>')
    const own: NodeJS.ProcessEnv = { PANGOCAIRO_BACKEND: 'win32', FONTCONFIG_FILE: '/etc/own.conf' }
    ensureFontconfig(own)
    expect(own).toEqual({ PANGOCAIRO_BACKEND: 'win32', FONTCONFIG_FILE: '/etc/own.conf' })
  })

  it('typesets the title and monogram from public/fonts/brand-display.ttf', async () => {
    const bundled = await renderDefaultCard(parseBrandConfig(BRAND), root)

    // Each card gets its own app: fontconfig caches a font by its path, and a
    // real app writes brand-display.ttf once, before its first render.
    const cardWith = async (family: string, font: Buffer): Promise<Buffer> => {
      const app = mkdtempSync(join(tmpdir(), 'brand-font-card-'))
      try {
        mkdirSync(join(app, 'public/fonts'), { recursive: true })
        writeFileSync(join(app, 'public', BRAND_DISPLAY_FONT_PUBLIC_PATH), font)
        const brand = parseBrandConfig({ ...BRAND, fonts: { display: { family, weight: 400 } } })
        expect(displayFace(brand, app).family).toBe(readFontInfo(font).family)
        return await renderDefaultCard(brand, app)
      } finally {
        rmSync(app, { force: true, recursive: true })
      }
    }

    // The bundled display face under the brand key draws the same card: the
    // key swaps the face and nothing else.
    const same = await cardWith('NE Brand Display', readFileSync(brandFontFile('display')))
    expect((await pixels(same)).equals(await pixels(bundled))).toBe(true)

    // The mono glyphs as the display face: the reference for the card below.
    const mono = await cardWith('NE Brand Mono', readFileSync(brandFontFile('mono')))
    expect((await pixels(mono)).equals(await pixels(bundled))).toBe(false)

    // The same glyphs under a family only the downloaded file carries, whose
    // name ends in a style word, draw that same card. A renderer that ignored
    // the file, or let Pango read "Condensed" as a stretch, would draw a system face.
    writeBrand({ ...BRAND, fonts: { display: CASLON } })
    const result = await generateBrandAssets({ root, force: true, fetcher: googleStub().fetcher })
    expect(result.font).toMatchObject({ action: 'written' })
    expect(displayFace(readBrandConfig(root), root)).toMatchObject({
      family: 'Z Q Condensed',
      weight: 400,
    })
    const branded = readFileSync(join(root, 'public/og.png'))
    expect((await pixels(branded)).equals(await pixels(mono))).toBe(true)
  }, 30_000)

  it('falls back to the bundled face when the font cannot be resolved', async () => {
    writeBrand(BRAND)
    const bundled = await renderDefaultCard(readBrandConfig(root), root)
    writeBrand({ ...BRAND, fonts: { display: { family: 'Not A Real Face' } } })
    const result = await generateBrandAssets({ root, fetcher: googleStub({ status: 400 }).fetcher })
    expect(result.font).toMatchObject({ action: 'failed' })
    const card = readFileSync(join(root, 'public/og.png'))
    expect((await pixels(card)).equals(await pixels(bundled))).toBe(true)
  }, 30_000)
})

describe('assets check with fonts.display', () => {
  it('passes with the font, fails without it or with a variable font', async () => {
    writeBrand({ ...BRAND, fonts: { display: CASLON } })
    await generateBrandAssets({ root, fetcher: googleStub().fetcher })
    expect((await checkBrandAssets(root)).errors).toEqual([])

    const file = join(root, 'public', BRAND_DISPLAY_FONT_PUBLIC_PATH)
    writeFileSync(file, asVariable(MONO))
    expect((await checkBrandAssets(root)).errors).toEqual([
      'public/fonts/brand-display.ttf is a variable font; use a static instance',
    ])

    writeFileSync(file, 'not a font')
    expect((await checkBrandAssets(root)).errors.join()).toMatch(
      /brand-display.ttf is not a usable font/u,
    )

    rmSync(file)
    expect((await checkBrandAssets(root)).errors).toEqual([
      'public/fonts/brand-display.ttf is missing (narduk-app assets generate)',
    ])
  }, 30_000)
})
