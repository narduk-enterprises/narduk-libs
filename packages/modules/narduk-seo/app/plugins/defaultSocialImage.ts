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
    () => {
      try {
        return {
          meta: defaultSocialMeta({
            siteUrl: String(site.url || config.public.appUrl || ''),
            siteName: String(site.name || config.public.appName || ''),
            description: String(site.description || config.public.appDescription || ''),
            path: route.path,
            image,
          }),
        }
      } catch (error) {
        // This getter runs on every SSR request: a throw here is a 500 on every
        // page. Unusable configuration omits the defaults instead (#874).
        warnSkipped(error)
        return { meta: [] }
      }
    },
    { tagPriority: 'low' },
  )
})

let warned = false

function warnSkipped(error: unknown): void {
  if (warned) return
  warned = true
  console.warn(
    `[narduk-seo] Default social metadata skipped: ${error instanceof Error ? error.message : String(error)}`,
  )
}
