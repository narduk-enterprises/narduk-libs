import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { appPath, readSocialPreviewConfig } from '../social/config.js'
import { generateSocialImage, inspectSocialImage } from '../social/images.js'
import { brandMonogram, brandShortName, brandThemeColor, readBrandConfig } from './config.js'
import type { BrandConfig } from './config.js'
import { SOCIAL_PREVIEW_CONFIG_PATH, renderDefaultCard } from './card.js'
import { encodeIco } from './ico.js'
import { loadSharp, onColor, readable, renderMark, xml } from './render.js'

export { SOCIAL_PREVIEW_CONFIG_PATH, renderDefaultCard, resolveSiteHost } from './card.js'

/** Public files the favicon set is made of, named as asset-pack's kit names them. */
export const BRAND_ICON_FILES = {
  ico: 'favicon.ico',
  svg: 'favicon.svg',
  png32: 'favicon-32x32.png',
  appleTouch: 'apple-touch-icon.png',
  icon192: 'icon-192.png',
  icon512: 'icon-512.png',
  maskable: 'icon-mask.png',
  manifest: 'site.webmanifest',
} as const

export const ICO_SIZES = [16, 32, 48] as const

export interface BrandAssetOptions {
  /** App root: the directory holding `Config/` and `public/` (apps/web in a generated app). */
  root: string
  brand?: string
  /** Replace files that already exist. Without it, existing files are kept and reported. */
  force?: boolean
  /** Skip the share card even when the brand would render it. */
  skipOg?: boolean
}

export interface BrandAssetResult {
  written: string[]
  kept: string[]
  og: { path: string; action: 'written' | 'kept' | 'source' | 'skipped' } | null
}

function publicDir(root: string): string {
  return resolve(root, 'public')
}

/** The SVG favicon: the brand's own SVG, the raster icon wrapped, or a monogram with a dark variant. */
export async function brandFaviconSvg(brand: BrandConfig, root: string): Promise<string> {
  if (brand.icon?.toLowerCase().endsWith('.svg'))
    return readFileSync(join(root, brand.icon), 'utf8')
  if (brand.icon) {
    const sharp = await loadSharp()
    const png = await sharp(readFileSync(join(root, brand.icon)))
      .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96"><image width="96" height="96" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`
  }
  const { primary, paper, accent } = brand.colors
  const ink = onColor(brand, primary)
  const fold = readable(brand, primary, accent, ink)
  const monogram = brandMonogram(brand)
  const size = monogram.length === 1 ? 46 : monogram.length === 2 ? 34 : 25
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `<style>.edge{stroke:none}@media (prefers-color-scheme:dark){.edge{stroke:${paper};stroke-opacity:.55;stroke-width:3}}</style>`,
    '<defs><clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath></defs>',
    `<g clip-path="url(#c)"><rect width="64" height="64" fill="${primary}"/><polygon points="64,45 64,64 45,64" fill="${fold}"/></g>`,
    `<rect class="edge" x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none"/>`,
    `<text x="32" y="33" fill="${ink}" font-family="'SF Pro Rounded',ui-rounded,'Segoe UI',system-ui,sans-serif" font-size="${size}" font-weight="800" letter-spacing="-1" text-anchor="middle" dominant-baseline="central">${xml(monogram)}</text>`,
    '</svg>',
    '',
  ].join('\n')
}

export function brandWebManifest(brand: BrandConfig): string {
  return (
    JSON.stringify(
      {
        name: brand.name,
        short_name: brandShortName(brand),
        ...(brand.tagline ? { description: brand.tagline } : {}),
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: brand.colors.paper,
        theme_color: brandThemeColor(brand),
        icons: [
          {
            src: `/${BRAND_ICON_FILES.icon192}`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `/${BRAND_ICON_FILES.icon512}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `/${BRAND_ICON_FILES.maskable}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      null,
      2,
    ) + '\n'
  )
}

async function iconBuffers(brand: BrandConfig, root: string): Promise<Record<string, Buffer>> {
  const sharp = await loadSharp()
  const master = await renderMark(sharp, brand, root, 512)
  const square = (size: number) =>
    sharp(master).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
  // iOS paints transparency black and rounds the corners itself: give it a full-bleed tile.
  const appleSource = await renderMark(sharp, brand, root, 540, {
    fullBleed: true,
    background: brand.icon ? brand.colors.paper : undefined,
  })
  const appleTouch = await sharp(appleSource)
    .resize(180, 180, { kernel: 'lanczos3' })
    .flatten({ background: brand.colors.paper })
    .png({ compressionLevel: 9 })
    .toBuffer()
  let maskable: Buffer
  if (brand.iconMaskable) {
    maskable = await sharp(readFileSync(join(root, brand.iconMaskable)), { density: 300 })
      .resize(512, 512, { fit: 'cover' })
      .flatten({ background: brand.colors.primary })
      .png()
      .toBuffer()
  } else {
    // The maskable safe zone is the centre circle of 80% diameter: keep the mark inside it.
    maskable = await renderMark(sharp, brand, root, 512, {
      fullBleed: true,
      padding: brand.icon ? 104 : 52,
      background: brand.icon ? brand.colors.primary : undefined,
    })
    maskable = await sharp(maskable).flatten({ background: brand.colors.primary }).png().toBuffer()
  }
  const icoImages = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await square(size) })),
  )
  return {
    [BRAND_ICON_FILES.ico]: encodeIco(icoImages),
    [BRAND_ICON_FILES.svg]: Buffer.from(await brandFaviconSvg(brand, root)),
    [BRAND_ICON_FILES.png32]: await square(32),
    [BRAND_ICON_FILES.appleTouch]: appleTouch,
    [BRAND_ICON_FILES.icon192]: await square(192),
    [BRAND_ICON_FILES.icon512]: await square(512),
    [BRAND_ICON_FILES.maskable]: maskable,
    [BRAND_ICON_FILES.manifest]: Buffer.from(brandWebManifest(brand)),
  }
}

async function generateOg(
  brand: BrandConfig,
  options: BrandAssetOptions,
): Promise<BrandAssetResult['og']> {
  if (options.skipOg) return null
  const root = options.root
  if (existsSync(resolve(root, SOCIAL_PREVIEW_CONFIG_PATH))) {
    // og:generate's own path: an app-owned source image wins, else the brand card.
    const social = readSocialPreviewConfig(root, SOCIAL_PREVIEW_CONFIG_PATH)
    const target = appPath(root, 'public' + social.defaultImage.path)
    const existed = existsSync(target)
    const path = await generateSocialImage(social, root, {
      force: options.force,
      ifMissing: !options.force,
    })
    const action = social.defaultImage.source
      ? 'source'
      : existed && !options.force
        ? 'kept'
        : 'written'
    return { path, action }
  }
  return writeCard(brand, root, join(publicDir(root), 'og.png'), options.force)
}

async function writeCard(
  brand: BrandConfig,
  root: string,
  target: string,
  force = false,
): Promise<BrandAssetResult['og']> {
  if (existsSync(target) && !force) return { path: target, action: 'kept' }
  const png = await renderDefaultCard(brand, root)
  await inspectSocialImage(png)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, png)
  return { path: target, action: 'written' }
}

/** Writes the favicon set, the web manifest and the default share card from `Config/brand.json`. */
export async function generateBrandAssets(options: BrandAssetOptions): Promise<BrandAssetResult> {
  const brand = readBrandConfig(options.root, options.brand)
  const target = publicDir(options.root)
  mkdirSync(target, { recursive: true })
  const result: BrandAssetResult = { written: [], kept: [], og: null }
  const buffers = await iconBuffers(brand, options.root)
  for (const [name, bytes] of Object.entries(buffers)) {
    const path = join(target, name)
    if (existsSync(path) && !options.force) {
      result.kept.push(path)
      continue
    }
    writeFileSync(path, bytes)
    result.written.push(path)
  }
  result.og = await generateOg(brand, options)
  return result
}
