import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { z } from 'zod'

/** The app-owned brand file: the one input for the favicon set, the manifest and the share card. */
export const BRAND_CONFIG_PATH = 'Config/brand.json'

export const OG_LAYOUTS = ['poster', 'split', 'stamp', 'ledger'] as const
export const OG_PATTERNS = ['grid', 'dots', 'contours', 'diagonal', 'none'] as const

export type OgLayout = (typeof OG_LAYOUTS)[number]
export type OgPattern = (typeof OG_PATTERNS)[number]

const hex = z
  .string()
  .regex(/^#[\da-f]{6}$/iu, 'Expected a #rrggbb colour')
  .transform((value) => value.toLowerCase())

const localFile = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes('..') && !value.includes('\\'),
    'Expected a relative path inside the app',
  )
  .refine((value) => /\.(?:svg|png)$/iu.test(value), 'Expected an SVG or PNG file')

export const brandDisplayFontSchema = z
  .object({
    /** The family as Google Fonts names it, e.g. `Libre Caslon Condensed`. */
    family: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[\p{L}\p{N} .'-]+$/u, 'Expected a font family name'),
    /** 100-900. Google Fonts serves a static instance at exactly this weight. */
    weight: z.number().int().min(100).max(900).multipleOf(100).default(700),
    style: z.enum(['normal', 'italic']).default('normal'),
    /**
     * A static TrueType file inside the app, for a face Google Fonts does not
     * carry. Absent, the face is downloaded from Google Fonts by `family`.
     */
    file: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !isAbsolute(value) && !value.split(/[\\/]/u).includes('..') && !value.includes('\\'),
        'Expected a relative path inside the app',
      )
      .refine((value) => /\.ttf$/iu.test(value), 'Expected a .ttf file')
      .optional(),
  })
  .strict()

export type BrandDisplayFont = z.output<typeof brandDisplayFontSchema>

export const brandConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Full product name: the manifest `name` and the card's sign-off. */
    name: z.string().trim().min(1).max(60),
    /** Home-screen label. Defaults to `name` when it fits in 12 characters. */
    shortName: z.string().trim().min(1).max(12).optional(),
    /** One line under the title on the default card and the manifest `description`. */
    tagline: z.string().trim().min(1).max(160).optional(),
    colors: z
      .object({
        /** The brand colour: icon field, card accents, light `theme-color`. */
        primary: hex,
        /** A second colour that contrasts with `primary`: rules, highlights, the stamp. */
        accent: hex,
        /** The darkest brand colour: dark surfaces and type on light ones. */
        ink: hex,
        /** The lightest brand colour: light surfaces and type on dark ones. */
        paper: hex,
      })
      .strict(),
    /** Overrides the light-scheme `theme-color`; the dark scheme always uses `colors.ink`. */
    themeColor: hex.optional(),
    /**
     * A square app icon (asset-pack's `app-icon-1024.png`, or an SVG). Absent, the
     * favicon set is a typeset monogram on `colors.primary`.
     */
    icon: localFile.optional(),
    /** A full-bleed maskable variant of `icon`; absent, `icon` is padded into the safe zone. */
    iconMaskable: localFile.optional(),
    /** One to three characters for the generated monogram. Defaults to the name's initials. */
    monogram: z.string().trim().min(1).max(3).optional(),
    /**
     * The app's own display face for card titles, the monogram and the app's
     * wordmark. Absent, cards use the bundled display face.
     */
    fonts: z.object({ display: brandDisplayFontSchema.optional() }).strict().optional(),
    og: z
      .object({
        layout: z.enum(OG_LAYOUTS).default('poster'),
        pattern: z.enum(OG_PATTERNS).default('grid'),
        /** A short label above the title, set in mono capitals. Defaults to the site host. */
        eyebrow: z.string().trim().min(1).max(48).optional(),
      })
      .strict()
      .default({ layout: 'poster', pattern: 'grid' }),
  })
  .strict()

export type BrandConfig = z.output<typeof brandConfigSchema>

export function brandConfigFile(root: string, path = BRAND_CONFIG_PATH): string {
  return resolve(root, path)
}

export function hasBrandConfig(root: string, path = BRAND_CONFIG_PATH): boolean {
  return existsSync(brandConfigFile(root, path))
}

export function parseBrandConfig(value: unknown, label = BRAND_CONFIG_PATH): BrandConfig {
  const parsed = brandConfigSchema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`${label} is invalid: ${detail}`)
  }
  return parsed.data
}

export function readBrandConfig(root: string, path = BRAND_CONFIG_PATH): BrandConfig {
  const file = brandConfigFile(root, path)
  if (!existsSync(file)) throw new Error(`${path} is missing`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${path} is not JSON: ${error instanceof Error ? error.message : error}`)
  }
  return parseBrandConfig(json, path)
}

export function brandShortName(brand: BrandConfig): string {
  if (brand.shortName) return brand.shortName
  if (brand.name.length <= 12) return brand.name
  return brand.name.split(/\s+/u)[0]?.slice(0, 12) ?? brand.name.slice(0, 12)
}

export function brandMonogram(brand: BrandConfig): string {
  if (brand.monogram) return brand.monogram
  const words = brand.name
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word && !/^(?:of|the|and|for|a|an)$/iu.test(word))
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [words[0]?.[0]]
  return letters.join('').toUpperCase() || brand.name.slice(0, 1).toUpperCase()
}

export function brandThemeColor(brand: BrandConfig): string {
  return brand.themeColor ?? brand.colors.primary
}
