const ONE_DAY_SECONDS = 60 * 60 * 24

export const SEO_OG_IMAGE_DEFAULT_PRIMARY = '#10b981'
export const SEO_OG_IMAGE_DEFAULT_SECONDARY = '#38bdf8'
export const SEO_OG_IMAGE_PRESET_SKY = '#0ea5e9'
export const SEO_OG_IMAGE_PRESET_GREEN = '#22c55e'
export const SEO_OG_IMAGE_TEXT_PRIMARY = '#f8fafc'
export const SEO_OG_IMAGE_TEXT_SOFT = '#e2e8f0'
export const SEO_OG_IMAGE_TEXT_MUTED = '#cbd5e1'
export const SEO_OG_IMAGE_TEXT_DIM = '#94a3b8'
export const SEO_OG_IMAGE_BADGE_INK = '#082f49'
export const SEO_OG_IMAGE_SURFACE_INK = '#06101f'
export const SEO_OG_IMAGE_SURFACE_DEEP = '#03111d'

const RE_SEO_OG_IMAGE_HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

type SeoPageType = 'website' | 'article' | 'profile'

export interface SeoOgImageOptions {
  alt?: string
  badgeLabel?: string
  category?: string
  component?: string
  description?: string
  eyebrow?: string
  icon?: string
  image?: string
  primaryColor?: string
  secondaryColor?: string
  siteName?: string
  title?: string
}

interface SeoOgImageDefinition {
  component: string
  options: {
    alt: string
    cacheMaxAgeSeconds: number
  }
  props: {
    badgeLabel?: string
    category?: string
    description: string
    eyebrow?: string
    host?: string
    image?: string
    primaryColor: string
    secondaryColor: string
    siteName: string
    title: string
  }
}

interface ResolveSeoOgImageDefinitionOptions {
  canonicalUrl?: string
  description: string
  image?: string
  ogImage?: SeoOgImageOptions | false
  siteName?: string
  siteUrl?: string
  title: string
  type: SeoPageType
}

function titleCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function normalizeBadgeLabel(value?: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith('i-lucide-')) return titleCase(value.replace(/^i-lucide-/, ''))
  return value
}

function normalizeHost(value?: string): string | undefined {
  if (!value) return undefined

  try {
    return new URL(value).host
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

export function isSeoOgImageHexColor(value: string): boolean {
  return RE_SEO_OG_IMAGE_HEX_COLOR.test(value.trim())
}

export function normalizeSeoOgImageHexColor(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()

  if (!trimmed || !isSeoOgImageHexColor(trimmed)) {
    return fallback
  }

  if (trimmed.length === 4) {
    const [, red, green, blue] = trimmed
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
  }

  return trimmed.toLowerCase()
}

export function hasNoindexRobots(robots?: string): boolean {
  if (!robots) return false

  return robots
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes('noindex')
}

export function resolveSeoOgImageDefinition(
  input: ResolveSeoOgImageDefinitionOptions,
): SeoOgImageDefinition | null {
  const { title, description, type, image, canonicalUrl, siteUrl, siteName, ogImage } = input

  if (ogImage === false) return null

  const component = ogImage?.component ?? (type === 'article' ? 'Article' : 'Default')
  const resolvedSiteName = ogImage?.siteName ?? siteName ?? 'Nuxt 4 App'
  const resolvedTitle = ogImage?.title ?? title
  const resolvedDescription = ogImage?.description ?? description
  const resolvedImage = ogImage?.image ?? image
  const resolvedBadgeLabel = normalizeBadgeLabel(ogImage?.badgeLabel ?? ogImage?.icon)
  const resolvedEyebrow = ogImage?.eyebrow ?? resolvedSiteName
  const resolvedCategory = ogImage?.category ?? (type === 'article' ? 'Article' : undefined)
  const resolvedHost = normalizeHost(canonicalUrl ?? siteUrl)
  const resolvedPrimaryColor = normalizeSeoOgImageHexColor(
    ogImage?.primaryColor,
    SEO_OG_IMAGE_DEFAULT_PRIMARY,
  )
  const resolvedSecondaryColor = normalizeSeoOgImageHexColor(
    ogImage?.secondaryColor,
    SEO_OG_IMAGE_DEFAULT_SECONDARY,
  )

  return {
    component,
    props: {
      title: resolvedTitle,
      description: resolvedDescription,
      siteName: resolvedSiteName,
      ...(resolvedBadgeLabel ? { badgeLabel: resolvedBadgeLabel } : {}),
      ...(resolvedEyebrow ? { eyebrow: resolvedEyebrow } : {}),
      ...(resolvedCategory ? { category: resolvedCategory } : {}),
      ...(resolvedHost ? { host: resolvedHost } : {}),
      ...(resolvedImage ? { image: resolvedImage } : {}),
      primaryColor: resolvedPrimaryColor,
      secondaryColor: resolvedSecondaryColor,
    },
    options: {
      alt: ogImage?.alt ?? `${resolvedTitle} | ${resolvedSiteName}`,
      cacheMaxAgeSeconds: ONE_DAY_SECONDS,
    },
  }
}
