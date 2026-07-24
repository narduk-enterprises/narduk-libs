import { defineNuxtPlugin, useRequestURL, useRobotsRule, useRuntimeConfig } from '#imports'

import { hostAwareNoindexRule, isNonCanonicalIndexingHost } from '../../shared/hostAwareIndexing'

/**
 * Host-aware indexing guard (module option `hostAwareIndexing`) — page half.
 *
 * When the request host is not the canonical site host, route the noindex
 * decision through @nuxtjs/robots' own `useRobotsRule`, which emits BOTH the
 * matching robots meta tag and the `X-Robots-Tag` response header for
 * rendered pages (the robots module owns that header on HTML responses and
 * would otherwise overwrite a bare middleware header with its indexable
 * default). The sibling server middleware still covers non-rendered routes.
 * Registered only when the build enabled host-aware indexing.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.nardukSeoHostAwareIndexing) return

  const url = useRequestURL()
  if (isNonCanonicalIndexingHost(url.host, config.public.siteUrl)) {
    useRobotsRule(hostAwareNoindexRule)
  }
})
