import {
  defineOgImage,
  toValue,
  useHead,
  useRuntimeConfig,
  useSeoMeta,
  useSiteConfig,
} from '#imports'

import { hasNoindexRobots, resolveSeoOgImageDefinition } from '../utils/ogImageDefinition'
import { resolvePublicTwitterSite } from '../utils/resolvePublicTwitterSite'

import type { SeoOgImageOptions } from '../utils/ogImageDefinition'
import type { MaybeRefOrGetter } from 'vue'

interface SeoOptions {
  author?: string
  canonicalUrl?: string
  description: MaybeRefOrGetter<string>
  image?: string
  keywords?: string[]
  modifiedAt?: string
  ogImage?: SeoOgImageOptions | false
  publishedAt?: string
  robots?: string
  title: MaybeRefOrGetter<string>
  type?: 'website' | 'article' | 'profile'
}

function resolveCanonicalUrl(canonicalUrl?: string, siteUrl?: string) {
  if (!canonicalUrl) return
  if (!siteUrl) return canonicalUrl
  try {
    return new URL(canonicalUrl, siteUrl).toString()
  } catch {
    return canonicalUrl
  }
}

export function useSeo(options: SeoOptions) {
  const {
    title,
    description,
    image,
    type = 'website',
    publishedAt,
    modifiedAt,
    author,
    canonicalUrl,
    keywords,
    ogImage,
    robots,
  } = options
  const siteConfig = useSiteConfig()
  const runtimeConfig = useRuntimeConfig()
  const fallbackSiteUrl =
    typeof runtimeConfig.public.appUrl === 'string' ? runtimeConfig.public.appUrl : undefined
  const fallbackSiteName =
    typeof runtimeConfig.public.appName === 'string' ? runtimeConfig.public.appName : undefined
  const siteUrl =
    typeof siteConfig.url === 'string' && siteConfig.url ? siteConfig.url : fallbackSiteUrl
  const siteName =
    typeof siteConfig.name === 'string' && siteConfig.name ? siteConfig.name : fallbackSiteName
  const resolvedCanonicalUrl = resolveCanonicalUrl(canonicalUrl, siteUrl)
  const resolveTitle = () => toValue(title)
  const resolveDescription = () => toValue(description)
  const shouldDefineDynamicOgImage = !hasNoindexRobots(robots) && ogImage !== false
  const dynamicOgImage = shouldDefineDynamicOgImage
    ? resolveSeoOgImageDefinition({
        title: resolveTitle(),
        description: resolveDescription(),
        type,
        image,
        canonicalUrl: resolvedCanonicalUrl,
        siteUrl,
        siteName,
        ogImage,
      })
    : null

  const twitterSiteFromConfig = resolvePublicTwitterSite(
    runtimeConfig.public as { twitterSite?: string },
  )

  useSeoMeta({
    title: resolveTitle,
    description: resolveDescription,
    ogTitle: resolveTitle,
    ogDescription: resolveDescription,
    // ogType accepts 'website' | 'article' | 'profile' etc.
    ogType: type,
    twitterCard: 'summary_large_image',
    twitterTitle: resolveTitle,
    twitterDescription: resolveDescription,
    ...(twitterSiteFromConfig && { twitterSite: twitterSiteFromConfig }),
    ...(image && !dynamicOgImage && { ogImage: image, twitterImage: image }),
    // Article-specific
    ...(type === 'article' && publishedAt && { articlePublishedTime: publishedAt }),
    ...(type === 'article' && modifiedAt && { articleModifiedTime: modifiedAt }),
    ...(type === 'article' && author && { articleAuthor: [author] }),
    // Keywords
    ...(keywords?.length && { keywords: keywords.join(', ') }),
    // Robots
    ...(robots && { robots }),
  })

  if (resolvedCanonicalUrl) {
    useHead({
      link: [{ rel: 'canonical', href: resolvedCanonicalUrl }],
    })
  }

  if (dynamicOgImage && import.meta.server) {
    defineOgImage(
      dynamicOgImage.component as Parameters<typeof defineOgImage>[0],
      dynamicOgImage.props,
      dynamicOgImage.options,
    )
  }
}
