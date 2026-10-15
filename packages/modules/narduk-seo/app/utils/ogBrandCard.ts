/**
 * Geometry and colour rules for the runtime brand card (`OgImageDefault`). The
 * static default card `narduk-app assets generate` renders uses the same four
 * layouts and patterns, so a page card and the site card read as one family.
 */

export type OgBrandLayout = 'poster' | 'split' | 'stamp' | 'ledger'
export type OgBrandPattern = 'grid' | 'dots' | 'contours' | 'diagonal' | 'none'

export interface OgBrandPalette {
  accent: string
  ink: string
  paper: string
  primary: string
}

export const OG_BRAND_DEFAULT_INK = '#101418'
export const OG_BRAND_DEFAULT_PAPER = '#f5f1e8'

const LAYOUTS: readonly OgBrandLayout[] = ['poster', 'split', 'stamp', 'ledger']
const PATTERNS: readonly OgBrandPattern[] = ['grid', 'dots', 'contours', 'diagonal', 'none']

export function ogBrandLayout(value: unknown, hasImage = false): OgBrandLayout {
  // A page with its own picture shows it in the split panel.
  if (hasImage) return 'split'
  return LAYOUTS.includes(value as OgBrandLayout) ? (value as OgBrandLayout) : 'poster'
}

export function ogBrandPattern(value: unknown): OgBrandPattern {
  return PATTERNS.includes(value as OgBrandPattern) ? (value as OgBrandPattern) : 'grid'
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel) as [
    number,
    number,
    number,
  ]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function ogContrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `ink` or `paper`, whichever reads better on `background`. */
export function ogOnColor(palette: OgBrandPalette, background: string): string {
  return ogContrast(palette.ink, background) >= ogContrast(palette.paper, background)
    ? palette.ink
    : palette.paper
}

/** The first candidate that clears 3:1 on `background`, else ink or paper. */
export function ogReadable(
  palette: OgBrandPalette,
  background: string,
  ...candidates: string[]
): string {
  return (
    candidates.find((color) => ogContrast(color, background) >= 3) ?? ogOnColor(palette, background)
  )
}

/** A size that keeps a title to about three lines in the layout's text column. */
export function ogTitleSize(title: string, layout: OgBrandLayout): number {
  const wide = layout === 'ledger'
  const length = title.trim().length
  const steps = wide
    ? [
        [16, 132],
        [28, 112],
        [44, 96],
        [64, 80],
        [90, 66],
      ]
    : [
        [14, 116],
        [24, 100],
        [38, 84],
        [56, 70],
        [80, 58],
      ]
  for (const [limit, size] of steps) if (length <= (limit ?? 0)) return size ?? 52
  return wide ? 56 : 50
}

function patternDefs(pattern: OgBrandPattern, id: string, color: string, opacity: number): string {
  const stroke = `stroke="${color}" stroke-opacity="${opacity}"`
  switch (pattern) {
    case 'grid':
      return `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M 48 0 L 0 0 0 48" fill="none" ${stroke} stroke-width="1.5"/></pattern>`
    case 'dots':
      return `<pattern id="${id}" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="2.6" fill="${color}" fill-opacity="${opacity * 1.6}"/></pattern>`
    case 'diagonal':
      return `<pattern id="${id}" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="0" x2="0" y2="22" ${stroke} stroke-width="5"/></pattern>`
    case 'contours':
    case 'none':
      return ''
  }
}

function rings(cx: number, cy: number, color: string, opacity: number, step = 34): string {
  let out = ''
  for (let index = 1; index <= 30; index++) {
    const r = index * step
    const rx = Math.round(r * (1 + 0.06 * Math.sin(index * 1.7)))
    const ry = Math.round(r * (0.86 + 0.05 * Math.cos(index * 1.3)))
    out += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${index % 5 === 0 ? 2.4 : 1.2}"/>`
  }
  return out
}

function fill(
  pattern: OgBrandPattern,
  rect: [number, number, number, number],
  color: string,
  opacity: number,
  id: string,
  origin: [number, number],
): { body: string; defs: string } {
  if (pattern === 'none') return { defs: '', body: '' }
  const [x, y, width, height] = rect
  const clip = `<clipPath id="${id}c"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>`
  if (pattern === 'contours')
    return {
      defs: clip,
      body: `<g clip-path="url(#${id}c)">${rings(origin[0], origin[1], color, opacity)}</g>`,
    }
  return {
    defs: patternDefs(pattern, id, color, opacity) + clip,
    body: `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${id})"/>`,
  }
}

/** The card's background art -- field, texture and signature shape -- as one SVG. */
export function ogBrandArtSvg(
  layout: OgBrandLayout,
  pattern: OgBrandPattern,
  palette: OgBrandPalette,
): string {
  const { ink, paper, primary, accent } = palette
  let defs: string
  let body: string
  if (layout === 'poster') {
    const hot = ogReadable(palette, ink, accent, primary)
    const tex = fill(pattern, [0, 0, 1200, 630], paper, 0.07, 'p', [1080, 600])
    defs = `${tex.defs}<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="${ink}" stop-opacity="0.92"/><stop offset="0.62" stop-color="${ink}" stop-opacity="0.35"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></linearGradient>`
    body =
      `<rect width="1200" height="630" fill="${ink}"/>${tex.body}<rect width="1200" height="630" fill="url(#fade)"/>` +
      `<circle cx="1190" cy="700" r="350" fill="${primary}"/>` +
      `<circle cx="1190" cy="700" r="414" fill="none" stroke="${hot}" stroke-width="14"/>` +
      `<circle cx="1190" cy="700" r="476" fill="none" stroke="${hot}" stroke-opacity="0.35" stroke-width="3"/>` +
      `<rect x="72" y="548" width="56" height="10" fill="${hot}"/>`
  } else if (layout === 'split') {
    const left = fill(pattern, [0, 0, 740, 630], ink, 0.06, 'l', [0, 0])
    const right = fill(
      pattern,
      [740, 0, 460, 630],
      ogOnColor(palette, primary),
      0.14,
      'r',
      [970, 315],
    )
    defs = left.defs + right.defs
    body =
      `<rect width="1200" height="630" fill="${paper}"/>${left.body}` +
      `<rect x="740" width="460" height="630" fill="${primary}"/>${right.body}` +
      `<polygon points="714,0 750,0 676,630 640,630" fill="${accent}"/>` +
      `<rect x="72" y="72" width="40" height="40" fill="${primary}"/>` +
      `<rect x="72" y="532" width="540" height="2" fill="${ink}" fill-opacity="0.18"/>`
  } else if (layout === 'stamp') {
    const fg = ogOnColor(palette, primary)
    const tex = fill(pattern, [0, 0, 1200, 552], fg, 0.1, 'p', [960, 280])
    let ticks = ''
    for (let index = 0; index < 60; index++) {
      const angle = (index / 60) * Math.PI * 2
      const r2 = index % 5 === 0 ? 214 : 206
      ticks += `<line x1="${Math.round(958 + Math.cos(angle) * 196)}" y1="${Math.round(276 + Math.sin(angle) * 196)}" x2="${Math.round(958 + Math.cos(angle) * r2)}" y2="${Math.round(276 + Math.sin(angle) * r2)}" stroke="${fg}" stroke-width="${index % 5 === 0 ? 4 : 2}"/>`
    }
    defs = tex.defs
    body =
      `<rect width="1200" height="630" fill="${primary}"/>${tex.body}` +
      `<circle cx="958" cy="276" r="180" fill="${accent}"/>` +
      `<circle cx="958" cy="276" r="160" fill="none" stroke="${ogOnColor(palette, accent)}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>` +
      ticks +
      `<rect y="552" width="1200" height="78" fill="${ink}"/><rect y="552" width="1200" height="6" fill="${accent}"/>`
  } else {
    const tex = fill(pattern, [28, 0, 1172, 630], ink, 0.07, 'p', [1200, 0])
    defs = tex.defs
    body =
      `<rect width="1200" height="630" fill="${paper}"/>${tex.body}` +
      `<rect width="28" height="630" fill="${primary}"/><rect x="28" width="10" height="630" fill="${accent}"/>` +
      `<rect x="88" y="118" width="1024" height="4" fill="${ink}"/>` +
      `<rect x="88" y="512" width="1024" height="2" fill="${ink}"/>` +
      `<rect x="88" y="540" width="44" height="44" fill="${accent}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs>${defs}</defs>${body}</svg>`
}

export function ogBrandArtDataUri(
  layout: OgBrandLayout,
  pattern: OgBrandPattern,
  palette: OgBrandPalette,
): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(ogBrandArtSvg(layout, pattern, palette))}`
}

export interface OgBrandSlot {
  color: string
  height?: number
  left: number
  top: number
  width: number
}

export interface OgBrandPlan {
  background: string
  brand: { color: string; height: number; left: number; top: number } | null
  brandRight: { color: string; text: string } | null
  eyebrow: OgBrandSlot
  foot: OgBrandSlot
  footRight: { color: string; text: string } | null
  footText: string
  mark: { fg: string; field: string; left: number; size: number; top: number }
  title: OgBrandSlot
}

/** Where each text and mark sits per layout; mirrors narduk-app-tools' brand renderer. */
export function ogBrandPlan(
  layout: OgBrandLayout,
  palette: OgBrandPalette,
  text: { host: string; siteName: string },
): OgBrandPlan {
  const { ink, paper, primary, accent } = palette
  const none = { brand: null, brandRight: null, footRight: null }
  switch (layout) {
    case 'split':
      return {
        ...none,
        background: paper,
        eyebrow: { left: 132, top: 82, width: 520, color: ink },
        title: { left: 68, top: 150, width: 600, color: ink },
        foot: { left: 72, top: 552, width: 540, color: ink },
        footText: `${text.siteName}  ·  ${text.host}`,
        mark: { left: 852, top: 191, size: 248, field: paper, fg: ink },
      }
    case 'stamp': {
      const fg = ogOnColor(palette, primary)
      return {
        ...none,
        background: primary,
        eyebrow: { left: 72, top: 72, width: 640, color: fg },
        title: { left: 68, top: 116, width: 640, color: fg },
        foot: { left: 72, top: 552, width: 1056, height: 78, color: paper },
        footText: text.siteName,
        footRight: { text: text.host, color: ogReadable(palette, ink, accent, primary) },
        mark: { left: 870, top: 188, size: 176, field: ink, fg: paper },
      }
    }
    case 'ledger':
      return {
        ...none,
        background: paper,
        eyebrow: { left: 88, top: 76, width: 700, color: ink },
        title: { left: 84, top: 140, width: 1024, height: 372, color: ink },
        foot: { left: 152, top: 540, width: 600, height: 44, color: ink },
        footText: text.host,
        brandRight: { text: text.siteName, color: ink },
        mark: { left: 1020, top: 527, size: 92, field: primary, fg: ogOnColor(palette, primary) },
      }
    case 'poster':
      return {
        ...none,
        background: ink,
        eyebrow: {
          left: 72,
          top: 168,
          width: 760,
          color: ogReadable(palette, ink, accent, primary),
        },
        title: { left: 68, top: 206, width: 840, color: paper },
        foot: { left: 148, top: 538, width: 600, color: paper },
        footText: text.host,
        mark: { left: 72, top: 64, size: 64, field: primary, fg: ogOnColor(palette, primary) },
        brand: { left: 156, top: 64, height: 64, color: paper },
      }
  }
}

/** Two initials from the site name when the brand sets no monogram. */
export function ogMonogram(monogram: string, siteName: string): string {
  return (
    monogram ||
    siteName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  )
}
