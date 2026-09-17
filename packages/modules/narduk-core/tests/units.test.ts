import { describe, expect, it } from 'vitest'

import {
  celsiusToFahrenheit,
  createFormatters,
  formatDecimal,
  formatDistance,
  formatHeight,
  formatLength,
  formatPressure,
  formatSpeed,
  formatTemperature,
  formatZonedDate,
  formatZonedDateTime,
  formatZonedTime,
  hectopascalsToInchesOfMercury,
  metresPerSecondToKilometresPerHour,
  metresPerSecondToMilesPerHour,
  metresToFeet,
  metresToMiles,
  NE_EMPTY_VALUE,
} from '../runtime/shared/utils/units'

import type { NePreferences } from '../runtime/shared/utils/preferences'

/** 08:30Z on the day the United States moved its clocks forward in 2026. */
const OBSERVED_AT = '2026-03-08T08:30:00Z'

const IMPERIAL: NePreferences = { locale: 'en-US', timeZone: 'America/Chicago', units: 'imperial' }
const METRIC: NePreferences = { locale: 'de-DE', timeZone: 'Europe/Berlin', units: 'metric' }

describe('conversion accuracy', () => {
  it('uses the exact 1959 international definitions', () => {
    expect(metresToFeet(1)).toBeCloseTo(3.280839895013123, 12)
    expect(metresToMiles(1609.344)).toBe(1)
    expect(metresToFeet(0.3048)).toBeCloseTo(1, 12)
  })

  it('converts speed against the same exact factors', () => {
    expect(metresPerSecondToKilometresPerHour(10)).toBeCloseTo(36, 12)
    expect(metresPerSecondToMilesPerHour(10)).toBeCloseTo(22.369362920544024, 9)
    // 1 knot is 1852 m / 3600 s, which is 1.1507794480235425 mph.
    expect(metresPerSecondToMilesPerHour(1852 / 3600)).toBeCloseTo(1.1507794480235425, 9)
  })

  it('converts temperature at the three fixed points', () => {
    expect(celsiusToFahrenheit(0)).toBe(32)
    expect(celsiusToFahrenheit(100)).toBe(212)
    expect(celsiusToFahrenheit(-40)).toBe(-40)
  })

  it('converts pressure against the conventional inch of mercury', () => {
    expect(hectopascalsToInchesOfMercury(1013.25)).toBeCloseTo(29.92125984, 8)
    expect(hectopascalsToInchesOfMercury(33.8638815789)).toBeCloseTo(1, 9)
  })
})

describe('measurement formatting and rounding', () => {
  it('auto-scales distance at one documented breakpoint per system', () => {
    expect(formatDistance(430, { units: 'metric', locale: 'en-US' })).toBe('430 m')
    expect(formatDistance(4300, { units: 'metric', locale: 'en-US' })).toBe('4.3 km')
    expect(formatDistance(999, { units: 'metric', locale: 'en-US' })).toBe('999 m')
    expect(formatDistance(1000, { units: 'metric', locale: 'en-US' })).toBe('1 km')

    expect(formatDistance(430, { units: 'imperial', locale: 'en-US' })).toBe('1,411 ft')
    expect(formatDistance(4300, { units: 'imperial', locale: 'en-US' })).toBe('2.7 mi')
    expect(formatDistance(1609.343, { units: 'imperial', locale: 'en-US' })).toBe('5,280 ft')
    expect(formatDistance(1609.344, { units: 'imperial', locale: 'en-US' })).toBe('1 mi')
  })

  it('keeps a wave height a height, never a fraction of a mile', () => {
    expect(formatHeight(1.4, { units: 'imperial', locale: 'en-US' })).toBe('4.6 ft')
    expect(formatHeight(1.4, { units: 'metric', locale: 'en-US' })).toBe('1.4 m')
    expect(formatHeight(3000, { units: 'imperial', locale: 'en-US' })).toBe('9,842.5 ft')
  })

  it('renders a wavelength in whole units', () => {
    expect(formatLength(94, { units: 'imperial', locale: 'en-US' })).toBe('308 ft')
    expect(formatLength(94, { units: 'metric', locale: 'en-US' })).toBe('94 m')
  })

  it('renders speed with one decimal in either system', () => {
    expect(formatSpeed(10, { units: 'imperial', locale: 'en-US' })).toBe('22.4 mph')
    expect(formatSpeed(10, { units: 'metric', locale: 'en-US' })).toBe('36 km/h')
  })

  it('renders temperature in whole degrees', () => {
    expect(formatTemperature(20, { units: 'imperial', locale: 'en-US' })).toBe('68\u00b0F')
    expect(formatTemperature(20, { units: 'metric', locale: 'en-US' })).toBe('20\u00b0C')
  })

  it('appends a pressure symbol Intl has no sanctioned unit for', () => {
    expect(formatPressure(1013.25, { units: 'imperial', locale: 'en-US' })).toBe('29.92 inHg')
    expect(formatPressure(1013.25, { units: 'metric', locale: 'en-US' })).toBe('1,013 hPa')
  })

  it('lets a call site override the documented precision', () => {
    expect(formatSpeed(10, { units: 'imperial', locale: 'en-US', maximumFractionDigits: 0 })).toBe(
      '22 mph',
    )
    expect(formatHeight(1.4, { units: 'metric', locale: 'en-US', minimumFractionDigits: 3 })).toBe(
      '1.400 m',
    )
  })
})

describe('locale-formatted numbers', () => {
  it('uses the locale for grouping and the decimal separator', () => {
    expect(formatDecimal(1234567.891, { locale: 'en-US' })).toBe('1,234,567.891')
    expect(formatDecimal(1234567.891, { locale: 'de-DE' })).toBe('1.234.567,891')
    expect(formatDecimal(1234567.891, { locale: 'fr-FR' })).toBe('1\u202f234\u202f567,891')
  })

  it('carries the locale through unit formatting too', () => {
    expect(formatDistance(4300, { units: 'metric', locale: 'de-DE' })).toBe('4,3 km')
  })

  it('falls back to en-US rather than throwing on an invalid locale', () => {
    expect(formatDecimal(1234.5, { locale: 'not!a!locale' })).toBe('1,234.5')
  })
})

describe('absent input', () => {
  const absent = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]

  it.each(absent)('renders the placeholder for %s rather than NaN', (value) => {
    const options = { locale: 'en-US', units: 'imperial' } as const
    expect(formatDistance(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatSpeed(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatTemperature(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatHeight(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatLength(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatPressure(value, options)).toBe(NE_EMPTY_VALUE)
    expect(formatDecimal(value, { locale: 'en-US' })).toBe(NE_EMPTY_VALUE)
  })

  it('renders the placeholder for an unusable date', () => {
    expect(formatZonedDate(null)).toBe(NE_EMPTY_VALUE)
    expect(formatZonedDate(undefined)).toBe(NE_EMPTY_VALUE)
    expect(formatZonedTime('not a date')).toBe(NE_EMPTY_VALUE)
    expect(formatZonedDateTime(new Date(Number.NaN))).toBe(NE_EMPTY_VALUE)
    expect(formatZonedDateTime(Number.NaN)).toBe(NE_EMPTY_VALUE)
  })

  it('takes a per-call placeholder', () => {
    expect(formatSpeed(null, { empty: 'no reading' })).toBe('no reading')
    expect(formatZonedDate(null, { empty: 'no reading' })).toBe('no reading')
  })
})

describe('timezone-aware dates across a DST boundary', () => {
  // The United States moved its clocks forward at 02:00 local on 2026-03-08.
  const before = '2026-03-08T07:30:00Z'
  const after = OBSERVED_AT

  it('renders the hour the zone was actually on, either side of the jump', () => {
    const options = { locale: 'en-US', timeZone: 'America/Chicago' } as const

    expect(formatZonedTime(before, options)).toBe('1:30 AM')
    expect(formatZonedTime(after, options)).toBe('3:30 AM')
  })

  it('names the zone correctly on each side without a hand-rolled table', () => {
    const options = { locale: 'en-US', timeZone: 'America/Chicago', timeZoneName: 'short' } as const

    expect(formatZonedDateTime(before, options)).toBe('Mar 8, 2026, 1:30 AM CST')
    expect(formatZonedDateTime(after, options)).toBe('Mar 8, 2026, 3:30 AM CDT')
  })

  it('is unaffected in a zone that has no daylight saving that day', () => {
    const options = { locale: 'en-US', timeZone: 'Asia/Tokyo' } as const

    expect(formatZonedTime(before, options)).toBe('4:30 PM')
    expect(formatZonedTime(after, options)).toBe('5:30 PM')
  })

  it('defaults to UTC rather than the host zone', () => {
    expect(formatZonedTime(after, { locale: 'en-US' })).toBe('8:30 AM')
    expect(formatZonedDate(after, { locale: 'en-US' })).toBe('Mar 8, 2026')
    expect(formatZonedTime(after, { locale: 'en-US', timeZone: 'Nowhere/Nothing' })).toBe('8:30 AM')
  })

  it('accepts a Date, epoch milliseconds and an ISO string alike', () => {
    const options = { locale: 'en-US', timeZone: 'UTC' } as const
    const expected = 'Mar 8, 2026, 8:30 AM'

    expect(formatZonedDateTime(after, options)).toBe(expected)
    expect(formatZonedDateTime(new Date(after), options)).toBe(expected)
    expect(formatZonedDateTime(Date.parse(after), options)).toBe(expected)
  })
})

describe('createFormatters', () => {
  it('binds a preference set to the whole suite', () => {
    const format = createFormatters(IMPERIAL)

    expect(format.height(1.4)).toBe('4.6 ft')
    expect(format.speed(10)).toBe('22.4 mph')
    expect(format.temperature(20)).toBe('68\u00b0F')
    expect(format.pressure(1013.25)).toBe('29.92 inHg')
    expect(format.distance(4300)).toBe('2.7 mi')
    expect(format.length(94)).toBe('308 ft')
    expect(format.number(1234.5)).toBe('1,234.5')
    expect(format.date(OBSERVED_AT)).toBe('Mar 8, 2026')
    expect(format.time(OBSERVED_AT)).toBe('3:30 AM')
    expect(format.dateTime(OBSERVED_AT)).toBe('Mar 8, 2026, 3:30 AM')
  })

  it('renders the same values the other way for a metric reader', () => {
    const format = createFormatters(METRIC)

    expect(format.height(1.4)).toBe('1,4 m')
    expect(format.temperature(20)).toBe('20 \u00b0C')
    expect(format.dateTime(OBSERVED_AT)).toBe('08.03.2026, 09:30')
  })

  it('reads a getter on every call, so switching units re-renders', () => {
    let preferences: NePreferences = METRIC
    const format = createFormatters(() => preferences)

    expect(format.height(1.4)).toBe('1,4 m')
    preferences = IMPERIAL
    expect(format.height(1.4)).toBe('4.6 ft')
  })

  it('lets one value opt out of the reader units without touching the page', () => {
    const format = createFormatters(IMPERIAL)

    expect(format.height(1.4, { units: 'metric' })).toBe('1.4 m')
    expect(format.time(OBSERVED_AT, { timeZone: 'UTC' })).toBe('8:30 AM')
  })
})
