// useSoftwareApplicationSchema — typed wrapper around nuxt-schema-org for SoftwareApplication JSON-LD.

import { toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

export interface SoftwareApplicationAuthor {
  name: string
  url?: string
}

export interface SoftwareApplicationScreenshot {
  alt?: string
  url: string
}

export interface SoftwareApplicationSchemaInput {
  applicationCategory?: string
  author?: SoftwareApplicationAuthor
  catalogUrl?: string | null
  description?: string | null
  featureList?: string[]
  image?: string | null
  isPartOfUrl?: string | null
  name: string
  operatingSystem?: string
  releaseDate?: string | null
  sameAs?: string[]
  screenshots?: SoftwareApplicationScreenshot[]
  softwareVersion?: string
  url?: string | null
}

export function useSoftwareApplicationSchema(
  input: MaybeRefOrGetter<SoftwareApplicationSchemaInput>,
): void {
  const value = toValue(input)
  if (!value.name) return

  const {
    name,
    description,
    url,
    catalogUrl,
    applicationCategory,
    operatingSystem = 'Web',
    screenshots,
    sameAs,
    featureList,
    softwareVersion,
    releaseDate,
    isPartOfUrl,
    image,
    author,
  } = value

  const canonicalUrl = catalogUrl ?? url ?? undefined
  const screenshotNodes = (screenshots ?? [])
    .filter((shot) => shot.url)
    .map((shot) => ({
      '@type': 'ImageObject' as const,
      url: shot.url,
      ...(shot.alt && { caption: shot.alt }),
    }))

  useSchemaOrg([
    {
      '@type': 'SoftwareApplication' as const,
      name,
      ...(description && { description }),
      ...(canonicalUrl && { url: canonicalUrl }),
      ...(applicationCategory && { applicationCategory }),
      operatingSystem,
      ...(image && { image }),
      ...(softwareVersion && { softwareVersion }),
      ...(releaseDate && { datePublished: releaseDate }),
      ...(sameAs && sameAs.length > 0 && { sameAs }),
      ...(featureList && featureList.length > 0 && { featureList }),
      ...(screenshotNodes.length > 0 && { screenshot: screenshotNodes }),
      ...(author && {
        author: {
          '@type': 'Organization' as const,
          name: author.name,
          ...(author.url && { url: author.url }),
        },
      }),
      ...(isPartOfUrl && {
        isPartOf: {
          '@type': 'WebSite' as const,
          url: isPartOfUrl,
        },
      }),
    },
  ])
}
