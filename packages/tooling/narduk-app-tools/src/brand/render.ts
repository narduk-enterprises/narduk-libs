import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { OverlayOptions } from 'sharp'
import type sharp from 'sharp'

import { brandMonogram } from './config.js'
import type { BrandConfig, OgLayout, OgPattern } from './config.js'

type Sharp = typeof sharp
type Composite = OverlayOptions

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

const FONTS = {
  display: { family: 'NE Brand Display', file: 'ne-brand-display.ttf' },
  text: { family: 'NE Brand Text', file: 'ne-brand-text.ttf' },
  mono: { family: 'NE Brand Mono', file: 'ne-brand-mono.ttf' },
} as const

type FontRole = keyof typeof FONTS

export function brandFontFile(role: FontRole): string {
  return fileURLToPath(new URL(`../../fonts/${FONTS[role].file}`, import.meta.url))
}

export async function loadSharp(): Promise<Sharp> {
  try {
    return (await import('sharp')).default
  } catch {
    throw new Error('Brand assets require the sharp package to be installed.')
  }
}

function markup(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export const xml = markup

function channel(value: number): number {
  const c = value / 255
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** The first candidate that clears 3:1 on `background` (large-text AA), else `ink`/`paper`. */
export function readable(brand: BrandConfig, background: string, ...candidates: string[]): string {
  return candidates.find((color) => contrast(color, background) >= 3) ?? onColor(brand, background)
}

/** `ink` or `paper`, whichever reads better on `background`. */
export function onColor(brand: BrandConfig, background: string): string {
  const { ink, paper } = brand.colors
  return contrast(ink, background) >= contrast(paper, background) ? ink : paper
}

interface TextBox {
  text: string
  role: FontRole
  color: string
  width: number
  height: number
  /** Largest size to try, in px; the size steps down until the text fits the box. */
  maxPx: number
  minPx?: number
  /** Letter spacing in em; display type tightens. */
  tracking?: number
  /** Line height as a multiple of the font size. */
  leading?: number
  align?: 'left' | 'centre' | 'right'
  opacity?: number
}

export interface RenderedText {
  input: Buffer
  width: number
  height: number
  px: number
}

/** Typeset with Pango and the bundled font; shrinks until it fits, never overflows. */
export async function renderText(sharpFactory: Sharp, box: TextBox): Promise<RenderedText> {
  const font = FONTS[box.role]
  const minPx = box.minPx ?? Math.max(12, Math.round(box.maxPx * 0.35))
  let px = box.maxPx
  for (;;) {
    const spacing = Math.round((box.tracking ?? 0) * px * 1024)
    const alpha = box.opacity === undefined ? '' : ` alpha="${Math.round(box.opacity * 100)}%"`
    const lineHeight = box.leading ? ` line_height="${box.leading}"` : ''
    const text = `<span foreground="${box.color}"${alpha} letter_spacing="${spacing}"${lineHeight}>${markup(box.text)}</span>`
    const image = sharpFactory({
      text: {
        text,
        font: `${font.family} ${px}`,
        fontfile: brandFontFile(box.role),
        width: box.width,
        dpi: 72,
        rgba: true,
        wrap: 'word',
        align: box.align ?? 'left',
      },
    })
    const { data, info } = await image.png().toBuffer({ resolveWithObject: true })
    if ((info.height <= box.height && info.width <= box.width) || px <= minPx) {
      if (info.height <= box.height && info.width <= box.width)
        return { input: data, width: info.width, height: info.height, px }
      // Still too tall at the floor: crop to the box rather than spill off the card.
      const cropped = await sharpFactory(data)
        .extract({
          left: 0,
          top: 0,
          width: Math.min(info.width, box.width),
          height: Math.min(info.height, box.height),
        })
        .png()
        .toBuffer()
      return {
        input: cropped,
        width: Math.min(info.width, box.width),
        height: Math.min(info.height, box.height),
        px,
      }
    }
    px = Math.max(minPx, Math.floor(px * 0.92))
  }
}

export function patternDefs(
  pattern: OgPattern,
  id: string,
  color: string,
  opacity: number,
  scale = 1,
): string {
  const s = (value: number) => Math.round(value * scale * 100) / 100
  const stroke = `stroke="${color}" stroke-opacity="${opacity}"`
  switch (pattern) {
    case 'grid':
      return `<pattern id="${id}" width="${s(48)}" height="${s(48)}" patternUnits="userSpaceOnUse"><path d="M ${s(48)} 0 L 0 0 0 ${s(48)}" fill="none" ${stroke} stroke-width="${s(1.5)}"/></pattern>`
    case 'dots':
      return `<pattern id="${id}" width="${s(28)}" height="${s(28)}" patternUnits="userSpaceOnUse"><circle cx="${s(14)}" cy="${s(14)}" r="${s(2.6)}" fill="${color}" fill-opacity="${opacity * 1.6}"/></pattern>`
    case 'diagonal':
      return `<pattern id="${id}" width="${s(22)}" height="${s(22)}" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="0" x2="0" y2="${s(22)}" ${stroke} stroke-width="${s(5)}"/></pattern>`
    case 'contours':
      // A field of concentric rings, drawn once rather than tiled: tiled rings read as polka dots.
      return ''
    case 'none':
      return ''
  }
}

function contourRings(
  cx: number,
  cy: number,
  color: string,
  opacity: number,
  count = 26,
  step = 34,
): string {
  const rings: string[] = []
  for (let index = 1; index <= count; index++) {
    // A slight per-ring wobble keeps the field from reading as a target.
    const r = index * step
    const rx = Math.round(r * (1 + 0.06 * Math.sin(index * 1.7)))
    const ry = Math.round(r * (0.86 + 0.05 * Math.cos(index * 1.3)))
    rings.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${index % 5 === 0 ? 2.4 : 1.2}"/>`,
    )
  }
  return rings.join('')
}

/** Fills a rectangle with the brand pattern; contours draw rings around (cx, cy). */
export function patternFill(
  pattern: OgPattern,
  rect: { x: number; y: number; width: number; height: number },
  color: string,
  opacity: number,
  id: string,
  origin: { cx: number; cy: number },
  scale = 1,
): { defs: string; body: string } {
  if (pattern === 'none') return { defs: '', body: '' }
  const clip = `<clipPath id="${id}-clip"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"/></clipPath>`
  if (pattern === 'contours') {
    return {
      defs: clip,
      body: `<g clip-path="url(#${id}-clip)">${contourRings(origin.cx, origin.cy, color, opacity, 30, Math.round(34 * scale))}</g>`,
    }
  }
  return {
    defs: patternDefs(pattern, id, color, opacity, scale) + clip,
    body: `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="url(#${id})"/>`,
  }
}

/** The square brand mark as a PNG: the app icon when the brand has one, else a typeset monogram. */
export async function renderMark(
  sharpFactory: Sharp,
  brand: BrandConfig,
  root: string,
  size: number,
  options: { fullBleed?: boolean; padding?: number; background?: string } = {},
): Promise<Buffer> {
  const padding = options.padding ?? 0
  if (brand.icon) {
    const source = readFileSync(`${root}/${brand.icon}`)
    const inner = size - padding * 2
    const icon = await sharpFactory(source, { density: 300 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return sharpFactory({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: options.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: icon, left: padding, top: padding }])
      .png()
      .toBuffer()
  }
  const field = options.background ?? brand.colors.primary
  const ink = onColor(brand, field)
  const radius = options.fullBleed ? 0 : Math.round(size * 0.22)
  const fold = Math.round(size * 0.3)
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<defs><clipPath id="c"><rect width="${size}" height="${size}" rx="${radius}"/></clipPath></defs>` +
      `<g clip-path="url(#c)"><rect width="${size}" height="${size}" fill="${field}"/>` +
      `<polygon points="${size},${size - fold} ${size},${size} ${size - fold},${size}" fill="${readable(brand, field, brand.colors.accent, ink)}"/></g></svg>`,
  )
  const glyphBox = Math.round((size - padding * 2) * 0.7)
  const monogram = brandMonogram(brand)
  const glyph = await renderText(sharpFactory, {
    text: monogram,
    role: 'display',
    color: ink,
    width: glyphBox,
    height: Math.round(glyphBox * (monogram.length > 1 ? 0.62 : 0.8)),
    maxPx: Math.round(glyphBox * (monogram.length > 1 ? 0.62 : 0.9)),
    minPx: 6,
    tracking: -0.04,
    align: 'centre',
  })
  return sharpFactory(tile)
    .composite([
      {
        input: glyph.input,
        left: Math.round((size - glyph.width) / 2),
        top: Math.round((size - glyph.height) / 2),
      },
    ])
    .png()
    .toBuffer()
}

export interface CardInput {
  /** The big words: a page title, or the product name on the default card. */
  title: string
  /** One supporting line; omitted when empty. */
  subtitle?: string
  /** Small mono label above the title. */
  eyebrow: string
  /** Shown as the sign-off, e.g. `newton.nard.uk`. */
  host: string
  layout?: OgLayout
  pattern?: OgPattern
}

interface Layer {
  input: Buffer
  left: number
  top: number
}

async function text(
  sharpFactory: Sharp,
  box: TextBox & { left: number; top: number; anchor?: 'top' | 'bottom' | 'middle' },
): Promise<Layer & { height: number; width: number }> {
  const rendered = await renderText(sharpFactory, box)
  const top =
    box.anchor === 'bottom'
      ? box.top + box.height - rendered.height
      : box.anchor === 'middle'
        ? Math.round(box.top + (box.height - rendered.height) / 2)
        : box.top
  const left =
    box.align === 'right'
      ? box.left + box.width - rendered.width
      : box.align === 'centre'
        ? Math.round(box.left + (box.width - rendered.width) / 2)
        : box.left
  return { input: rendered.input, left, top, height: rendered.height, width: rendered.width }
}

async function poster(
  sharpFactory: Sharp,
  brand: BrandConfig,
  root: string,
  card: Required<CardInput>,
): Promise<{ svg: string; layers: Layer[] }> {
  const { ink, paper, primary, accent } = brand.colors
  const hot = readable(brand, ink, accent, primary)
  const fill = patternFill(
    card.pattern,
    { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT },
    paper,
    0.07,
    'p',
    { cx: 1080, cy: 600 },
  )
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
    `<defs>${fill.defs}<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="${ink}" stop-opacity="0.92"/><stop offset="0.62" stop-color="${ink}" stop-opacity="0.35"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${ink}"/>` +
    fill.body +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#fade)"/>` +
    // The signature shape: a quarter disc of the brand colour bleeding off the corner,
    // with an accent orbit -- big enough to read at thumbnail size.
    `<circle cx="1190" cy="700" r="350" fill="${primary}"/>` +
    `<circle cx="1190" cy="700" r="414" fill="none" stroke="${hot}" stroke-width="14"/>` +
    `<circle cx="1190" cy="700" r="476" fill="none" stroke="${hot}" stroke-opacity="0.35" stroke-width="3"/>` +
    `<rect x="72" y="548" width="56" height="10" fill="${hot}"/>` +
    `</svg>`
  const mark = await renderMark(sharpFactory, brand, root, 64)
  const layers: Layer[] = [{ input: mark, left: 72, top: 64 }]
  const name = await text(sharpFactory, {
    text: brand.name,
    role: 'text',
    color: paper,
    width: 560,
    height: 64,
    maxPx: 26,
    left: 156,
    top: 64,
    anchor: 'middle',
  })
  const eyebrow = await text(sharpFactory, {
    text: card.eyebrow.toUpperCase(),
    role: 'mono',
    color: hot,
    width: 760,
    height: 26,
    maxPx: 20,
    tracking: 0.12,
    left: 72,
    top: 168,
  })
  const subtitleHeight = card.subtitle ? 76 : 0
  const title = await text(sharpFactory, {
    text: card.title,
    role: 'display',
    color: paper,
    width: 820,
    height: 300 - subtitleHeight + 40,
    maxPx: 118,
    minPx: 44,
    tracking: -0.035,
    leading: 0.92,
    left: 68,
    top: 206,
  })
  layers.push(name, eyebrow, title)
  if (card.subtitle) {
    layers.push(
      await text(sharpFactory, {
        text: card.subtitle,
        role: 'text',
        color: paper,
        opacity: 0.78,
        width: 760,
        height: subtitleHeight,
        maxPx: 28,
        minPx: 20,
        leading: 1.2,
        left: 72,
        top: title.top + title.height + 22,
      }),
    )
  }
  layers.push(
    await text(sharpFactory, {
      text: card.host,
      role: 'mono',
      color: paper,
      width: 600,
      height: 28,
      maxPx: 22,
      left: 148,
      top: 540,
    }),
  )
  return { svg, layers }
}

async function split(
  sharpFactory: Sharp,
  brand: BrandConfig,
  root: string,
  card: Required<CardInput>,
): Promise<{ svg: string; layers: Layer[] }> {
  const { ink, paper, primary, accent } = brand.colors
  const seam = 740
  const left = patternFill(
    card.pattern,
    { x: 0, y: 0, width: seam, height: OG_HEIGHT },
    ink,
    0.06,
    'l',
    { cx: 0, cy: 0 },
  )
  const right = patternFill(
    card.pattern,
    { x: seam, y: 0, width: OG_WIDTH - seam, height: OG_HEIGHT },
    onColor(brand, primary),
    0.14,
    'r',
    { cx: 970, cy: 315 },
    1.4,
  )
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
    `<defs>${left.defs}${right.defs}</defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${paper}"/>` +
    left.body +
    `<rect x="${seam}" width="${OG_WIDTH - seam}" height="${OG_HEIGHT}" fill="${primary}"/>` +
    right.body +
    `<polygon points="${seam - 26},0 ${seam + 10},0 ${seam - 64},${OG_HEIGHT} ${seam - 100},${OG_HEIGHT}" fill="${accent}"/>` +
    `<rect x="72" y="72" width="40" height="40" fill="${primary}"/>` +
    `<rect x="72" y="532" width="${seam - 200}" height="2" fill="${ink}" fill-opacity="0.18"/>` +
    `</svg>`
  const markSize = 248
  const mark = await renderMark(sharpFactory, brand, root, markSize, {
    background: brand.icon ? undefined : paper,
  })
  const layers: Layer[] = [
    {
      input: mark,
      left: Math.round(seam + (OG_WIDTH - seam - markSize) / 2) + 6,
      top: Math.round((OG_HEIGHT - markSize) / 2),
    },
  ]
  layers.push(
    await text(sharpFactory, {
      text: card.eyebrow.toUpperCase(),
      role: 'mono',
      color: ink,
      opacity: 0.72,
      width: 520,
      height: 40,
      maxPx: 19,
      tracking: 0.14,
      left: 132,
      top: 72,
      anchor: 'middle',
    }),
  )
  const subtitleHeight = card.subtitle ? 74 : 0
  const title = await text(sharpFactory, {
    text: card.title,
    role: 'display',
    color: ink,
    width: 590,
    height: 330 - subtitleHeight + 30,
    maxPx: 104,
    minPx: 40,
    tracking: -0.035,
    leading: 0.94,
    left: 68,
    top: 150,
  })
  layers.push(title)
  if (card.subtitle) {
    layers.push(
      await text(sharpFactory, {
        text: card.subtitle,
        role: 'text',
        color: ink,
        opacity: 0.74,
        width: 560,
        height: subtitleHeight,
        maxPx: 26,
        minPx: 19,
        leading: 1.2,
        left: 72,
        top: title.top + title.height + 20,
      }),
    )
  }
  layers.push(
    await text(sharpFactory, {
      text: `${brand.name}  ·  ${card.host}`,
      role: 'mono',
      color: ink,
      width: seam - 200,
      height: 26,
      maxPx: 19,
      left: 72,
      top: 552,
    }),
  )
  return { svg, layers }
}

async function stamp(
  sharpFactory: Sharp,
  brand: BrandConfig,
  root: string,
  card: Required<CardInput>,
): Promise<{ svg: string; layers: Layer[] }> {
  const { ink, paper, primary, accent } = brand.colors
  const fg = onColor(brand, primary)
  const band = 78
  const fill = patternFill(
    card.pattern,
    { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT - band },
    fg,
    0.1,
    'p',
    { cx: 960, cy: 280 },
  )
  const cx = 958
  const cy = 276
  const ticks = Array.from({ length: 60 }, (_, index) => {
    const angle = (index / 60) * Math.PI * 2
    const r1 = 196
    const r2 = index % 5 === 0 ? 214 : 206
    return `<line x1="${Math.round(cx + Math.cos(angle) * r1)}" y1="${Math.round(cy + Math.sin(angle) * r1)}" x2="${Math.round(cx + Math.cos(angle) * r2)}" y2="${Math.round(cy + Math.sin(angle) * r2)}" stroke="${fg}" stroke-width="${index % 5 === 0 ? 4 : 2}"/>`
  }).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
    `<defs>${fill.defs}</defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${primary}"/>` +
    fill.body +
    `<circle cx="${cx}" cy="${cy}" r="180" fill="${accent}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="160" fill="none" stroke="${onColor(brand, accent)}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>` +
    ticks +
    `<rect y="${OG_HEIGHT - band}" width="${OG_WIDTH}" height="${band}" fill="${ink}"/>` +
    `<rect y="${OG_HEIGHT - band}" width="${OG_WIDTH}" height="6" fill="${accent}"/>` +
    `</svg>`
  const markSize = 176
  const mark = await renderMark(sharpFactory, brand, root, markSize, {
    background: brand.icon ? undefined : ink,
  })
  const layers: Layer[] = [{ input: mark, left: cx - markSize / 2, top: cy - markSize / 2 }]
  layers.push(
    await text(sharpFactory, {
      text: card.eyebrow.toUpperCase(),
      role: 'mono',
      color: fg,
      width: 640,
      height: 26,
      maxPx: 20,
      tracking: 0.14,
      left: 72,
      top: 72,
    }),
  )
  const subtitleHeight = card.subtitle ? 70 : 0
  const title = await text(sharpFactory, {
    text: card.title,
    role: 'display',
    color: fg,
    width: 640,
    height: 340 - subtitleHeight + 20,
    maxPx: 108,
    minPx: 40,
    tracking: -0.035,
    leading: 0.92,
    left: 68,
    top: 116,
  })
  layers.push(title)
  if (card.subtitle) {
    layers.push(
      await text(sharpFactory, {
        text: card.subtitle,
        role: 'text',
        color: fg,
        opacity: 0.82,
        width: 600,
        height: subtitleHeight,
        maxPx: 26,
        minPx: 19,
        leading: 1.2,
        left: 72,
        top: title.top + title.height + 18,
      }),
    )
  }
  layers.push(
    await text(sharpFactory, {
      text: brand.name,
      role: 'text',
      color: paper,
      width: 640,
      height: band - 6,
      maxPx: 26,
      left: 72,
      top: OG_HEIGHT - band + 6,
      anchor: 'middle',
    }),
    await text(sharpFactory, {
      text: card.host,
      role: 'mono',
      color: readable(brand, ink, accent, primary),
      width: 420,
      height: band - 6,
      maxPx: 20,
      align: 'right',
      left: OG_WIDTH - 72 - 420,
      top: OG_HEIGHT - band + 6,
      anchor: 'middle',
    }),
  )
  return { svg, layers }
}

async function ledger(
  sharpFactory: Sharp,
  brand: BrandConfig,
  root: string,
  card: Required<CardInput>,
): Promise<{ svg: string; layers: Layer[] }> {
  const { ink, paper, primary, accent } = brand.colors
  const rail = 28
  const fill = patternFill(
    card.pattern,
    { x: rail, y: 0, width: OG_WIDTH - rail, height: OG_HEIGHT },
    ink,
    0.07,
    'p',
    { cx: 1200, cy: 0 },
  )
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
    `<defs>${fill.defs}</defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${paper}"/>` +
    fill.body +
    `<rect width="${rail}" height="${OG_HEIGHT}" fill="${primary}"/>` +
    `<rect x="${rail}" width="10" height="${OG_HEIGHT}" fill="${accent}"/>` +
    `<rect x="88" y="118" width="${OG_WIDTH - 176}" height="4" fill="${ink}"/>` +
    `<rect x="88" y="512" width="${OG_WIDTH - 176}" height="2" fill="${ink}"/>` +
    `<rect x="88" y="540" width="44" height="44" fill="${accent}"/>` +
    `</svg>`
  const markSize = 92
  const mark = await renderMark(sharpFactory, brand, root, markSize)
  const layers: Layer[] = [
    { input: mark, left: OG_WIDTH - 88 - markSize, top: 516 + Math.round((114 - markSize) / 2) },
  ]
  layers.push(
    await text(sharpFactory, {
      text: card.eyebrow.toUpperCase(),
      role: 'mono',
      color: ink,
      width: 700,
      height: 40,
      maxPx: 20,
      tracking: 0.16,
      left: 88,
      top: 66,
      anchor: 'middle',
    }),
    await text(sharpFactory, {
      text: brand.name,
      role: 'text',
      color: primary === paper ? ink : onColor(brand, paper),
      width: 320,
      height: 40,
      maxPx: 22,
      align: 'right',
      left: OG_WIDTH - 88 - 320,
      top: 66,
      anchor: 'middle',
    }),
  )
  const subtitleHeight = card.subtitle ? 64 : 0
  const title = await text(sharpFactory, {
    text: card.title,
    role: 'display',
    color: ink,
    width: OG_WIDTH - 176,
    height: 360 - subtitleHeight - 24,
    maxPx: 132,
    minPx: 44,
    tracking: -0.04,
    leading: 0.9,
    left: 84,
    top: 0,
  })
  const subtitle = card.subtitle
    ? await text(sharpFactory, {
        text: card.subtitle,
        role: 'text',
        color: ink,
        opacity: 0.74,
        width: 880,
        height: subtitleHeight,
        maxPx: 27,
        minPx: 19,
        leading: 1.2,
        left: 88,
        top: 0,
      })
    : null
  // Centre the title block between the two rules so a short title does not float at the top.
  const gap = subtitle ? 18 : 0
  const block = title.height + gap + (subtitle?.height ?? 0)
  title.top = Math.round(122 + (512 - 122 - block) / 2)
  layers.push(title)
  if (subtitle) {
    subtitle.top = title.top + title.height + gap
    layers.push(subtitle)
  }
  layers.push(
    await text(sharpFactory, {
      text: card.host,
      role: 'mono',
      color: ink,
      width: 600,
      height: 44,
      maxPx: 22,
      left: 152,
      top: 540,
      anchor: 'middle',
    }),
  )
  return { svg, layers }
}

const LAYOUTS = { poster, split, stamp, ledger } as const

/** Renders the brand share card as a 1200x630 PNG. */
export async function renderBrandCard(
  brand: BrandConfig,
  root: string,
  input: CardInput,
): Promise<Buffer> {
  const sharpFactory = await loadSharp()
  const card: Required<CardInput> = {
    layout: brand.og.layout,
    pattern: brand.og.pattern,
    subtitle: '',
    ...input,
  }
  const { svg, layers } = await LAYOUTS[card.layout](sharpFactory, brand, root, card)
  const composites: Composite[] = layers.map((layer) => ({
    input: layer.input,
    left: Math.round(layer.left),
    top: Math.round(layer.top),
  }))
  return sharpFactory(Buffer.from(svg))
    .composite(composites)
    .flatten({ background: brand.colors.ink })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
