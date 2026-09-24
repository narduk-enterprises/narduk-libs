/**
 * Preference-aware formatters (narduk-libs#386).
 *
 * ## What these are for
 *
 * A Narduk app stores measurements in SI — metres, metres per second, degrees
 * Celsius, hectopascals — and displays them in whatever the reader asked for.
 * These functions are that last step, and nothing else: conversion plus
 * `Intl.NumberFormat` / `Intl.DateTimeFormat`. Adoption is per value, at the
 * call site. There is no global switch and no automatic rewriting of an app's
 * existing display code.
 *
 * ## Rules the whole suite keeps
 *
 * - **Pure and tree-shakeable.** Every formatter is a standalone `export
 *   function` over its arguments. Import one and the rest do not ship.
 * - **No ambient clock, no ambient zone, no ambient locale.** `timeZone` and
 *   `locale` are arguments; when they are missing the documented fallbacks
 *   (`UTC`, `en-US`) apply, never the host's. A formatter that reads the host's
 *   zone renders one string on the server and another in the browser, which is
 *   a hydration mismatch — see `narduk-shell/format`'s header for the four
 *   times the estate shipped exactly that bug. Offset-less date-time strings
 *   (`2026-03-08T00:00:00`) are treated as UTC, never as the host's local
 *   zone, for the same reason. A bare `YYYY-MM-DD` is a floating calendar date
 *   in {@link formatZonedDate} only.
 * - **Absent input has one answer.** `null`, `undefined`, `NaN`, `Infinity` and
 *   an unparseable date all render {@link NE_EMPTY_VALUE} (an em dash). No
 *   call site has to guard, and no user ever sees `NaN ft`.
 * - **No new dependency.** `Intl` does the work.
 *
 * ## Units `Intl` does not know
 *
 * `Intl.NumberFormat`'s sanctioned unit list has no entry for hectopascals or
 * inches of mercury, so {@link formatPressure} formats the number through
 * `Intl` and appends the symbol itself. Everything else uses a real `style:
 * 'unit'` so the locale decides spacing and the symbol's form.
 */

import type { NePreferences, NeUnitSystem } from './preferences'

/** Rendered for `null`, `undefined`, `NaN`, `Infinity` and unparseable dates. */
export const NE_EMPTY_VALUE = '—'

/** Locale used when none is supplied. Fixed, never the host locale. */
const FALLBACK_LOCALE = 'en-US'

/** Time zone used when none is supplied. Fixed, never the host zone. */
const FALLBACK_TIME_ZONE = 'UTC'

/* -------------------------------------------------------------------------- */
/* Exact conversion factors                                                   */
/* -------------------------------------------------------------------------- */

/** Exact, by the 1959 international yard and pound agreement. */
export const METRES_PER_FOOT = 0.3048

/** Exact: 5280 international feet. */
export const METRES_PER_MILE = 1609.344

/** Exact: 3600 seconds per hour over {@link METRES_PER_MILE}. */
const MPS_TO_MPH = 3600 / METRES_PER_MILE

/** Exact: 3600 seconds per hour over 1000 metres. */
const MPS_TO_KPH = 3.6

/** Exact, by the definition of the conventional millimetre of mercury. */
export const HECTOPASCALS_PER_INHG = 33.8638815789

/** Metric distances at or above this render as kilometres rather than metres. */
const METRIC_DISTANCE_BREAKPOINT = 1000

/** Imperial distances at or above this render as miles rather than feet. */
const IMPERIAL_DISTANCE_BREAKPOINT = METRES_PER_MILE

/** Exact, by the 1929 international definition of the nautical mile. */
export const METRES_PER_NAUTICAL_MILE = 1852

/** Exact: 3600 seconds per hour over {@link METRES_PER_NAUTICAL_MILE}. */
const MPS_TO_KNOTS = 3600 / METRES_PER_NAUTICAL_MILE

/** Degrees Celsius to degrees Fahrenheit. */
export function celsiusToFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32
}

/** Metres to feet. */
export function metresToFeet(metres: number): number {
  return metres / METRES_PER_FOOT
}

/** Metres to statute miles. */
export function metresToMiles(metres: number): number {
  return metres / METRES_PER_MILE
}

/** Metres per second to miles per hour. */
export function metresPerSecondToMilesPerHour(metresPerSecond: number): number {
  return metresPerSecond * MPS_TO_MPH
}

/** Metres per second to kilometres per hour. */
export function metresPerSecondToKilometresPerHour(metresPerSecond: number): number {
  return metresPerSecond * MPS_TO_KPH
}

/** Hectopascals to inches of mercury. */
export function hectopascalsToInchesOfMercury(hectopascals: number): number {
  return hectopascals / HECTOPASCALS_PER_INHG
}

/** Metres per second to knots (nautical miles per hour). */
export function metresPerSecondToKnots(metresPerSecond: number): number {
  return metresPerSecond * MPS_TO_KNOTS
}

/*
 * The inverses. Stored values are SI, so these are for input — a form field,
 * a query parameter, or a feed that publishes in the other system
 * (narduk-libs#518).
 */

/** Degrees Fahrenheit to degrees Celsius. */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) / 1.8
}

/** Feet to metres. */
export function feetToMetres(feet: number): number {
  return feet * METRES_PER_FOOT
}

/** Statute miles to metres. */
export function milesToMetres(miles: number): number {
  return miles * METRES_PER_MILE
}

/** Miles per hour to metres per second. */
export function milesPerHourToMetresPerSecond(milesPerHour: number): number {
  return milesPerHour / MPS_TO_MPH
}

/** Kilometres per hour to metres per second. */
export function kilometresPerHourToMetresPerSecond(kilometresPerHour: number): number {
  return kilometresPerHour / MPS_TO_KPH
}

/** Knots to metres per second. */
export function knotsToMetresPerSecond(knots: number): number {
  return knots / MPS_TO_KNOTS
}

/** Inches of mercury to hectopascals. */
export function inchesOfMercuryToHectopascals(inchesOfMercury: number): number {
  return inchesOfMercury * HECTOPASCALS_PER_INHG
}

/* -------------------------------------------------------------------------- */
/* Compass                                                                    */
/* -------------------------------------------------------------------------- */

/** The sixteen compass points, clockwise from north. */
export const NE_COMPASS_POINTS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const

/** One of {@link NE_COMPASS_POINTS_16}. */
export type NeCompassPoint16 = (typeof NE_COMPASS_POINTS_16)[number]

/**
 * The nearest of the sixteen compass points to a bearing in degrees, or
 * `undefined` for absent or non-finite input.
 *
 * Any finite bearing works: `-30` and `330` are both `NNW`, `720` is `N`. JS
 * `%` keeps the dividend's sign, so the index is normalised twice; a single
 * `% 16` turned a negative bearing into `undefined` in Buoys' copy of this
 * (narduk-libs#518). Each point owns 22.5°, centred on it, so `11.25` rounds
 * up to `NNE`.
 */
export function compassPoint16(degrees: number | null | undefined): NeCompassPoint16 | undefined {
  if (!isRenderable(degrees)) return undefined
  const count = NE_COMPASS_POINTS_16.length
  const index = ((Math.round(degrees / (360 / count)) % count) + count) % count
  return NE_COMPASS_POINTS_16[index]
}

/* -------------------------------------------------------------------------- */
/* Shared option shapes                                                       */
/* -------------------------------------------------------------------------- */

/** What every measurement formatter accepts. */
export interface NeMeasurementOptions {
  /** Rendered for absent or non-finite input. Defaults to {@link NE_EMPTY_VALUE}. */
  empty?: string
  /** BCP-47 tag. Defaults to `en-US`. */
  locale?: string
  /** Override the formatter's documented precision. */
  maximumFractionDigits?: number
  /** Override the formatter's documented precision. */
  minimumFractionDigits?: number
  /** `Intl`'s `unitDisplay`. Defaults to `short` (`12 km`, `54 mph`). */
  unitDisplay?: 'long' | 'narrow' | 'short'
  /** Which system to convert into. Defaults to `metric`. */
  units?: NeUnitSystem
}

/** {@link formatDecimal}'s options. A plain number carries no unit. */
export type NeDecimalOptions = Omit<NeMeasurementOptions, 'unitDisplay' | 'units'>

/** What every date formatter accepts. */
export type NeDateInput = Date | number | string | null | undefined

/** `Intl.DateTimeFormat`'s own style vocabulary. */
export type NeDateStyle = 'full' | 'long' | 'medium' | 'short'

/** Options shared by the zoned date and time formatters. */
export interface NeZonedOptions {
  /** `Intl`'s `dateStyle`. Defaults to `medium`. */
  dateStyle?: NeDateStyle
  /** Rendered for absent or unparseable input. Defaults to {@link NE_EMPTY_VALUE}. */
  empty?: string
  /** BCP-47 tag. Defaults to `en-US`. */
  locale?: string
  /** `Intl`'s `timeStyle`. Defaults to `short`. */
  timeStyle?: NeDateStyle
  /** IANA zone name. Defaults to `UTC` — never the host zone. */
  timeZone?: string
  /** Append the zone's name, e.g. `CST`. `Intl` owns the DST transition dates. */
  timeZoneName?: 'long' | 'longOffset' | 'short' | 'shortOffset'
}

/* -------------------------------------------------------------------------- */
/* Intl instance cache                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Memoised `Intl` constructors.
 *
 * A formatter runs once per cell, so constructing `Intl.*Format` per call is
 * the measured cost. The key is the locale plus the full option set with its
 * keys sorted, so two callers spelling the same options in a different order
 * share one instance.
 *
 * The cap exists because an option set can in principle be derived from data
 * (`digits` off a column definition, `timeZone` off a row), which is the one
 * way this could grow with the working set rather than with the code. Clearing
 * wholesale rather than evicting one entry keeps that to a branch and a
 * `Map.clear()`: real call sites re-populate a handful of entries immediately,
 * and an adversarial one pays a rebuild instead of growing without bound.
 */
const MAX_CACHE_ENTRIES = 256
const numberFormatCache = new Map<string, Intl.NumberFormat>()
const dateFormatCache = new Map<string, Intl.DateTimeFormat>()

function intlCacheKey(locale: string, options: object): string {
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([first], [second]) => (first < second ? -1 : 1))
  return `${locale}\u0000${JSON.stringify(entries)}`
}

function cached<T>(cache: Map<string, T>, locale: string, options: object, build: () => T): T {
  const key = intlCacheKey(locale, options)
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
  const created = build()
  cache.set(key, created)
  return created
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(numberFormatCache, locale, options, () => new Intl.NumberFormat(locale, options))
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(dateFormatCache, locale, options, () => new Intl.DateTimeFormat(locale, options))
}

/** Test seam: empty the isolate-lifetime Intl caches. */
export function clearFormatterCachesForTests(): void {
  numberFormatCache.clear()
  dateFormatCache.clear()
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function isRenderable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function digits(
  options: NeMeasurementOptions | NeDecimalOptions,
  fallback: number,
): Pick<Intl.NumberFormatOptions, 'maximumFractionDigits' | 'minimumFractionDigits'> {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0
  // A caller who asks for more minimum digits than the formatter's documented
  // precision means it: raise the ceiling rather than silently clamping the
  // floor, which `Intl` would reject outright.
  const maximumFractionDigits =
    options.maximumFractionDigits ?? Math.max(fallback, minimumFractionDigits)
  return {
    maximumFractionDigits,
    minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits),
  }
}

/**
 * A locale a formatter can hand to `Intl` without risk. An invalid tag makes
 * every `Intl` constructor throw `RangeError`, and a formatter that throws on a
 * bad preference is a 500 on a page whose only fault is a stale cookie.
 */
function safeLocale(locale: string | undefined): string {
  if (!locale) return FALLBACK_LOCALE
  try {
    Intl.getCanonicalLocales(locale)
    return locale
  } catch {
    return FALLBACK_LOCALE
  }
}

function formatUnit(
  value: number,
  unit: string,
  options: NeMeasurementOptions,
  fallbackDigits: number,
): string {
  const locale = safeLocale(options.locale)
  try {
    return numberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: options.unitDisplay ?? 'short',
      ...digits(options, fallbackDigits),
    }).format(value)
  } catch {
    /* A runtime without this sanctioned unit still gets a readable number. */
    return numberFormat(locale, digits(options, fallbackDigits)).format(value)
  }
}

/**
 * A bare `YYYY-MM-DD`. `Date.parse('2026-03-08')` is midnight **UTC**, so
 * rendering it in `America/Chicago` shows the 7th — the most common way a date
 * lands on screen one day early. {@link formatZonedDate} treats a value of this
 * shape as a calendar date with no instant.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * An ISO date-time with no `Z` or numeric offset. `Date.parse` of that shape
 * is the **host** zone, so a Worker (UTC) and a Chicago browser disagree.
 * These formatters treat it as UTC instead.
 */
const OFFSET_LESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/

/** Coerce the accepted date inputs to milliseconds, or `undefined` if unusable. */
function toEpochMilliseconds(value: NeDateInput): number | undefined {
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const normalised = OFFSET_LESS_DATE_TIME.test(value) ? `${value}Z` : value
  const parsed = Date.parse(normalised)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * A zone `Intl` accepts. An unknown zone throws `RangeError`, and the cookie
 * decoder already rejects those; this is the second line for a caller passing
 * a zone straight through from its own data.
 */
function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

/**
 * The zone's own name, read from a second formatter and appended.
 * `Intl.DateTimeFormat` throws a `TypeError` when `timeZoneName` is combined
 * with `dateStyle`/`timeStyle`, and reassembling the stamp out of component
 * options would take the date and time themselves out of `Intl`'s
 * locale-correct hands. `Intl` owns the DST transition dates, for every zone
 * and every year — which is the point of not hand-rolling a table.
 */
function zoneName(
  at: Date,
  locale: string,
  timeZone: string,
  style: NonNullable<NeZonedOptions['timeZoneName']>,
): string | undefined {
  return dateFormat(locale, { timeZone, timeZoneName: style })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
}

function formatZoned(
  value: NeDateInput,
  options: NeZonedOptions,
  parts: Pick<Intl.DateTimeFormatOptions, 'dateStyle' | 'timeStyle'>,
): string {
  const milliseconds = toEpochMilliseconds(value)
  if (milliseconds === undefined) return options.empty ?? NE_EMPTY_VALUE

  const at = new Date(milliseconds)
  const locale = safeLocale(options.locale)
  const timeZone = safeTimeZone(options.timeZone)
  const stamp = dateFormat(locale, { ...parts, timeZone }).format(at)
  if (!options.timeZoneName) return stamp

  const zone = zoneName(at, locale, timeZone, options.timeZoneName)
  return zone ? `${stamp} ${zone}` : stamp
}

/* -------------------------------------------------------------------------- */
/* Measurement formatters                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A distance, given in **metres**.
 *
 * Auto-scales at one natural breakpoint per system: metric renders metres below
 * a kilometre and kilometres above it, imperial renders feet below a mile and
 * miles above it. The small unit carries no decimals, the large one carries one.
 *
 * ```ts
 * formatDistance(430, { units: 'metric' })    // '430 m'
 * formatDistance(4300, { units: 'metric' })   // '4.3 km'
 * formatDistance(430, { units: 'imperial' })  // '1,411 ft'
 * formatDistance(4300, { units: 'imperial' }) // '2.7 mi'
 * ```
 */
export function formatDistance(
  metres: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(metres)) return options.empty ?? NE_EMPTY_VALUE

  if (options.units === 'imperial') {
    return Math.abs(metres) >= IMPERIAL_DISTANCE_BREAKPOINT
      ? formatUnit(metresToMiles(metres), 'mile', options, 1)
      : formatUnit(metresToFeet(metres), 'foot', options, 0)
  }
  return Math.abs(metres) >= METRIC_DISTANCE_BREAKPOINT
    ? formatUnit(metres / 1000, 'kilometer', options, 1)
    : formatUnit(metres, 'meter', options, 0)
}

/**
 * A speed, given in **metres per second**: miles per hour in imperial,
 * kilometres per hour in metric. One decimal by default.
 *
 * Knots are not a third option: the preference store has two systems, and a
 * maritime app that wants knots should say so at the call site rather than have
 * a unit preference mean something different from what it says.
 */
export function formatSpeed(
  metresPerSecond: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(metresPerSecond)) return options.empty ?? NE_EMPTY_VALUE

  return options.units === 'imperial'
    ? formatUnit(metresPerSecondToMilesPerHour(metresPerSecond), 'mile-per-hour', options, 1)
    : formatUnit(
        metresPerSecondToKilometresPerHour(metresPerSecond),
        'kilometer-per-hour',
        options,
        1,
      )
}

/**
 * A temperature, given in **degrees Celsius**: Fahrenheit in imperial, Celsius
 * in metric. Whole degrees by default.
 */
export function formatTemperature(
  celsius: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(celsius)) return options.empty ?? NE_EMPTY_VALUE

  return options.units === 'imperial'
    ? formatUnit(celsiusToFahrenheit(celsius), 'fahrenheit', options, 0)
    : formatUnit(celsius, 'celsius', options, 0)
}

/**
 * A short vertical distance, given in **metres**: feet in imperial, metres in
 * metric, one decimal, and never auto-scaled to miles. This is the wave-height
 * and tide-height formatter — a 1.4 m swell must not become `0.0 mi`.
 */
export function formatHeight(
  metres: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(metres)) return options.empty ?? NE_EMPTY_VALUE

  return options.units === 'imperial'
    ? formatUnit(metresToFeet(metres), 'foot', options, 1)
    : formatUnit(metres, 'meter', options, 1)
}

/**
 * A short horizontal distance, given in **metres**: feet in imperial, metres in
 * metric, whole units, never auto-scaled. This is the wavelength formatter.
 */
export function formatLength(
  metres: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(metres)) return options.empty ?? NE_EMPTY_VALUE

  return options.units === 'imperial'
    ? formatUnit(metresToFeet(metres), 'foot', options, 0)
    : formatUnit(metres, 'meter', options, 0)
}

/**
 * A barometric pressure, given in **hectopascals**: inches of mercury in
 * imperial (two decimals), hectopascals in metric (whole units).
 *
 * `Intl`'s sanctioned unit list has neither unit, so the symbol is appended
 * after the locale-formatted number rather than produced by `style: 'unit'`.
 */
export function formatPressure(
  hectopascals: number | null | undefined,
  options: NeMeasurementOptions = {},
): string {
  if (!isRenderable(hectopascals)) return options.empty ?? NE_EMPTY_VALUE

  const locale = safeLocale(options.locale)
  if (options.units === 'imperial') {
    const inches = hectopascalsToInchesOfMercury(hectopascals)
    return `${numberFormat(locale, digits(options, 2)).format(inches)} inHg`
  }
  return `${numberFormat(locale, digits(options, 0)).format(hectopascals)} hPa`
}

/**
 * A plain locale-formatted number, for values that carry no unit at all
 * (a count, a ratio already expressed as a number, a station identifier that
 * happens to be numeric). Up to three decimals by default, matching `Intl`.
 */
export function formatDecimal(
  value: number | null | undefined,
  options: NeDecimalOptions = {},
): string {
  if (!isRenderable(value)) return options.empty ?? NE_EMPTY_VALUE
  return numberFormat(safeLocale(options.locale), digits(options, 3)).format(value)
}

/* -------------------------------------------------------------------------- */
/* Date and time formatters                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A calendar date in the given zone. `medium` style by default.
 *
 * A bare `YYYY-MM-DD` string is treated as a **calendar date, not an instant**
 * and renders as itself in every zone. `Date.parse('2026-03-08')` is midnight
 * UTC, so the ordinary reading shows `Mar 7` for every zone west of Greenwich.
 * {@link formatZonedDateTime} deliberately does *not* do this.
 */
export function formatZonedDate(value: NeDateInput, options: NeZonedOptions = {}): string {
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) {
    const milliseconds = toEpochMilliseconds(`${value}T12:00:00Z`)
    if (milliseconds === undefined) return options.empty ?? NE_EMPTY_VALUE
    const locale = safeLocale(options.locale)
    return dateFormat(locale, {
      dateStyle: options.dateStyle ?? 'medium',
      timeZone: 'UTC',
    }).format(new Date(milliseconds))
  }
  return formatZoned(value, options, { dateStyle: options.dateStyle ?? 'medium' })
}

/** A clock time in the given zone. `short` style by default. */
export function formatZonedTime(value: NeDateInput, options: NeZonedOptions = {}): string {
  return formatZoned(value, options, { timeStyle: options.timeStyle ?? 'short' })
}

/** A date and a time in the given zone. `medium` date, `short` time by default. */
export function formatZonedDateTime(value: NeDateInput, options: NeZonedOptions = {}): string {
  return formatZoned(value, options, {
    dateStyle: options.dateStyle ?? 'medium',
    timeStyle: options.timeStyle ?? 'short',
  })
}

/* -------------------------------------------------------------------------- */
/* Bound formatters                                                           */
/* -------------------------------------------------------------------------- */

/** The formatter suite with a preference set already applied. */
export interface NeBoundFormatters {
  /** {@link formatZonedDate}, bound. */
  date: (value: NeDateInput, options?: NeZonedOptions) => string
  /** {@link formatZonedDateTime}, bound. */
  dateTime: (value: NeDateInput, options?: NeZonedOptions) => string
  /** {@link formatDistance}, bound. */
  distance: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatHeight}, bound. */
  height: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatLength}, bound. */
  length: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatDecimal}, bound. */
  number: (value: number | null | undefined, options?: NeDecimalOptions) => string
  /** {@link formatPressure}, bound. */
  pressure: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatSpeed}, bound. */
  speed: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatTemperature}, bound. */
  temperature: (value: number | null | undefined, options?: NeMeasurementOptions) => string
  /** {@link formatZonedTime}, bound. */
  time: (value: NeDateInput, options?: NeZonedOptions) => string
}

/**
 * Bind the suite to a preference set.
 *
 * Pass a getter rather than a value when the preferences can change — the
 * getter is read on every call, so a returned formatter stays correct after the
 * reader switches units. That is what `useFormatters()` does, which is why it
 * can hand a component a plain object instead of a `ComputedRef`.
 *
 * ```ts
 * const format = createFormatters({ locale: 'en-US', timeZone: 'America/Chicago', units: 'imperial' })
 * format.height(1.4)          // '4.6 ft'
 * format.time('2026-03-08T08:30:00Z') // '2:30 AM'
 * ```
 *
 * Per-call options still win, so one value can opt out of the reader's units
 * without touching the rest of the page.
 */
export function createFormatters(source: NePreferences | (() => NePreferences)): NeBoundFormatters {
  const read = typeof source === 'function' ? source : () => source

  const measurement = (options?: NeMeasurementOptions): NeMeasurementOptions => {
    const { locale, units } = read()
    return { locale, units, ...options }
  }
  const zoned = (options?: NeZonedOptions): NeZonedOptions => {
    const { locale, timeZone } = read()
    return { locale, timeZone, ...options }
  }

  return {
    date: (value, options) => formatZonedDate(value, zoned(options)),
    dateTime: (value, options) => formatZonedDateTime(value, zoned(options)),
    distance: (value, options) => formatDistance(value, measurement(options)),
    height: (value, options) => formatHeight(value, measurement(options)),
    length: (value, options) => formatLength(value, measurement(options)),
    number: (value, options) => formatDecimal(value, { locale: read().locale, ...options }),
    pressure: (value, options) => formatPressure(value, measurement(options)),
    speed: (value, options) => formatSpeed(value, measurement(options)),
    temperature: (value, options) => formatTemperature(value, measurement(options)),
    time: (value, options) => formatZonedTime(value, zoned(options)),
  }
}
