import { getCookie, getRequestHeader } from 'h3'

import {
  markPreferencesInfluenced,
  NE_PREFERENCES_COOKIE,
  resolvePreferenceDefaults,
  resolvePreferences,
} from '../../shared/utils/preferences'

import type { NePreferences } from '../../shared/utils/preferences'
import type { H3Event } from 'h3'

/**
 * The reader's units, time zone and locale, inside a Nitro route
 * (narduk-libs#386).
 *
 * The server-side twin of `usePreferences()`, resolving the same cookie against
 * the same documented defaults, for a route that renders or returns
 * preference-dependent content itself.
 *
 * Reading them marks the response as preference-influenced, so `setCacheProfile`
 * downgrades it to `private, no-store` with `Vary: Cookie` rather than letting
 * one reader's units reach another reader out of a shared cache. A route that
 * wants a shared-cacheable response must return canonical SI values and let the
 * browser format them, not call this.
 */
export function readPreferences(event: H3Event): NePreferences {
  markPreferencesInfluenced(event)

  return resolvePreferences({
    cookie: getCookie(event, NE_PREFERENCES_COOKIE),
    defaults: resolvePreferenceDefaults({
      acceptLanguage: getRequestHeader(event, 'accept-language'),
    }),
  })
}
