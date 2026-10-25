import { markHtmlCacheSkipped } from '../../shared/html-cache'

import type { H3Event } from 'h3'

/**
 * Mark the current render as not storable by `nardukCore.htmlCache`.
 *
 * For a page that still answers 200 but rendered without its data (a release
 * unavailable, an empty lookup): the edge cache would otherwise keep that render for
 * the TTL and serve it to everyone. Call it from a Nitro handler or middleware; a page
 * or component `setup` calls `useSkipHtmlCache()`. The response carries
 * `x-html-cache: skip`. Auto-imported in Nitro.
 */
export function skipHtmlCache(event: H3Event | null | undefined): void {
  markHtmlCacheSkipped(event)
}
