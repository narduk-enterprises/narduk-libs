// Explicit import (not a Nuxt auto-import): packed package consumers compile this file outside the owning Nuxt source tree, so Vue APIs must be explicit.
import { computed, onMounted } from 'vue'

import {
  decodePreferencesCookie,
  encodePreferencesCookie,
  parseLocale,
  parseTimeZone,
  parseUnitSystem,
  resolvePreferences,
} from '../../shared/utils/preferences'

import type { NePreferenceSelection, NePreferences, NeUnitSystem } from '../../shared/utils/preferences'
import type { ComputedRef, Ref } from 'vue'

/**
 * The reactive half of the preference store, with the Nuxt bindings injected
 * (narduk-libs#386).
 *
 * `usePreferences()` is a thin adapter over this function: it supplies the
 * `useCookie` ref, the `useState` ref carrying the server's resolved defaults,
 * and the browser's zone detector. Everything that decides what a reader
 * actually sees lives here, where a test can drive it with real Vue reactivity
 * and render it through both `renderToString` and a real client hydrate.
 *
 * ## The hydration contract
 *
 * The first client render must produce byte-identical markup to the server's,
 * so both sides read the *same two inputs*:
 *
 * 1. the cookie — `useCookie` gives the same value on both sides; and
 * 2. the defaults — resolved once on the server from `Accept-Language` and
 *    carried to the client in the Nuxt payload, never re-derived from
 *    `navigator.language`, which can disagree with the header.
 *
 * The browser's time zone is the one input the server cannot have. It is
 * therefore *not* read during setup. After mount, and only when the cookie
 * carries no zone of its own, {@link createPreferencesState} writes the
 * detected zone into the cookie; that is an ordinary reactive update on an
 * already-hydrated page, not a mismatch. Until it happens the reader sees UTC,
 * which is the documented default rather than a wrong guess.
 */
export interface PreferencesStateBindings {
  /**
   * Adopt the browser's own time zone after mount when the cookie carries
   * none. Defaults to true; pass false for an app that wants UTC until the
   * reader chooses otherwise.
   */
  adoptClientTimeZone?: boolean
  /** The raw preference cookie. `useCookie(NE_PREFERENCES_COOKIE)`. */
  cookie: Ref<string | null | undefined>
  /** The server-resolved defaults, carried in the payload. `useState(...)`. */
  defaults: Ref<NePreferences> | ComputedRef<NePreferences>
  /** Reads the browser's IANA zone. Only ever called after mount. */
  detectTimeZone?: () => string | undefined
  /**
   * Registers a post-mount callback. Defaults to Vue's `onMounted`, which
   * never fires during SSR — that is the point.
   */
  onMount?: (callback: () => void) => void
}

/** What {@link createPreferencesState} hands back. */
export interface NePreferencesState {
  /** The reader's locale. */
  locale: ComputedRef<string>
  /** The resolved preference set: cookie over payload defaults. */
  preferences: ComputedRef<NePreferences>
  /** Clear the cookie and fall back to the request-derived defaults. */
  reset: () => void
  /** Persist a locale. An invalid tag is ignored rather than thrown. */
  setLocale: (locale: string) => void
  /** Persist an IANA time zone. An unknown zone is ignored rather than thrown. */
  setTimeZone: (timeZone: string) => void
  /** Persist a unit system. An unknown system is ignored rather than thrown. */
  setUnits: (units: NeUnitSystem) => void
  /** The reader's time zone. */
  timeZone: ComputedRef<string>
  /** The reader's unit system. */
  units: ComputedRef<NeUnitSystem>
}

/**
 * Build the reactive preference store over injected bindings.
 *
 * Setters merge into the existing selection rather than replacing it, so
 * choosing units does not silently discard a time zone the reader picked
 * earlier. An invalid value is dropped and the cookie is left untouched: these
 * setters are wired to user-facing controls, and a thrown `RangeError` from a
 * select element is a 500 nobody wants.
 */
export function createPreferencesState(
  bindings: PreferencesStateBindings,
): NePreferencesState {
  const { cookie, defaults } = bindings

  const preferences = computed(() =>
    resolvePreferences({ cookie: cookie.value, defaults: defaults.value }),
  )

  function update(patch: NePreferenceSelection): void {
    const next = { ...decodePreferencesCookie(cookie.value), ...patch }
    cookie.value = encodePreferencesCookie(next)
  }

  function setUnits(units: NeUnitSystem): void {
    const parsed = parseUnitSystem(units)
    if (parsed) update({ units: parsed })
  }

  function setTimeZone(timeZone: string): void {
    const parsed = parseTimeZone(timeZone)
    if (parsed) update({ timeZone: parsed })
  }

  function setLocale(locale: string): void {
    const parsed = parseLocale(locale)
    if (parsed) update({ locale: parsed })
  }

  function reset(): void {
    cookie.value = null
  }

  if (bindings.adoptClientTimeZone !== false && bindings.detectTimeZone) {
    const register = bindings.onMount ?? onMounted
    register(() => {
      if (decodePreferencesCookie(cookie.value).timeZone) return
      const detected = bindings.detectTimeZone?.()
      if (!detected || detected === preferences.value.timeZone) return
      setTimeZone(detected)
    })
  }

  return {
    locale: computed(() => preferences.value.locale),
    preferences,
    reset,
    setLocale,
    setTimeZone,
    setUnits,
    timeZone: computed(() => preferences.value.timeZone),
    units: computed(() => preferences.value.units),
  }
}
