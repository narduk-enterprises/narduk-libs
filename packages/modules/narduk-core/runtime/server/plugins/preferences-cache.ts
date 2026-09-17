import { defineNitroPlugin } from 'nitropack/runtime'

import { isPreferencesInfluenced, varyWithCookie } from '../../shared/utils/preferences'

/**
 * Keep preference-rendered HTML out of shared caches (narduk-libs#386).
 *
 * `setCacheProfile` covers a route that sets its own cache posture, but the
 * response this actually protects is the rendered page: a Nuxt SSR document
 * whose units, time zone and locale came from one reader's cookie, cached at
 * the edge and handed to the next reader in Fahrenheit.
 *
 * `render:response` is the one hook that sees that document with its headers
 * still mutable. The flag it keys on is set only by `usePreferences()` and
 * `readPreferences()`, so a page that never asked for preferences keeps exactly
 * the cache headers its app configured — this plugin cannot downgrade a route
 * it was not involved in.
 *
 * `private, no-store` rather than a shorter `private, max-age=…`: the value
 * being protected is another person's display settings, and an app that wants
 * its SSR HTML edge-cached should render canonical values server-side and bind
 * the formatters in the browser instead.
 */
export function applyPreferencesCacheHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const kept: Record<string, string | undefined> = {}
  let vary: string | undefined

  // Header names are case-insensitive, and this response's are whatever the
  // app wrote. Drop every case variant of the two being replaced rather than
  // emitting both `Vary` and `vary`.
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase()
    if (lowered === 'cache-control') continue
    if (lowered === 'vary') {
      vary = vary === undefined ? value : `${vary}, ${value ?? ''}`
      continue
    }
    kept[name] = value
  }

  return { ...kept, 'cache-control': 'private, no-store', vary: varyWithCookie(vary) }
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, context) => {
    if (!isPreferencesInfluenced(context?.event)) return
    response.headers = applyPreferencesCacheHeaders(response.headers ?? {})
  })
})
