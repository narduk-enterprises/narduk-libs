export interface DefaultSocialImage {
  alt: string
  url: string
}

/** Safe app identity only. Page metadata and generated images take precedence. */
export function defaultSocialMeta(input: {
  description: string
  image: DefaultSocialImage
  path: string
  siteName: string
  siteUrl: string
}): Array<{ content: string; name?: string; property?: string }> {
  const site = new URL(input.siteUrl)
  const image = new URL(input.image.url, site)
  const canonical = new URL(input.path, site)
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
    'image:width': '1200',
    'image:height': '630',
  }
  const twitter = {
    card: 'summary_large_image',
    title: input.siteName,
    description: input.description,
    image: image.href,
    'image:alt': input.image.alt,
  }
  return [
    ...Object.entries(og).map(([key, content]) => ({ property: `og:${key}`, content })),
    ...Object.entries(twitter).map(([key, content]) => ({ name: `twitter:${key}`, content })),
  ]
}
