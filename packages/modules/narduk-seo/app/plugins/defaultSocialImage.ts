import { defineNuxtPlugin, useHead, useRoute, useRuntimeConfig, useSiteConfig } from '#imports'

import { defaultSocialMeta } from '../utils/defaultSocialMeta'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const site = useSiteConfig()
  const route = useRoute()
  const image = config.public.nardukSeoDefaultImage
  if (!image) return
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
