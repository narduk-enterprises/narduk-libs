import { defineEventHandler, getRequestHost, setResponseHeader } from 'h3'

import { useRuntimeConfig } from '#imports'

import { hostAwareNoindexRule, isNonCanonicalIndexingHost } from '../../shared/hostAwareIndexing'

/**
 * Host-aware indexing guard (module option `hostAwareIndexing`) — non-page half.
 *
 * Production builds that opt in ship ONE immutable version: requests on the
 * canonical site host stay indexable, while the same version served from any
 * other host (for example a route-free `workers.dev` preview alias) gets a
 * `noindex, nofollow` response header at request time. Rendered pages get
 * their header + meta from the sibling app plugin via @nuxtjs/robots (which
 * owns X-Robots-Tag on HTML responses); this middleware covers everything
 * else (APIs, assets). No-op unless the build enabled the flag.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  if (!config.public?.nardukSeoHostAwareIndexing) return

  const requestHost = getRequestHost(event, { xForwardedHost: true })
  if (isNonCanonicalIndexingHost(requestHost, config.public.siteUrl)) {
    setResponseHeader(event, 'X-Robots-Tag', hostAwareNoindexRule)
  }
})
