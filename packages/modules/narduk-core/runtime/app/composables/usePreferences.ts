// Explicit imports (not Nuxt auto-imports): packed package consumers compile this file outside the owning Nuxt source tree, so Vue and Nuxt APIs must be explicit.
import { useCookie, useRequestEvent, useRequestHeaders, useState } from '#imports'

import {
  detectClientTimeZone,
  markPreferencesInfluenced,
  NE_PREFERENCES_COOKIE,
  NE_PREFERENCES_COOKIE_MAX_AGE,
  NE_PREFERENCES_STATE_KEY,
  resolvePreferenceDefaults,
} from '../../shared/utils/preferences'
import { createPreferencesState } from '../utils/preferencesState'

import type { NePreferencesState } from '../utils/preferencesState'

/**
 * The reader's units, time zone and locale (narduk-libs#386).
 *
 * ```vue
 * <script setup lang="ts">
 * const { preferences, setUnits, units } = usePreferences()
 * </script>
 * ```
 *
 * This function is only the wiring; {@link createPreferencesState} holds the
 * behaviour and its tests. Three Nuxt bindings are supplied here:
 *
 * - **`useCookie`** for the one versioned preference cookie, so the value is
 *   readable during SSR and there is no flash of the wrong unit.
 * - **`useState`** for the defaults the server derived from `Accept-Language`.
 *   Resolving them once on the server and carrying them in the payload is what
 *   makes the client's first render reproduce the server's markup exactly.
 * - **`useRequestEvent`** to mark the response as preference-influenced, so a
 *   page rendered with one reader's units is never served to another reader
 *   from a shared cache. See `markPreferencesInfluenced`.
 */
export function usePreferences(): NePreferencesState {
  const cookie = useCookie<string | null>(NE_PREFERENCES_COOKIE, {
    maxAge: NE_PREFERENCES_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
  })

  const defaults = useState(NE_PREFERENCES_STATE_KEY, () =>
    resolvePreferenceDefaults({
      acceptLanguage: useRequestHeaders(['accept-language'])['accept-language'],
    }),
  )

  markPreferencesInfluenced(useRequestEvent())

  return createPreferencesState({ cookie, defaults, detectTimeZone: detectClientTimeZone })
}
