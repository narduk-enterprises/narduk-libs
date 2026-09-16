import { defineNuxtPlugin, useHead, useRoute, useRuntimeConfig, useSiteConfig } from '#imports'

import { defaultSocialMeta } from '../utils/defaultSocialMeta'

import type { DefaultSocialImage } from '../utils/defaultSocialMeta'

function isDefaultSocialImage(value: unknown): value is DefaultSocialImage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'alt' in value &&
    'url' in value &&
    typeof value.alt === 'string' &&
    typeof value.url === 'string'
  )
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const site = useSiteConfig()
  const route = useRoute()
  const image = config.public.nardukSeoDefaultImage
  if (!isDefaultSocialImage(image)) return
  useHead(
    () => ({
      meta: defaultSocialMeta({
        siteUrl: String(site.url || config.public.appUrl),
        siteName: String(site.name || config.public.appName || ''),
        description: String(site.description || config.public.appDescription || ''),
        path: route.path,
        image,
      }),
    }),
    { tagPriority: 'low' },
  )
})
