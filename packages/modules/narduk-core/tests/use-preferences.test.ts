import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import {
  isPreferencesInfluenced,
  NE_PREFERENCES_COOKIE,
  NE_PREFERENCES_COOKIE_MAX_AGE,
  NE_PREFERENCES_STATE_KEY,
} from '../runtime/shared/utils/preferences'

import type { Ref } from 'vue'

const cookieRef: Ref<string | null> = ref(null)
const cookieCalls: Array<{ name: string; options: Record<string, unknown> }> = []
const stateInits: Array<{ key: string; value: unknown }> = []

const requestHeaders: { 'accept-language'?: string } = {
  'accept-language': 'de-DE,de;q=0.9',
}

const requestEvent = { context: {} as Record<string, unknown> }

vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, onMounted: () => {} }
})

vi.mock('#imports', () => ({
  useCookie: (name: string, options: Record<string, unknown>) => {
    cookieCalls.push({ name, options })
    return cookieRef
  },
  useRequestEvent: () => requestEvent,
  useRequestHeaders: (keys: string[]) => {
    expect(keys).toEqual(['accept-language'])
    return requestHeaders
  },
  useState: (key: string, init?: () => unknown) => {
    const value = init?.()
    stateInits.push({ key, value })
    return ref(value)
  },
}))

afterEach(() => {
  cookieRef.value = null
  cookieCalls.length = 0
  stateInits.length = 0
  requestEvent.context = {}
  requestHeaders['accept-language'] = 'de-DE,de;q=0.9'
  vi.unstubAllGlobals()
})

describe('usePreferences wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    cookieCalls.length = 0
    stateInits.length = 0
    requestEvent.context = {}
  })

  it('stores the cookie with Secure outside dev, never httpOnly, and marks the request event', async () => {
    const { usePreferences } = await import('../runtime/app/composables/usePreferences')
    const state = usePreferences()

    expect(cookieCalls).toHaveLength(1)
    expect(cookieCalls[0]?.name).toBe(NE_PREFERENCES_COOKIE)
    expect(cookieCalls[0]?.options).toMatchObject({
      maxAge: NE_PREFERENCES_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      secure: !import.meta.dev,
    })
    expect(cookieCalls[0]?.options).not.toHaveProperty('httpOnly')

    expect(stateInits).toEqual([
      {
        key: NE_PREFERENCES_STATE_KEY,
        value: { locale: 'de-DE', timeZone: 'UTC', units: 'metric' },
      },
    ])
    expect(isPreferencesInfluenced(requestEvent)).toBe(true)
    expect(state.units.value).toBe('metric')
    expect(state.locale.value).toBe('de-DE')
  })

  it('resolves payload defaults from Accept-Language, never navigator.language', async () => {
    const languageSpy = vi.spyOn(globalThis.navigator ?? { language: 'fr-FR' }, 'language', 'get')
    requestHeaders['accept-language'] = 'en-GB,en;q=0.8'

    const { usePreferences } = await import('../runtime/app/composables/usePreferences')
    const state = usePreferences()

    expect(state.locale.value).toBe('en-GB')
    expect(state.units.value).toBe('metric')
    expect(languageSpy).not.toHaveBeenCalled()
  })
})
