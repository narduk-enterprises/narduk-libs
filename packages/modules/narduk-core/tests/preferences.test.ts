import { describe, expect, it } from 'vitest'

import {
  decodePreferencesCookie,
  detectClientTimeZone,
  encodePreferencesCookie,
  isPreferencesInfluenced,
  localeFromAcceptLanguage,
  markPreferencesInfluenced,
  NE_DEFAULT_LOCALE,
  NE_DEFAULT_TIME_ZONE,
  NE_PREFERENCES_COOKIE,
  NE_PREFERENCES_COOKIE_VERSION,
  parseLocale,
  parseTimeZone,
  parseUnitSystem,
  resolvePreferenceDefaults,
  resolvePreferences,
  unitSystemForLocale,
  varyWithCookie,
} from '../runtime/shared/utils/preferences'

/**
 * The cookie is read on every SSR render, so every assertion here is really one
 * question: can a value that arrived from a browser make this module throw, or
 * make it render something other than the documented default? (narduk-libs#386)
 */
describe('preference cookie codec', () => {
  it('round-trips a full selection through a small versioned value', () => {
    const encoded = encodePreferencesCookie({
      locale: 'en-US',
      timeZone: 'America/Chicago',
      units: 'imperial',
    })

    expect(encoded).toBe('v=1&u=imperial&tz=America%2FChicago&l=en-US')
    expect(encoded.length).toBeLessThan(64)
    expect(decodePreferencesCookie(encoded)).toEqual({
      locale: 'en-US',
      timeZone: 'America/Chicago',
      units: 'imperial',
    })
  })

  it('writes only the fields that were actually chosen', () => {
    expect(encodePreferencesCookie({ units: 'metric' })).toBe('v=1&u=metric')
    expect(decodePreferencesCookie('v=1&u=metric')).toEqual({ units: 'metric' })
  })

  it('canonicalises a locale on the way in', () => {
    expect(encodePreferencesCookie({ locale: 'EN-us' })).toBe('v=1&l=en-US')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not a parameter string', 'this is not a cookie we wrote'],
    ['JSON from some other library', '{"units":"metric","timeZone":"America/Chicago"}'],
    ['a future schema version', 'v=2&u=imperial'],
    ['no version at all', 'u=imperial&tz=America/Chicago'],
    ['an unknown unit system', 'v=1&u=furlongs'],
    ['an unknown time zone', 'v=1&tz=Mars%2FOlympus_Mons'],
    ['a structurally invalid locale', 'v=1&l=not!a!tag'],
    ['an oversized value', `v=1&u=${'x'.repeat(600)}`],
  ])('decodes %s to no selection rather than throwing', (_label, raw) => {
    expect(() => decodePreferencesCookie(raw)).not.toThrow()
    expect(decodePreferencesCookie(raw)).toEqual({})
  })

  it('keeps the good fields of a cookie with one bad one', () => {
    expect(decodePreferencesCookie('v=1&u=imperial&tz=Mars%2FOlympus_Mons&l=en-US')).toEqual({
      locale: 'en-US',
      units: 'imperial',
    })
  })

  it('names the cookie and version the rest of the estate depends on', () => {
    expect(NE_PREFERENCES_COOKIE).toBe('ne_prefs')
    expect(NE_PREFERENCES_COOKIE_VERSION).toBe(1)
  })
})

describe('field validation', () => {
  it('accepts the two unit systems and nothing else', () => {
    expect(parseUnitSystem('imperial')).toBe('imperial')
    expect(parseUnitSystem('metric')).toBe('metric')
    expect(parseUnitSystem('Imperial')).toBeUndefined()
    expect(parseUnitSystem(42)).toBeUndefined()
    expect(parseUnitSystem(undefined)).toBeUndefined()
  })

  it('canonicalises locales the runtime understands', () => {
    expect(parseLocale('en-us')).toBe('en-US')
    expect(parseLocale('fr')).toBe('fr')
    expect(parseLocale('')).toBeUndefined()
    expect(parseLocale('en_US!')).toBeUndefined()
  })

  it('accepts only zones the runtime knows', () => {
    expect(parseTimeZone('America/Chicago')).toBe('America/Chicago')
    expect(parseTimeZone('UTC')).toBe('UTC')
    expect(parseTimeZone('Nowhere/Nothing')).toBeUndefined()
  })
})

describe('documented defaults', () => {
  it('is imperial for the United States and metric elsewhere', () => {
    expect(unitSystemForLocale('en-US')).toBe('imperial')
    expect(unitSystemForLocale('es-US')).toBe('imperial')
    expect(unitSystemForLocale('en-GB')).toBe('metric')
    expect(unitSystemForLocale('de-DE')).toBe('metric')
  })

  it('does not make a region-less tag imperial by maximising it', () => {
    // `Intl.Locale('en').maximize()` answers `en-Latn-US`. A tag that does not
    // say where it is gets the world's default, not the United States'.
    expect(unitSystemForLocale('en')).toBe('metric')
  })

  it('picks the highest-quality usable tag from Accept-Language', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en-US')
    expect(localeFromAcceptLanguage('fr;q=0.8,de-DE;q=0.9')).toBe('de-DE')
    expect(localeFromAcceptLanguage('*')).toBeUndefined()
    expect(localeFromAcceptLanguage('not!a!tag, de-DE')).toBe('de-DE')
    expect(localeFromAcceptLanguage(undefined)).toBeUndefined()
    expect(localeFromAcceptLanguage(`${'en-US,'.repeat(200)}en`)).toBeUndefined()
  })

  it('falls back to en-US, imperial and UTC with no header at all', () => {
    expect(resolvePreferenceDefaults()).toEqual({
      locale: NE_DEFAULT_LOCALE,
      timeZone: NE_DEFAULT_TIME_ZONE,
      units: 'imperial',
    })
  })

  it('derives units from the Accept-Language locale', () => {
    expect(resolvePreferenceDefaults({ acceptLanguage: 'de-DE,de;q=0.9' })).toEqual({
      locale: 'de-DE',
      timeZone: 'UTC',
      units: 'metric',
    })
  })

  it('never defaults the time zone to the host zone', () => {
    // The server cannot know the browser's zone on a first request, so any
    // host-derived default renders one string on the server and another in the
    // browser. UTC on both sides is the whole hydration contract.
    expect(resolvePreferenceDefaults({ acceptLanguage: 'de-DE' }).timeZone).toBe('UTC')
    expect(detectClientTimeZone()).not.toBe(undefined)
  })

  it('lets the cookie win field by field over the defaults', () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'de-DE' })

    expect(resolvePreferences({ cookie: 'v=1&u=imperial', defaults })).toEqual({
      locale: 'de-DE',
      timeZone: 'UTC',
      units: 'imperial',
    })
  })

  it('resolves a garbage cookie to the defaults rather than failing', () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-GB' })

    expect(resolvePreferences({ cookie: '%%%not-a-cookie%%%', defaults })).toEqual(defaults)
  })
})

describe('cache-safety marking', () => {
  it('marks and reads an event context', () => {
    const event = { context: {} as Record<string, unknown> }

    expect(isPreferencesInfluenced(event)).toBe(false)
    markPreferencesInfluenced(event)
    expect(isPreferencesInfluenced(event)).toBe(true)
  })

  it('is a no-op on the client, where there is no event', () => {
    expect(() => markPreferencesInfluenced(null)).not.toThrow()
    expect(() => markPreferencesInfluenced(undefined)).not.toThrow()
    expect(() => markPreferencesInfluenced({})).not.toThrow()
    expect(isPreferencesInfluenced(undefined)).toBe(false)
  })

  it('merges Cookie into an existing Vary without duplicating it', () => {
    expect(varyWithCookie(undefined)).toBe('Cookie')
    expect(varyWithCookie('Accept-Encoding')).toBe('Accept-Encoding, Cookie')
    expect(varyWithCookie('cookie')).toBe('cookie')
    expect(varyWithCookie('Accept-Encoding, Cookie')).toBe('Accept-Encoding, Cookie')
    expect(varyWithCookie('*')).toBe('*')
  })
})

describe('hostile cookie values never throw from the decoder', () => {
  it('keeps a page rendering when the cookie carries an unknown zone or invalid tag', async () => {
    const { createFormatters } = await import('../runtime/shared/utils/units')
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-US' })
    const preferences = resolvePreferences({
      cookie: 'v=1&tz=Not%2FAZone&l=not!a!tag&u=imperial',
      defaults,
    })

    expect(preferences).toEqual({ locale: 'en-US', timeZone: 'UTC', units: 'imperial' })
    const format = createFormatters(preferences)
    expect(() => format.date('2026-03-08T00:00:00Z')).not.toThrow()
    expect(() => format.height(1.4)).not.toThrow()
    expect(format.date('2026-03-08T00:00:00Z')).toBe('Mar 8, 2026')
    expect(format.height(1.4)).toBe('4.6 ft')
  })
})
