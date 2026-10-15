import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { BrandConfig, BrandDisplayFont } from './config.js'

/**
 * The brand's display face, resolved once by `narduk-app assets generate` into
 * one committed file. The static card typesets from it and narduk-seo serves
 * the same file to the runtime card and the app (`--brand-font-display`), so
 * every surface uses the same bytes and a render never needs the network.
 */
export const BRAND_DISPLAY_FONT_PUBLIC_PATH = 'fonts/brand-display.ttf'

const GOOGLE_CSS_URL = 'https://fonts.googleapis.com/css2'
const FETCH_TIMEOUT_MS = 15_000

export interface FontInfo {
  /** The typographic family (name ID 16), else the legacy family (name ID 1). */
  family: string
  /** OS/2 `usWeightClass`. */
  weight: number
  italic: boolean
  /** Has an `fvar` table: renders at its default instance, not the requested weight. */
  variable: boolean
}

function tables(bytes: Buffer): Map<string, { offset: number; length: number }> {
  const found = new Map<string, { offset: number; length: number }>()
  if (bytes.length < 12) return found
  const count = bytes.readUInt16BE(4)
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16
    if (at + 16 > bytes.length) break
    const tag = bytes.toString('latin1', at, at + 4)
    found.set(tag, { offset: bytes.readUInt32BE(at + 8), length: bytes.readUInt32BE(at + 12) })
  }
  return found
}

function nameRecord(bytes: Buffer, table: { offset: number }, wanted: number): string | null {
  const base = table.offset
  const count = bytes.readUInt16BE(base + 2)
  const strings = base + bytes.readUInt16BE(base + 4)
  let fallback: string | null = null
  for (let index = 0; index < count; index++) {
    const at = base + 6 + index * 12
    const platform = bytes.readUInt16BE(at)
    const nameId = bytes.readUInt16BE(at + 6)
    if (nameId !== wanted) continue
    const length = bytes.readUInt16BE(at + 8)
    const start = strings + bytes.readUInt16BE(at + 10)
    const raw = bytes.subarray(start, start + length)
    if (platform === 3 || platform === 0) {
      // UTF-16BE: Windows and Unicode platforms.
      const chars: number[] = []
      for (let offset = 0; offset + 1 < raw.length; offset += 2)
        chars.push(raw.readUInt16BE(offset))
      return String.fromCharCode(...chars)
    }
    fallback ??= raw.toString('latin1')
  }
  return fallback
}

/** True when the bytes start like a TrueType or OpenType (CFF) font. */
export function isSfnt(bytes: Buffer): boolean {
  if (bytes.length < 12) return false
  const tag = bytes.readUInt32BE(0)
  return tag === 0x00_01_00_00 || tag === 0x74_72_75_65 || tag === 0x4f_54_54_4f
}

/** Reads the family, weight and style a font file declares; throws on anything but TTF/OTF. */
export function readFontInfo(bytes: Buffer): FontInfo {
  if (!isSfnt(bytes)) throw new Error('not a TrueType or OpenType font')
  const found = tables(bytes)
  const name = found.get('name')
  if (!name) throw new Error('font has no name table')
  const family = nameRecord(bytes, name, 16) ?? nameRecord(bytes, name, 1)
  if (!family) throw new Error('font has no family name')
  const os2 = found.get('OS/2')
  const weight = os2 ? bytes.readUInt16BE(os2.offset + 4) : 400
  const italic = os2 ? (bytes.readUInt16BE(os2.offset + 62) & 1) === 1 : false
  return { family: family.trim(), weight, italic, variable: found.has('fvar') }
}

/** The Google Fonts css2 request for one static instance of the face. */
export function googleFontCssUrl(font: BrandDisplayFont): string {
  const family = font.family.trim().split(/\s+/u).map(encodeURIComponent).join('+')
  return `${GOOGLE_CSS_URL}?family=${family}:ital,wght@${font.style === 'italic' ? 1 : 0},${font.weight}`
}

/**
 * The TrueType URL in a css2 response. Without a browser user agent Google
 * answers with one static TTF per weight, which is what the renderers need: a
 * variable file would draw at its default instance, not the requested weight.
 */
export function googleFontFileUrl(css: string): string | null {
  return (
    /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)\s*format\(['"]truetype['"]\)/u.exec(
      css,
    )?.[1] ?? null
  )
}

async function fetchBytes(fetcher: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Downloads the face from Google Fonts; throws with the reason when it cannot. */
export async function downloadGoogleFont(
  font: BrandDisplayFont,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const cssUrl = googleFontCssUrl(font)
  const response = await fetcher(cssUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (response.status === 400)
    throw new Error(
      `Google Fonts has no "${font.family}" at weight ${font.weight} ${font.style} (check the family name and weight on fonts.google.com)`,
    )
  if (!response.ok) throw new Error(`${cssUrl} answered ${response.status}`)
  const fileUrl = googleFontFileUrl(await response.text())
  if (!fileUrl) throw new Error(`Google Fonts returned no TrueType file for "${font.family}"`)
  return fetchBytes(fetcher, fileUrl)
}

export function brandDisplayFontFile(root: string): string {
  return resolve(root, 'public', BRAND_DISPLAY_FONT_PUBLIC_PATH)
}

/** The source bytes the brand names: its own file, or a Google Fonts download. */
async function sourceBytes(
  font: BrandDisplayFont,
  root: string,
  fetcher: typeof fetch,
): Promise<Buffer> {
  if (font.file) {
    const path = join(root, font.file)
    if (!existsSync(path)) throw new Error(`${font.file} is missing`)
    return readFileSync(path)
  }
  return downloadGoogleFont(font, fetcher)
}

export interface DisplayFontResult {
  path: string
  action: 'written' | 'kept' | 'failed'
  info?: FontInfo
  /** Why the face could not be resolved; the card then uses the bundled display face. */
  error?: string
  warnings: string[]
}

/**
 * Writes `public/fonts/brand-display.ttf` from `fonts.display`. A failure is
 * returned, not thrown: the caller warns, the card falls back to the bundled
 * face, and `narduk-app assets check` fails until the file exists.
 */
export async function resolveBrandDisplayFont(
  brand: BrandConfig,
  root: string,
  options: { force?: boolean; fetcher?: typeof fetch } = {},
): Promise<DisplayFontResult | null> {
  const font = brand.fonts?.display
  if (!font) return null
  const path = brandDisplayFontFile(root)
  const warnings: string[] = []
  if (existsSync(path) && !options.force) {
    try {
      return { path, action: 'kept', info: readFontInfo(readFileSync(path)), warnings }
    } catch (error) {
      return { path, action: 'failed', error: `${path}: ${String(error)}`, warnings }
    }
  }
  let bytes: Buffer
  let info: FontInfo
  try {
    bytes = await sourceBytes(font, root, options.fetcher ?? fetch)
    info = readFontInfo(bytes)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { path, action: 'failed', error: `fonts.display "${font.family}": ${reason}`, warnings }
  }
  if (info.variable)
    warnings.push(
      `fonts.display ${font.file ?? font.family} is a variable font; the card draws its default instance, not weight ${font.weight}. Use a static instance.`,
    )
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  return { path, action: 'written', info, warnings }
}
