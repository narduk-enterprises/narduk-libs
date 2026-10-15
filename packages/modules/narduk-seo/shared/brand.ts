import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * The app's brand, read once at build from `Config/brand.json` -- the file
 * `narduk-app assets generate` draws the favicon set and the default share card
 * from. narduk-seo uses it for the runtime OG card, the icon links and
 * `theme-color`, so one file decides how the app looks wherever it is shared.
 */
export const BRAND_LAYOUTS = ['poster', 'split', 'stamp', 'ledger'] as const
export const BRAND_PATTERNS = ['grid', 'dots', 'contours', 'diagonal', 'none'] as const

export type BrandLayout = (typeof BRAND_LAYOUTS)[number]
export type BrandPattern = (typeof BRAND_PATTERNS)[number]

/**
 * The app's display face: `fonts.display` in brand.json, served from the file
 * `narduk-app assets generate` writes. Null when unset or not yet generated.
 */
export interface NardukSeoBrandFont {
  family: string
  /** Public URL of the TrueType file. */
  src: string
  style: 'normal' | 'italic'
  weight: number
}

/** Where `narduk-app assets generate` writes the display face, under `public/`. */
export const BRAND_DISPLAY_FONT_PUBLIC_PATH = 'fonts/brand-display.ttf'

const RE_FONT_FAMILY = /^[\p{L}\p{N} .'-]{1,64}$/u

export interface NardukSeoBrand {
  accent: string
  displayFont: NardukSeoBrandFont | null
  ink: string
  layout: BrandLayout
  /** Public path of a square brand icon for the runtime card; empty when there is none. */
  logo: string
  monogram: string
  name: string
  paper: string
  pattern: BrandPattern
  primary: string
  tagline: string
  themeColor: string
}

const RE_HEX = /^#[\da-f]{6}$/iu

function hex(value: unknown, key: string, file: string): string {
  if (typeof value !== 'string' || !RE_HEX.test(value))
    throw new Error(`[narduk-seo] ${file} ${key} must be a #rrggbb colour`)
  return value.toLowerCase()
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

export function brandMonogram(name: string, monogram?: unknown): string {
  if (typeof monogram === 'string' && monogram.trim()) return monogram.trim().slice(0, 3)
  const words = name
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word && !/^(?:of|the|and|for|a|an)$/iu.test(word))
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [words[0]?.[0]]
  return letters.join('').toUpperCase() || name.slice(0, 1).toUpperCase()
}

/** Public icon files narduk-app writes, in the order the head should list them. */
export const BRAND_PUBLIC_FILES = {
  ico: 'favicon.ico',
  svg: 'favicon.svg',
  png32: 'favicon-32x32.png',
  appleTouch: 'apple-touch-icon.png',
  icon512: 'icon-512.png',
  manifest: 'site.webmanifest',
  legacyManifest: 'manifest.webmanifest',
} as const

function readDisplayFont(
  value: unknown,
  publicDir: string,
  file: string,
): NardukSeoBrandFont | null {
  if (value === undefined) return null
  const font = (value ?? {}) as Record<string, unknown>
  const family = typeof font.family === 'string' ? font.family.trim() : ''
  if (!RE_FONT_FAMILY.test(family))
    throw new Error(`[narduk-seo] ${file} fonts.display.family must be a font family name`)
  const weight = font.weight === undefined ? 700 : font.weight
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 100 || weight > 900)
    throw new Error(`[narduk-seo] ${file} fonts.display.weight must be 100-900`)
  if (!existsSync(join(publicDir, BRAND_DISPLAY_FONT_PUBLIC_PATH))) {
    // The card and the app fall back to their default faces; `narduk-app assets
    // check` is what fails the build for the missing file.
    console.warn(
      `[narduk-seo] ${file} names fonts.display "${family}" but public/${BRAND_DISPLAY_FONT_PUBLIC_PATH} is missing; run narduk-app assets generate. Using the default face.`,
    )
    return null
  }
  return {
    family,
    src: `/${BRAND_DISPLAY_FONT_PUBLIC_PATH}`,
    style: font.style === 'italic' ? 'italic' : 'normal',
    weight,
  }
}

/**
 * The stylesheet that makes the display face usable everywhere: an
 * `@font-face` for the one file (nuxt-og-image reads app CSS font faces into
 * the runtime card's font list) and `--brand-font-display` for the app's own
 * wordmark.
 */
export function brandFontCss(font: NardukSeoBrandFont): string {
  const family = font.family.replaceAll("'", "\\'")
  const face = (weight: number, style: string) => [
    '@font-face {',
    `  font-family: '${family}';`,
    `  src: url('${font.src}') format('truetype');`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    '  font-display: swap;',
    '}',
  ]
  // The same file again as 400 normal: nuxt-og-image's static font scan
  // bundles each family at 400 for the runtime card, which asks for 400 and so
  // draws this file's own glyphs. Declaring it is what keeps the scan static.
  const card = font.weight === 400 && font.style === 'normal' ? [] : face(400, 'normal')
  return [
    ...face(font.weight, font.style),
    ...card,
    `:root { --brand-font-display: '${family}', system-ui, sans-serif; }`,
    '',
  ].join('\n')
}

/** Returns null when the app has no brand file; throws when it has a broken one. */
export function readBrandFile(
  rootDir: string,
  publicDir: string,
  path = 'Config/brand.json',
): NardukSeoBrand | null {
  const file = isAbsolute(path) ? path : resolve(rootDir, path)
  if (!existsSync(file)) return null
  let json: Record<string, unknown>
  try {
    json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `[narduk-seo] ${path} is not JSON: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    )
  }
  const name = typeof json.name === 'string' ? json.name.trim() : ''
  if (!name) throw new Error(`[narduk-seo] ${path} needs a name`)
  const colors = (json.colors ?? {}) as Record<string, unknown>
  const og = (json.og ?? {}) as Record<string, unknown>
  const primary = hex(colors.primary, 'colors.primary', path)
  return {
    name,
    tagline: typeof json.tagline === 'string' ? json.tagline.trim() : '',
    primary,
    accent: hex(colors.accent, 'colors.accent', path),
    ink: hex(colors.ink, 'colors.ink', path),
    paper: hex(colors.paper, 'colors.paper', path),
    themeColor: json.themeColor === undefined ? primary : hex(json.themeColor, 'themeColor', path),
    layout: oneOf(og.layout, BRAND_LAYOUTS, 'poster'),
    pattern: oneOf(og.pattern, BRAND_PATTERNS, 'grid'),
    monogram: brandMonogram(name, json.monogram),
    displayFont: readDisplayFont(
      (json.fonts as Record<string, unknown> | undefined)?.display,
      publicDir,
      path,
    ),
    logo: existsSync(join(publicDir, BRAND_PUBLIC_FILES.icon512))
      ? `/${BRAND_PUBLIC_FILES.icon512}`
      : '',
  }
}

export interface BrandHeadTags {
  link: Array<Record<string, string>>
  meta: Array<Record<string, string>>
}

/**
 * `<link>` tags for the icon files that exist in `public/`, plus `theme-color`
 * for each colour scheme when the app has a brand. A file that is absent gets
 * no tag: `narduk-app assets check` is what fails the build for it.
 */
export function brandHeadTags(publicDir: string, brand: NardukSeoBrand | null): BrandHeadTags {
  const has = (name: string) => existsSync(join(publicDir, name))
  const link: BrandHeadTags['link'] = []
  if (has(BRAND_PUBLIC_FILES.ico))
    link.push({ rel: 'icon', href: `/${BRAND_PUBLIC_FILES.ico}`, sizes: '48x48' })
  if (has(BRAND_PUBLIC_FILES.svg))
    link.push({ rel: 'icon', href: `/${BRAND_PUBLIC_FILES.svg}`, type: 'image/svg+xml' })
  if (has(BRAND_PUBLIC_FILES.png32))
    link.push({
      rel: 'icon',
      href: `/${BRAND_PUBLIC_FILES.png32}`,
      type: 'image/png',
      sizes: '32x32',
    })
  if (has(BRAND_PUBLIC_FILES.appleTouch))
    link.push({
      rel: 'apple-touch-icon',
      href: `/${BRAND_PUBLIC_FILES.appleTouch}`,
      sizes: '180x180',
    })
  const manifest = [BRAND_PUBLIC_FILES.manifest, BRAND_PUBLIC_FILES.legacyManifest].find(has)
  if (manifest) link.push({ rel: 'manifest', href: `/${manifest}` })
  const meta: BrandHeadTags['meta'] = brand
    ? [
        {
          name: 'theme-color',
          content: brand.themeColor,
          media: '(prefers-color-scheme: light)',
        },
        { name: 'theme-color', content: brand.ink, media: '(prefers-color-scheme: dark)' },
      ]
    : []
  return { link, meta }
}
