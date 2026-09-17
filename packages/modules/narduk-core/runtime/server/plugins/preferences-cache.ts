import { defineNitroPlugin } from 'nitropack/runtime'

import {
  applyPreferencesCacheHeaders,
  applyPreferencesCacheToEvent,
  applyPreferencesCacheToWebResponse,
  isPreferencesInfluenced,
} from '../../shared/utils/preferences'

export { applyPreferencesCacheHeaders }

const warnedCachedPreferenceRoutes = new Set<string>()

/**
 * Keep preference-rendered HTML and JSON out of shared caches (narduk-libs#386).
 *
 * `setCacheProfile` covers a route that sets its own cache posture, but only
 * at call time. Marking the event strips headers already written, and this
 * plugin is the last-moment backstop:
 *
 * - `render:response` rewrites the SSR document's header map before Nitro
 *   copies it onto the event.
 * - `beforeResponse` re-checks the flag on every response, including API
 *   routes, where `render:response` never runs.
 *
 * Cloudflare honours `CDN-Cache-Control` over `Cache-Control`, so a marked
 * response drops every shared-cache header, not just `Cache-Control`.
 *
 * `private, no-store` rather than a shorter `private, max-age=…`: the value
 * being protected is another person's display settings, and an app that wants
 * its SSR HTML edge-cached should render canonical values server-side and bind
 * the formatters in the browser instead.
 *
 * Nitro `routeRules.swr` / `cache` / `isr` is a separate in-process cache that
 * this plugin cannot empty: the wrapper stores the first reader's body and
 * replays it without re-running the handler. In development a marked response
 * produced inside that wrapper logs a one-time warning for the path.
 */
export function warnIfPreferenceResponseInsideNitroCache(
  event: { context?: Record<string, unknown>; path?: string },
  isDev = Boolean(import.meta.dev),
): void {
  if (!isDev) return
  if (!isPreferencesInfluenced(event)) return
  const cache = event.context?.cache
  if (!cache || typeof cache !== 'object') return
  const path = typeof event.path === 'string' && event.path.length > 0 ? event.path : '/'
  if (warnedCachedPreferenceRoutes.has(path)) return
  warnedCachedPreferenceRoutes.add(path)
  console.warn(
    `[narduk-core] Preference-influenced response for ${path} ran inside a Nitro cached handler (routeRules swr/cache/isr). The first reader's formatted HTML is stored and replayed to everyone; HTTP Cache-Control cannot prevent that. Do not call usePreferences()/useFormatters()/readPreferences() on a cached route — format in the browser, or drop the cache rule.`,
  )
}

export function resetPreferenceCacheWarningsForTests(): void {
  warnedCachedPreferenceRoutes.clear()
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, context) => {
    if (!isPreferencesInfluenced(context?.event)) return
    response.headers = applyPreferencesCacheHeaders(response.headers ?? {})
  })
  nitro.hooks.hook('beforeResponse', (event, response) => {
    if (!isPreferencesInfluenced(event)) return
    applyPreferencesCacheToEvent(event)
    // h3 writes a returned `Response`'s own headers onto `event.node.res`
    // after this hook, so stripping the event alone is not enough: the
    // response body itself has to be sanitised while it is still mutable.
    const body = (response as { body?: unknown } | undefined)?.body
    const sanitized = applyPreferencesCacheToWebResponse(body)
    if (sanitized && response) (response as { body?: unknown }).body = sanitized
    warnIfPreferenceResponseInsideNitroCache(event)
  })
})
