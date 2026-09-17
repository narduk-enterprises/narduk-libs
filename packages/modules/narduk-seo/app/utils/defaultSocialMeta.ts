import { resolveSafeCanonicalUrl } from './safeCanonicalUrl'

export interface DefaultSocialImage {
  alt: string
  url: string
}

/** Declared dimensions of the estate's social card artwork (the `summary_large_image` ratio). */
export const DEFAULT_SOCIAL_IMAGE_WIDTH = '1200'
export const DEFAULT_SOCIAL_IMAGE_HEIGHT = '630'

/**
 * One tag per entry, keyed by exactly one of `property` or `name`. Unhead 3 types
 * meta as that discriminated union, and Unhead 2 accepts it as well.
 *
 * Open Graph only: X reads `og:*` when no `twitter:*` tag is present, and Unhead 3
 * reports every `twitter:*` meta name as deprecated (narduk-libs#349).
 */
export type DefaultSocialMetaTag =
  { content: string; property: string } | { content: string; name: string }

/** Safe app identity only. Page metadata and generated images take precedence. */
export function defaultSocialMeta(input: {
  description: string
  image: DefaultSocialImage
  path: string
  siteName: string
  siteUrl: string
}): DefaultSocialMetaTag[] {
  const site = new URL(input.siteUrl)
  const image = new URL(input.image.url, site)
  const canonical = new URL(
    resolveSafeCanonicalUrl(input.path, input.siteUrl) ?? new URL('/', site).href,
  )
  for (const url of [site, image, canonical]) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
      throw new Error(
        'Default social metadata requires HTTPS URLs (HTTP loopback is allowed in development)',
      )
    }
  }
  if (!input.image.alt.trim()) throw new Error('defaultOgImage.alt must describe the image')
  const og = {
    title: input.siteName,
    description: input.description,
    site_name: input.siteName,
    type: 'website',
    url: canonical.href,
    image: image.href,
    'image:alt': input.image.alt,
    'image:width': DEFAULT_SOCIAL_IMAGE_WIDTH,
    'image:height': DEFAULT_SOCIAL_IMAGE_HEIGHT,
  }
  return Object.entries(og).map(([key, content]) => ({ property: `og:${key}`, content }))
}
