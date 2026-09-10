import { defineNuxtPlugin, useHead, useRequestURL, useRobotsRule, useRuntimeConfig } from '#imports'

import { hostAwareNoindexRule, isNonCanonicalIndexingHost } from '../../shared/hostAwareIndexing'

/**
 * Host-aware indexing guard (module option `hostAwareIndexing`) — page half.
 *
 * When the request host is not the canonical site host, route the noindex
 * decision through @nuxtjs/robots' server composable, which emits both the
 * robots meta tag and the `X-Robots-Tag` response header for rendered pages.
 * Its client implementation relies on a component lifecycle hook, so client
 * navigation uses Nuxt's app-safe head API instead. The sibling server
 * middleware still covers non-rendered routes. Registered only when the build
 * enabled host-aware indexing.
 */
export function applyHostAwareNoindexRule(isServer: boolean): void {
  if (isServer) {
    useRobotsRule(hostAwareNoindexRule)
    return
  }

  useHead({
    meta: [
      {
        name: 'robots',
        content: hostAwareNoindexRule,
      },
    ],
  })
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.nardukSeoHostAwareIndexing) return

  const url = useRequestURL()
  if (isNonCanonicalIndexingHost(url.host, config.public.siteUrl)) {
    applyHostAwareNoindexRule(import.meta.server)
  }
})
