import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

import { readSocialPreviewConfig } from '../social/config.js'
import { MAX_IMAGE_BYTES, inspectSocialImage } from '../social/images.js'
import { hasBrandConfig, readBrandConfig } from './config.js'
import { decodeIco } from './ico.js'
import { BRAND_ICON_FILES, ICO_SIZES, SOCIAL_PREVIEW_CONFIG_PATH } from './generate.js'
import { loadSharp } from './render.js'

/**
 * sha256 of share images known to be placeholders. The legacy generator card is
 * caught structurally (`isLegacyTemplateCard`), whatever its title or colours;
 * this list catches byte-identical copies of anything else that ships as a default.
 */
export const KNOWN_PLACEHOLDER_IMAGE_SHA256: ReadonlySet<string> = new Set([])

export interface AssetCheckReport {
  schemaVersion: 1
  ok: boolean
  mode: 'offline' | 'live'
  target: string
  checked: string[]
  errors: string[]
}

type Pixels = { data: Buffer; width: number; channels: number }

async function pixels(bytes: Uint8Array): Promise<Pixels> {
  const sharp = await loadSharp()
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, channels: info.channels }
}

function pixel(image: Pixels, x: number, y: number): [number, number, number] {
  const at = (y * image.width + x) * image.channels
  return [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0]
}

function same(a: [number, number, number], b: [number, number, number], tolerance = 10): boolean {
  return a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= tolerance)
}

/**
 * The create-narduk-app card every demo shipped until this check existed: a flat
 * field, a 72x8 dash at (88, 96) and a slanted panel from x=920 at the top edge.
 * Matched by structure, so a recoloured or retitled copy is still the template.
 */
export async function isLegacyTemplateCard(bytes: Uint8Array): Promise<boolean> {
  const image = await pixels(bytes)
  const background = pixel(image, 4, 4)
  const dash = pixel(image, 100, 100)
  const panel = pixel(image, 1190, 20)
  return (
    !same(dash, background, 24) &&
    same(pixel(image, 124, 100), dash) &&
    same(pixel(image, 156, 100), dash) &&
    !same(pixel(image, 124, 88), dash, 24) &&
    !same(pixel(image, 124, 112), dash, 24) &&
    !same(panel, background, 6) &&
    same(pixel(image, 960, 20), panel) &&
    same(pixel(image, 1150, 300), panel) &&
    !same(pixel(image, 880, 20), panel, 4)
  )
}

async function isFlatImage(bytes: Uint8Array): Promise<boolean> {
  const sharp = await loadSharp()
  const stats = await sharp(bytes).removeAlpha().stats()
  return stats.channels.every((channel) => channel.stdev < 2)
}

async function pngSize(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; alpha: boolean; opaque: boolean }> {
  const sharp = await loadSharp()
  const image = sharp(bytes)
  const metadata = await image.metadata()
  if (metadata.format !== 'png')
    throw new Error(`is ${metadata.format ?? 'not an image'}, want PNG`)
  let opaque = true
  if (metadata.hasAlpha) {
    const stats = await image.stats()
    opaque = (stats.channels[3]?.min ?? 255) === 255
  }
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    alpha: Boolean(metadata.hasAlpha),
    opaque,
  }
}

async function checkIco(bytes: Uint8Array): Promise<string[]> {
  const errors: string[] = []
  if (
    bytes.byteLength < 200 ||
    /^\s*(?:data:|<)/u.test(Buffer.from(bytes.subarray(0, 16)).toString('latin1'))
  )
    return [`is a ${bytes.byteLength}-byte placeholder, not an icon`]
  let entries
  try {
    entries = decodeIco(bytes)
  } catch (error) {
    return [`is not a real ICO: ${error instanceof Error ? error.message : error}`]
  }
  const sizes = new Set(entries.map((entry) => entry.width))
  const missing = ICO_SIZES.filter((size) => !sizes.has(size))
  if (missing.length)
    errors.push(`lacks the ${missing.join(', ')} px entries (want ${ICO_SIZES.join('/')})`)
  const largest = entries.reduce((a, b) => (b.width > a.width ? b : a))
  if (largest.png && (await isFlatImage(largest.bytes)))
    errors.push('is a single flat colour (placeholder)')
  return errors
}

function checkSvg(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString('utf8')
  if (!/<svg[\s>]/u.test(text)) return ['is not an SVG']
  if (bytes.byteLength < 120) return [`is a ${bytes.byteLength}-byte placeholder`]
  if (!/viewBox=|width=/u.test(text)) return ['has neither a viewBox nor a size']
  return []
}

interface ManifestIcon {
  src?: unknown
  sizes?: unknown
  purpose?: unknown
}

function checkManifestShape(manifest: Record<string, unknown>): {
  errors: string[]
  icons: ManifestIcon[]
} {
  const errors: string[] = []
  for (const key of ['name', 'theme_color', 'background_color', 'display'])
    if (typeof manifest[key] !== 'string' || !manifest[key]) errors.push(`has no ${key}`)
  const icons = Array.isArray(manifest.icons) ? (manifest.icons as ManifestIcon[]) : []
  const has = (size: string, purpose?: string) =>
    icons.some(
      (icon) =>
        typeof icon.sizes === 'string' &&
        icon.sizes.split(/\s+/u).includes(size) &&
        (!purpose ||
          (typeof icon.purpose === 'string' && icon.purpose.split(/\s+/u).includes(purpose))),
    )
  if (!has('192x192')) errors.push('has no 192x192 icon')
  if (!has('512x512')) errors.push('has no 512x512 icon')
  if (
    !has('512x512', 'maskable') &&
    !icons.some((icon) => String(icon.purpose ?? '').includes('maskable'))
  )
    errors.push('has no maskable icon')
  return { errors, icons }
}

async function checkShareImage(bytes: Uint8Array, mime?: string): Promise<string[]> {
  const errors: string[] = []
  try {
    await inspectSocialImage(bytes, mime)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (KNOWN_PLACEHOLDER_IMAGE_SHA256.has(sha))
    errors.push('is byte-identical to a known placeholder image')
  if (await isLegacyTemplateCard(bytes))
    errors.push(
      'is the legacy generic create-narduk-app card (navy field, dash, slanted panel); add Config/brand.json and run narduk-app assets generate --force',
    )
  if (await isFlatImage(bytes)) errors.push('is a single flat colour')
  return errors
}

/** Offline: the files an app ships in `public/`, before a build. */
export async function checkBrandAssets(root: string): Promise<AssetCheckReport> {
  const report: AssetCheckReport = {
    schemaVersion: 1,
    ok: false,
    mode: 'offline',
    target: root,
    checked: [],
    errors: [],
  }
  const fail = (file: string, message: string) => report.errors.push(`${file} ${message}`)
  const publicDir = resolve(root, 'public')
  const read = (name: string): Buffer | null => {
    const path = join(publicDir, name)
    report.checked.push(`public/${name}`)
    if (!existsSync(path)) {
      fail(`public/${name}`, 'is missing (narduk-app assets generate)')
      return null
    }
    return readFileSync(path)
  }
  if (hasBrandConfig(root)) {
    try {
      readBrandConfig(root)
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const ico = read(BRAND_ICON_FILES.ico)
  if (ico) for (const error of await checkIco(ico)) fail('public/favicon.ico', error)
  const svg = read(BRAND_ICON_FILES.svg)
  if (svg) for (const error of checkSvg(svg)) fail('public/favicon.svg', error)
  const png32 = read(BRAND_ICON_FILES.png32)
  if (png32) await expectPng(png32, 32, 'public/favicon-32x32.png', fail)
  const apple = read(BRAND_ICON_FILES.appleTouch)
  if (apple) await expectPng(apple, 180, 'public/apple-touch-icon.png', fail, true)
  const manifestBytes = read(BRAND_ICON_FILES.manifest)
  if (manifestBytes) {
    let manifest: Record<string, unknown> | null = null
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>
    } catch {
      fail('public/site.webmanifest', 'is not JSON')
    }
    if (manifest) {
      const { errors, icons } = checkManifestShape(manifest)
      for (const error of errors) fail('public/site.webmanifest', error)
      for (const icon of icons) {
        if (typeof icon.src !== 'string' || !icon.src.startsWith('/')) continue
        const size = Number(String(icon.sizes ?? '').split('x')[0])
        const bytes = read(icon.src.slice(1))
        if (bytes && size) await expectPng(bytes, size, `public${icon.src}`, fail)
      }
    }
  }
  let ogPath = 'public/og.png'
  if (existsSync(resolve(root, SOCIAL_PREVIEW_CONFIG_PATH))) {
    try {
      const social = readSocialPreviewConfig(root, SOCIAL_PREVIEW_CONFIG_PATH)
      ogPath = 'public' + social.defaultImage.path
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const og = read(ogPath.slice('public/'.length))
  if (og) for (const error of await checkShareImage(og)) fail(ogPath, error)
  report.checked = [...new Set(report.checked)]
  report.ok = report.errors.length === 0
  return report
}

async function expectPng(
  bytes: Uint8Array,
  size: number,
  label: string,
  fail: (file: string, message: string) => void,
  opaque = false,
): Promise<void> {
  try {
    const info = await pngSize(bytes)
    if (info.width !== size || info.height !== size)
      fail(label, `is ${info.width}x${info.height}, want ${size}x${size}`)
    if (opaque && !info.opaque) fail(label, 'has transparent pixels; iOS paints them black')
    if (await isFlatImage(bytes)) fail(label, 'is a single flat colour (placeholder)')
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error))
  }
}

interface HeadInventory {
  links: Array<{ rel: string[]; href: string; type?: string; sizes?: string }>
  meta: Map<string, string>
}

export function headInventory(html: string): HeadInventory {
  const inventory: HeadInventory = { links: [], meta: new Map() }
  function walk(node: DefaultTreeAdapterMap['node'], inHead = false): void {
    const head = inHead || ('tagName' in node && node.tagName === 'head')
    if (head && 'tagName' in node && (node.tagName === 'link' || node.tagName === 'meta')) {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]))
      if (node.tagName === 'link' && attrs.href) {
        inventory.links.push({
          rel: (attrs.rel ?? '').toLowerCase().split(/\s+/u).filter(Boolean),
          href: attrs.href,
          type: attrs.type,
          sizes: attrs.sizes,
        })
      } else {
        const key = (attrs.property ?? attrs.name)?.toLowerCase()
        if (key && attrs.content && !inventory.meta.has(key)) inventory.meta.set(key, attrs.content)
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child, head)
  }
  walk(parse(html))
  return inventory
}

const LIVE_AGENT = 'Mozilla/5.0 (compatible; narduk-app-assets-check/1.0)'

async function fetchBounded(
  url: URL,
  limit: number,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; mime: string }> {
  const response = await fetch(url, {
    headers: { 'user-agent': LIVE_AGENT, accept: '*/*' },
    credentials: 'omit',
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error(`HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > limit) throw new Error('response exceeds the byte limit')
  return { bytes, mime: response.headers.get('content-type') ?? '' }
}

/** Live: what a browser and a crawler actually get from the deployed page. */
export async function checkLiveBrandAssets(
  pageUrl: string,
  timeoutMs = 60_000,
): Promise<AssetCheckReport> {
  const page = new URL(pageUrl)
  if (page.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(page.hostname))
    throw new Error('--live needs an HTTPS URL (HTTP is allowed only for loopback)')
  const report: AssetCheckReport = {
    schemaVersion: 1,
    ok: false,
    mode: 'live',
    target: page.href,
    checked: [],
    errors: [],
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const get = async (url: URL, limit = MAX_IMAGE_BYTES) => {
    report.checked.push(url.href)
    return fetchBounded(url, limit, signal)
  }
  let head: HeadInventory
  try {
    const { bytes, mime } = await get(page, 2_000_000)
    if (!/^text\/html/iu.test(mime)) throw new Error(`is ${mime || 'untyped'}, not text/html`)
    head = headInventory(bytes.toString('utf8'))
  } catch (error) {
    report.errors.push(`${page.href}: ${error instanceof Error ? error.message : error}`)
    return report
  }
  const link = (predicate: (entry: HeadInventory['links'][number]) => boolean) =>
    head.links.find(predicate)
  const icons = head.links.filter((entry) => entry.rel.includes('icon'))
  const ico = link((entry) => entry.rel.includes('icon') && /\.ico(?:$|\?)/iu.test(entry.href))
  const svg = link(
    (entry) =>
      entry.rel.includes('icon') &&
      (entry.type === 'image/svg+xml' || /\.svg(?:$|\?)/iu.test(entry.href)),
  )
  const apple = link((entry) => entry.rel.includes('apple-touch-icon'))
  const manifest = link((entry) => entry.rel.includes('manifest'))
  if (icons.length === 0) report.errors.push('head has no <link rel="icon">')
  if (!svg) report.errors.push('head has no SVG <link rel="icon" type="image/svg+xml">')
  if (!apple) report.errors.push('head has no <link rel="apple-touch-icon">')
  if (!manifest) report.errors.push('head has no <link rel="manifest">')
  if (!head.meta.has('theme-color')) report.errors.push('head has no <meta name="theme-color">')
  const probe = async (
    label: string,
    url: URL,
    check: (bytes: Buffer, mime: string) => Promise<string[]>,
  ) => {
    try {
      const { bytes, mime } = await get(url)
      for (const error of await check(bytes, mime)) report.errors.push(`${label} ${error}`)
    } catch (error) {
      report.errors.push(`${label} ${url.href}: ${error instanceof Error ? error.message : error}`)
    }
  }
  await probe('favicon.ico', new URL(ico?.href ?? '/favicon.ico', page), (bytes) => checkIco(bytes))
  if (svg) await probe('SVG favicon', new URL(svg.href, page), async (bytes) => checkSvg(bytes))
  if (apple)
    await probe('apple-touch-icon', new URL(apple.href, page), async (bytes) => {
      const errors: string[] = []
      await expectPng(bytes, 180, '', (_, message) => errors.push(message), true)
      return errors
    })
  if (manifest) {
    const manifestUrl = new URL(manifest.href, page)
    await probe('manifest', manifestUrl, async (bytes) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
      } catch {
        return ['is not JSON']
      }
      const { errors, icons: entries } = checkManifestShape(parsed)
      for (const icon of entries) {
        if (typeof icon.src !== 'string') continue
        const size = Number(String(icon.sizes ?? '').split('x')[0])
        if (!size) continue
        await probe(
          `manifest icon ${icon.src}`,
          new URL(icon.src, manifestUrl),
          async (iconBytes) => {
            const iconErrors: string[] = []
            await expectPng(iconBytes, size, '', (_, message) => iconErrors.push(message))
            return iconErrors
          },
        )
      }
      return errors
    })
  }
  const ogImage = head.meta.get('og:image')
  if (!ogImage) report.errors.push('head has no og:image')
  else
    await probe('og:image', new URL(ogImage, page), (bytes, mime) => checkShareImage(bytes, mime))
  report.checked = [...new Set(report.checked)]
  report.errors = report.errors.map((error) => error.replaceAll('  ', ' '))
  report.ok = report.errors.length === 0
  return report
}
