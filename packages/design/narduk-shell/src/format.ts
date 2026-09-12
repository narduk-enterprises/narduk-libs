/**
 * `@narduk-enterprises/narduk-shell/format` — the estate's shared, SSR-stable
 * formatters. Components backlog item 5 (narduk-libs#252).
 *
 * ## Why this module exists
 *
 * Fourteen apps hand-rolled these in 21 files across 228 call sites, and the
 * three pilots between them shipped the same bug four times: a formatter that
 * reads the **ambient clock** or the **host time zone** renders one string on
 * the server and a different one in the browser, so Vue's hydration check
 * fails and the value flickers or the page de-opts to a client render
 * (operator-portal#262 and #268, stonx#674 and #675). riverstatus went
 * further and hand-rolled the United States' daylight-saving transition table
 * (`apps/web/app/utils/riverstatus.ts`), which is wrong for every zone outside
 * that country and wrong inside it the next time Congress moves a date.
 *
 * This module removes that class by construction:
 *
 * - **No `Date.now()`.** `formatRelative` takes `now` from the caller. There
 *   is no ambient-clock read anywhere in this file, and `test/format.ssr.test.ts`
 *   greps for one.
 * - **No host-time-zone default.** `timeZone` is required by the *types* on
 *   every date and time formatter, never defaulted to
 *   `Intl.DateTimeFormat().resolvedOptions().timeZone`. An app supplies it
 *   once through {@link createFormatters}. `test/format.ssr.test.ts` runs this
 *   whole surface in a child process under `TZ=UTC`, `TZ=America/Chicago` and
 *   `TZ=Asia/Tokyo` and requires byte-identical output.
 * - **Locale is explicit too**, defaulting to a fixed `en-US` rather than to
 *   the host's resolved locale, for exactly the same reason.
 *
 * ## Framework-free, and why this file is not split up
 *
 * Nothing here imports Vue, Nuxt or a `.vue` file: the module has to be
 * importable from a plain Node script and from `nuxt.config.ts`.
 *
 * It is also **one file with no relative imports**, which is a constraint
 * rather than a style choice. `scripts/check-component-surface.mjs` reads the
 * `./format` surface by `import()`ing this file in plain Node, relying on
 * native type stripping, and Node's ESM resolver does no extension guessing:
 * an extensionless `./runtime/format/date` fails with `ERR_MODULE_NOT_FOUND`
 * and the surface check fails closed on it. Writing the specifier as
 * `./runtime/format/date.ts` fixes Node and breaks every *consuming app*
 * instead — this file is what `exports["./format"].types` points at, so an
 * app's own `tsc` reads it and rejects the explicit extension with TS5097
 * unless that app turns on `allowImportingTsExtensions`. Both failures were
 * reproduced against Node 22.22.3 and TypeScript 5.7.3 on 2026-09-11. A
 * self-contained entry is the only shape that satisfies Node, a consuming
 * app's typechecker, Vite and jiti at once.
 *
 * ## Cost
 *
 * Constructing an `Intl.*Format` is the expensive part, and these are called
 * once per cell in a table. Every constructor goes through the memoised
 * {@link cached} helper, keyed by the locale plus the full option set.
 */

/* -------------------------------------------------------------------------- */
/* Shared vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What every date formatter accepts: an instant (a `Date` or epoch
 * milliseconds), something `Date.parse` understands, or nothing at all.
 *
 * `null` and `undefined` are first-class inputs rather than the caller's
 * problem: the estate's data is full of `observedAt: string | null`, and a
 * formatter that throws on the null is a formatter every call site has to
 * guard.
 */
export type NeDateInput = Date | number | string | null | undefined

/** `Intl.DateTimeFormat`'s own `dateStyle`/`timeStyle` vocabulary. */
export type NeDateStyle = 'full' | 'long' | 'medium' | 'short'

/**
 * The options every formatter in the suite shares, so one bound option bag can
 * be spread into all of them. See {@link createFormatters}.
 */
export interface NeFormatterDefaults {
  /**
   * IANA zone name, e.g. `America/Chicago`. **Required** on every date and
   * time formatter, deliberately — see this module's header.
   */
  timeZone: string
  /** BCP-47 tag. Defaults to `en-US`: a fixed value, never the host locale. */
  locale?: string
  /** Rendered for `null`, `undefined` and unparseable input. Defaults to `—`. */
  empty?: string
}

/** {@link formatDate}'s options. */
export interface NeDateOptions extends NeFormatterDefaults {
  /** `Intl`'s `dateStyle`. Defaults to `medium` (`Mar 8, 2026`). */
  style?: NeDateStyle
}

/** {@link formatDateTime}'s options. */
export interface NeDateTimeOptions extends NeDateOptions {
  /** `Intl`'s `timeStyle`. Defaults to `short` (`3:30 AM`). */
  timeStyle?: NeDateStyle
  /**
   * Append the zone's own name, e.g. `CST`/`CDT`. This is what riverstatus's
   * hand-rolled DST table was for; `Intl` knows the real transition dates for
   * every zone, including the ones that are not the United States'.
   */
  timeZoneName?: 'short' | 'long' | 'shortOffset' | 'longOffset'
}

/** {@link formatRelative}'s options. */
export interface NeRelativeOptions extends NeFormatterDefaults {
  /**
   * The instant to measure against. **Required**: this is the injected clock
   * that makes the function SSR-stable, and defaulting it to `Date.now()` is
   * precisely the bug this module exists to remove.
   */
  now: NeDateInput
  /**
   * `Intl.RelativeTimeFormat`'s `numeric`. `auto` (the default) says
   * "yesterday"; `always` says "1 day ago".
   */
  numeric?: 'always' | 'auto'
}

/** The units {@link formatDuration} renders. Nothing above a day — see its docs. */
export type NeDurationUnit = 'day' | 'hour' | 'minute' | 'second'

/** {@link formatDuration}'s options. */
export interface NeDurationOptions extends Omit<NeFormatterDefaults, 'timeZone'> {
  /** A duration has no time zone; accepted and ignored so one bag fits all. */
  timeZone?: string
  /** How many units to show, largest first. Defaults to 2 (`1h 30m`). */
  parts?: number
  /** The smallest unit worth showing. Defaults to `second`. */
  smallestUnit?: NeDurationUnit
  /** `Intl`'s `unitDisplay`. Defaults to `narrow` (`1h 30m`, not `1 hr 30 min`). */
  unitDisplay?: 'narrow' | 'short' | 'long'
}

/** {@link formatNumber}'s options. */
export interface NeNumberOptions extends Omit<NeFormatterDefaults, 'timeZone'> {
  /** A number has no time zone; accepted and ignored so one bag fits all. */
  timeZone?: string
  /** Exact fraction digits — sets both the minimum and the maximum. */
  digits?: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  /** `auto` (the default), `always` for `+1,234`, `never`, or `exceptZero`. */
  signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero'
}

/** {@link formatCompact}'s options. */
export interface NeCompactOptions extends NeNumberOptions {
  /** `short` (the default) gives `1.2M`; `long` gives `1.2 million`. */
  compactDisplay?: 'short' | 'long'
}

/** {@link formatPercent}'s options. */
export interface NePercentOptions extends NeNumberOptions {
  /**
   * What the caller's number means. `fraction` (the default) reads `0.055` as
   * 5.5%, which is `Intl`'s own convention; `percent` reads `5.5` as 5.5%.
   *
   * Both readings are spelled out at the call site on purpose. stonx's
   * `formatPercent` carries the same distinction as a `fromDecimal` flag whose
   * default is the *opposite* one, so an adoption that silently inherited a
   * default would be wrong by a factor of 100 in a direction nothing catches.
   */
  input?: 'fraction' | 'percent'
}

/** {@link formatMoney}'s options. */
export interface NeMoneyOptions extends NeNumberOptions {
  /** ISO-4217 code, e.g. `USD`. Required: there is no house currency. */
  currency: string
  /** `symbol` (the default) gives `$1,234.50`; `code` gives `USD 1,234.50`. */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name'
}

/** {@link formatQuantity}'s options. */
export interface NeQuantityOptions extends NeNumberOptions {
  /**
   * A sanctioned `Intl` unit (`foot`, `celsius`, `liter-per-kilometer`, …) or
   * any other string. An unsanctioned unit — riverstatus's `cfs`, say — is
   * appended after a space instead of throwing a `RangeError`.
   */
  unit: string
  /** `short` (the default) gives `5 ft`; `narrow` gives `5′`; `long` gives `5 feet`. */
  unitDisplay?: 'narrow' | 'short' | 'long'
}

/**
 * One app's bound formatters: every signature below with `timeZone`, `locale`
 * and the empty placeholder already supplied. See {@link createFormatters}.
 */
export interface NeFormatters {
  formatDate: (value: NeDateInput, options?: Partial<NeDateOptions>) => string
  formatDateTime: (value: NeDateInput, options?: Partial<NeDateTimeOptions>) => string
  formatRelative: (
    value: NeDateInput,
    options: Partial<NeRelativeOptions> & Pick<NeRelativeOptions, 'now'>,
  ) => string
  formatDuration: (milliseconds: number | null | undefined, options?: NeDurationOptions) => string
  formatNumber: (value: number | null | undefined, options?: NeNumberOptions) => string
  formatCompact: (value: number | null | undefined, options?: NeCompactOptions) => string
  formatPercent: (value: number | null | undefined, options?: NePercentOptions) => string
  formatMoney: (
    value: number | null | undefined,
    options: Partial<NeMoneyOptions> & Pick<NeMoneyOptions, 'currency'>,
  ) => string
  formatQuantity: (
    value: number | null | undefined,
    options: Partial<NeQuantityOptions> & Pick<NeQuantityOptions, 'unit'>,
  ) => string
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_LOCALE = 'en-US'
const DEFAULT_EMPTY = '—'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * A bare `YYYY-MM-DD`. `new Date('2026-03-08')` is midnight **UTC**, so
 * rendering it in `America/Chicago` shows the 7th — the most common way a date
 * lands on screen one day early. {@link formatDate} treats a value of this
 * shape as a calendar date with no instant, which is what it is.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Memoised `Intl` constructors.
 *
 * A formatter runs once per cell, so constructing `Intl.DateTimeFormat` per
 * call is the measured cost in the pilots. The key is the locale plus the full
 * option set with its keys sorted, so two callers spelling the same options in
 * a different order share one instance.
 *
 * The cap exists because an option set can in principle be derived from data
 * (`digits` off a column definition, `currency` off a row), which is the one
 * way this could grow with the working set rather than with the code. Clearing
 * wholesale rather than evicting one entry keeps that to a branch and a
 * `Map.clear()`: real call sites re-populate a handful of entries immediately,
 * and an adversarial one pays a rebuild instead of growing without bound.
 */
const MAX_CACHE_ENTRIES = 256
const caches = new Map<string, Map<string, unknown>>()

function cached<T>(kind: string, locale: string, options: object, build: () => T): T {
  let cache = caches.get(kind)
  if (!cache) {
    cache = new Map<string, unknown>()
    caches.set(kind, cache)
  }
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([first], [second]) => (first < second ? -1 : 1))
  const key = `${locale}\u0000${JSON.stringify(entries)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
  const built = build()
  cache.set(key, built)
  return built
}

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('dateTime', locale, options, () => new Intl.DateTimeFormat(locale, options))
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('number', locale, options, () => new Intl.NumberFormat(locale, options))
}

function relativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cached('relative', locale, options, () => new Intl.RelativeTimeFormat(locale, options))
}

/** Epoch milliseconds, or `undefined` for anything that is not an instant. */
function instantOf(value: NeDateInput): number | undefined {
  if (value === null || value === undefined) return
  const milliseconds =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

/**
 * A calendar date as seen from `timeZone`, read out of `Intl`'s own parts — so
 * the zone's real UTC offset (daylight saving included) comes from the ICU
 * data rather than from arithmetic this file would have to keep current.
 */
function zonedParts(
  instant: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = dateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(new Date(instant))
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  const year = read('year')
  const bce = parts.find((part) => part.type === 'era')?.value === 'BC'
  return { year: bce ? 1 - year : year, month: read('month'), day: read('day') }
}

/** Whole days since the epoch, in `timeZone`. A daylight-saving day is one day. */
function zonedDayNumber(instant: number, timeZone: string): number {
  const { year, month, day } = zonedParts(instant, timeZone)
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
}

/** Completed calendar months between two instants, as seen from `timeZone`. */
function zonedMonthsBetween(from: number, to: number, timeZone: string): number {
  const start = zonedParts(from, timeZone)
  const end = zonedParts(to, timeZone)
  let months = (end.year - start.year) * 12 + (end.month - start.month)
  if (months > 0 && end.day < start.day) months -= 1
  if (months < 0 && end.day > start.day) months += 1
  return months
}

/** Fraction-digit options, from the `digits` shorthand or the explicit pair. */
function fractionDigits(
  options: Pick<NeNumberOptions, 'digits' | 'minimumFractionDigits' | 'maximumFractionDigits'>,
): Pick<Intl.NumberFormatOptions, 'minimumFractionDigits' | 'maximumFractionDigits'> {
  if (options.digits !== undefined) {
    return { minimumFractionDigits: options.digits, maximumFractionDigits: options.digits }
  }
  return {
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  }
}

/**
 * Whether `Intl` recognises `unit` as one of its sanctioned unit identifiers.
 * Feature-tested once per string, because constructing-and-catching per call
 * is the opposite of the point of the cache above.
 */
const unitSupport = new Map<string, boolean>()
function isIntlUnit(unit: string): boolean {
  const known = unitSupport.get(unit)
  if (known !== undefined) return known
  let supported: boolean
  try {
    // Constructing IS the feature test: Intl throws RangeError for any unit
    // outside its sanctioned list.
    supported = Boolean(new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'unit', unit }))
  } catch {
    supported = false
  }
  unitSupport.set(unit, supported)
  return supported
}

/* -------------------------------------------------------------------------- */
/* Dates and times                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A calendar date in an explicit zone.
 *
 * ```ts
 * formatDate('2026-03-08T08:30:00Z', { timeZone: 'America/Chicago' }) // 'Mar 8, 2026'
 * formatDate('2026-03-08T08:30:00Z', { timeZone: 'Asia/Tokyo' })      // 'Mar 8, 2026'
 * formatDate(null, { timeZone: 'UTC' })                               // '—'
 * ```
 *
 * A bare `YYYY-MM-DD` string is treated as a **calendar date, not an instant**
 * and renders as itself in every zone. `new Date('2026-03-08')` is midnight
 * UTC, so the ordinary reading shows `Mar 7` for every zone west of Greenwich.
 * {@link formatDateTime} deliberately does *not* do this: asking for the time
 * of a value that has none is a different question, and it keeps JavaScript's
 * own answer.
 */
export function formatDate(value: NeDateInput, options: NeDateOptions): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const empty = options.empty ?? DEFAULT_EMPTY
  const floating = typeof value === 'string' && CALENDAR_DATE.test(value)
  const instant = instantOf(floating ? `${value}T12:00:00Z` : value)
  if (instant === undefined) return empty
  return dateTimeFormat(locale, {
    timeZone: floating ? 'UTC' : options.timeZone,
    dateStyle: options.style ?? 'medium',
  }).format(new Date(instant))
}

/**
 * A date and a time in an explicit zone.
 *
 * ```ts
 * const at = '2026-03-08T08:30:00Z'
 * formatDateTime(at, { timeZone: 'America/Chicago' })
 * // 'Mar 8, 2026, 3:30 AM'  — CDT: the clock jumped an hour half an hour ago
 * formatDateTime(at, { timeZone: 'America/Chicago', timeZoneName: 'short' })
 * // 'Mar 8, 2026, 3:30 AM CDT'
 * ```
 *
 * The zone name comes from a second formatter and is appended, because
 * `Intl.DateTimeFormat` throws a `TypeError` when `timeZoneName` is combined
 * with `dateStyle`/`timeStyle`. Doing it this way keeps the date and the time
 * themselves in `Intl`'s locale-correct hands rather than reassembling them
 * out of component options.
 */
export function formatDateTime(value: NeDateInput, options: NeDateTimeOptions): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const empty = options.empty ?? DEFAULT_EMPTY
  const instant = instantOf(value)
  if (instant === undefined) return empty
  const at = new Date(instant)
  const stamp = dateTimeFormat(locale, {
    timeZone: options.timeZone,
    dateStyle: options.style ?? 'medium',
    timeStyle: options.timeStyle ?? 'short',
  }).format(at)
  if (!options.timeZoneName) return stamp
  const zone = dateTimeFormat(locale, {
    timeZone: options.timeZone,
    timeZoneName: options.timeZoneName,
  })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
  return zone ? `${stamp} ${zone}` : stamp
}

/**
 * How long ago, or how far ahead — measured against a `now` the caller
 * supplies.
 *
 * ```ts
 * const now = '2026-03-08T12:00:00Z'
 * formatRelative('2026-03-08T09:00:00Z', { now, timeZone: 'America/Chicago' }) // '3 hours ago'
 * formatRelative('2026-03-07T09:00:00Z', { now, timeZone: 'America/Chicago' }) // 'yesterday'
 * ```
 *
 * `now` is a required option with no default. That is the whole point: a
 * relative formatter that reads the ambient clock renders one string on the
 * server and another in the browser and fails hydration every time.
 *
 * Under 22 hours the answer is elapsed seconds, minutes or hours — "2 hours
 * ago" is more useful than "yesterday" for something that happened at 23:30
 * last night. From 22 hours the comparison becomes a **calendar** one made in
 * `timeZone`: "yesterday" means the previous local day, so the same 30-hour-old
 * value reads `2 days ago` in `America/Chicago` and `yesterday` in
 * `Asia/Tokyo`, and a 23-hour daylight-saving day is still one day.
 */
export function formatRelative(value: NeDateInput, options: NeRelativeOptions): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const empty = options.empty ?? DEFAULT_EMPTY
  const instant = instantOf(value)
  const now = instantOf(options.now)
  if (instant === undefined || now === undefined) return empty

  const format = relativeTimeFormat(locale, { numeric: options.numeric ?? 'auto' })
  const difference = instant - now
  const distance = Math.abs(difference)
  if (distance < 45 * SECOND_MS) return format.format(Math.round(difference / SECOND_MS), 'second')
  if (distance < 45 * MINUTE_MS) return format.format(Math.round(difference / MINUTE_MS), 'minute')

  const days = zonedDayNumber(instant, options.timeZone) - zonedDayNumber(now, options.timeZone)
  // Below 22 hours, elapsed time beats the calendar: something that happened
  // at 23:30 last night is "2 hours ago", not "yesterday". And two instants
  // that land on the same local day stay in hours however many of them there
  // are, because "today" is a strange way to describe a 23-hour gap.
  if (days === 0 || distance < 22 * HOUR_MS) {
    return format.format(Math.round(difference / HOUR_MS), 'hour')
  }
  if (Math.abs(days) < 7) return format.format(days, 'day')
  if (Math.abs(days) < 30) return format.format(Math.trunc(days / 7), 'week')

  const months = zonedMonthsBetween(now, instant, options.timeZone)
  if (Math.abs(months) < 12) return format.format(months, 'month')
  return format.format(Math.trunc(months / 12), 'year')
}

/* -------------------------------------------------------------------------- */
/* Durations                                                                  */
/* -------------------------------------------------------------------------- */

const DURATION_UNITS: ReadonlyArray<{ unit: NeDurationUnit; size: number }> = [
  { unit: 'day', size: DAY_MS },
  { unit: 'hour', size: HOUR_MS },
  { unit: 'minute', size: MINUTE_MS },
  { unit: 'second', size: SECOND_MS },
]

/**
 * An elapsed span, in milliseconds, as `1h 30m`.
 *
 * ```ts
 * formatDuration(5_400_000)                          // '1h 30m'
 * formatDuration(3_600_000)                          // '1h'
 * formatDuration(90_000)                             // '1m 30s'
 * formatDuration(0)                                  // '0s'
 * formatDuration(-90_000)                            // '-1m 30s'
 * formatDuration(5_400_000, { parts: 1 })            // '1h'
 * formatDuration(5_400_000, { unitDisplay: 'long' }) // '1 hour 30 minutes'
 * ```
 *
 * **Nothing above a day.** A month is not a fixed number of milliseconds and a
 * year is not a fixed number of days, so rendering a duration in either is a
 * quiet lie — `45d` is the truthful answer, and {@link formatRelative}, which
 * has two instants and a zone, is where "last month" legitimately comes from.
 *
 * A negative span keeps its sign rather than collapsing to `unknown` the way
 * operator-portal's `formatAge` does: a clock skew of −4s is information, and
 * discarding it hides the skew.
 *
 * `parts` counts units from the largest non-zero one downwards, and a trailing
 * zero is trimmed — so an exact hour is `1h`, not `1h 0m`.
 */
export function formatDuration(
  milliseconds: number | null | undefined,
  options: NeDurationOptions = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return empty

  const unitDisplay = options.unitDisplay ?? 'narrow'
  const smallest = options.smallestUnit ?? 'second'
  const parts = Math.max(1, options.parts ?? 2)
  const render = (unit: NeDurationUnit, count: number) =>
    numberFormat(locale, { style: 'unit', unit, unitDisplay, maximumFractionDigits: 0 }).format(
      count,
    )

  let remainder = Math.abs(milliseconds)
  const counted: Array<{ unit: NeDurationUnit; count: number }> = []
  for (const { unit, size } of DURATION_UNITS) {
    const count = Math.floor(remainder / size)
    remainder -= count * size
    if (count > 0 || counted.length > 0) counted.push({ unit, count })
    if (counted.length >= parts || unit === smallest) break
  }
  while (counted.length > 1 && counted.at(-1)?.count === 0) counted.pop()
  if (counted.length === 0) return render(smallest, 0)

  const sign = milliseconds < 0 ? '-' : ''
  return `${sign}${counted.map(({ unit, count }) => render(unit, count)).join(' ')}`
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A plain number, grouped for the locale.
 *
 * ```ts
 * formatNumber(1234.5678)                       // '1,234.568'
 * formatNumber(1234.5678, { digits: 2 })        // '1,234.57'
 * formatNumber(1234, { signDisplay: 'always' }) // '+1,234'
 * formatNumber(undefined)                       // '—'
 * ```
 */
export function formatNumber(
  value: number | null | undefined,
  options: NeNumberOptions = {},
): string {
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof value !== 'number' || !Number.isFinite(value)) return empty
  return numberFormat(options.locale ?? DEFAULT_LOCALE, {
    ...fractionDigits(options),
    signDisplay: options.signDisplay,
  }).format(value)
}

/**
 * A large number, abbreviated.
 *
 * ```ts
 * formatCompact(1234)                                  // '1.2K'
 * formatCompact(1_234_567)                             // '1.2M'
 * formatCompact(1_234_567, { compactDisplay: 'long' }) // '1.2 million'
 * ```
 *
 * `Intl`'s own compact notation, not stonx's hand-rolled `K`/`M`/`B`/`T`
 * ladder: the ladder is English-only, and the plan's signature wins where the
 * two disagree. One visible consequence — the default is one fraction digit
 * (`1.2K`) where stonx's was two (`1.23K`); pass `{ digits: 2 }` at a call
 * site that needs the old shape.
 */
export function formatCompact(
  value: number | null | undefined,
  options: NeCompactOptions = {},
): string {
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof value !== 'number' || !Number.isFinite(value)) return empty
  const digits = fractionDigits(options)
  return numberFormat(options.locale ?? DEFAULT_LOCALE, {
    notation: 'compact',
    compactDisplay: options.compactDisplay ?? 'short',
    minimumFractionDigits: digits.minimumFractionDigits,
    maximumFractionDigits: digits.maximumFractionDigits ?? 1,
    signDisplay: options.signDisplay,
  }).format(value)
}

/**
 * A percentage.
 *
 * ```ts
 * formatPercent(0.055)                                       // '5.5%'
 * formatPercent(5.5, { input: 'percent' })                   // '5.5%'
 * formatPercent(0.055, { digits: 2, signDisplay: 'always' }) // '+5.50%'
 * ```
 *
 * The default reading is `Intl`'s: the argument is a **fraction**, so `0.055`
 * is 5.5%. stonx's formatter defaults the other way, which is why `input` is
 * spelled out at the call site rather than inferred.
 */
export function formatPercent(
  value: number | null | undefined,
  options: NePercentOptions = {},
): string {
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof value !== 'number' || !Number.isFinite(value)) return empty
  const digits = options.digits ?? 1
  return numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signDisplay,
  }).format(options.input === 'percent' ? value / 100 : value)
}

/**
 * An amount of money.
 *
 * ```ts
 * formatMoney(1234.5, { currency: 'USD' })                          // '$1,234.50'
 * formatMoney(1234.5, { currency: 'USD', currencyDisplay: 'code' }) // 'USD 1,234.50'
 * formatMoney(1234.5, { currency: 'EUR', locale: 'de-DE' })         // '1.234,50 €'
 * ```
 *
 * `currency` is required because there is no house currency, and the fraction
 * digits are the currency's own by default — `JPY` has none, `USD` has two.
 * `timeZone` is accepted and ignored, so that one bound option bag fits every
 * formatter in the suite (the plan's signature list says so explicitly); money
 * has no time zone.
 */
export function formatMoney(value: number | null | undefined, options: NeMoneyOptions): string {
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof value !== 'number' || !Number.isFinite(value)) return empty
  return numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: options.currency,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
    ...fractionDigits(options),
    signDisplay: options.signDisplay,
  }).format(value)
}

/**
 * A measured quantity with its unit.
 *
 * ```ts
 * formatQuantity(5, { unit: 'foot' })                      // '5 ft'
 * formatQuantity(5, { unit: 'foot', unitDisplay: 'long' }) // '5 feet'
 * formatQuantity(1234, { unit: 'cfs' })                    // '1,234 cfs'
 * ```
 *
 * `Intl` throws a `RangeError` for any unit outside its sanctioned list, and
 * half the estate's units are outside it — riverstatus alone reads `cfs` and
 * `ft3/s` off the USGS feed. An unsanctioned unit is therefore appended after
 * a space rather than thrown.
 */
export function formatQuantity(
  value: number | null | undefined,
  options: NeQuantityOptions,
): string {
  const empty = options.empty ?? DEFAULT_EMPTY
  if (typeof value !== 'number' || !Number.isFinite(value)) return empty
  if (!isIntlUnit(options.unit)) return `${formatNumber(value, options)} ${options.unit}`
  return numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'unit',
    unit: options.unit,
    unitDisplay: options.unitDisplay ?? 'short',
    ...fractionDigits(options),
    signDisplay: options.signDisplay,
  }).format(value)
}

/* -------------------------------------------------------------------------- */
/* One bound set per app                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bind `timeZone`, `locale` and the empty placeholder once, for a whole app.
 *
 * ```ts
 * // app/utils/formatters.ts
 * export const fmt = createFormatters({ timeZone: 'America/Chicago' })
 *
 * fmt.formatDateTime(row.observedAt)          // 'Mar 8, 2026, 3:30 AM'
 * fmt.formatRelative(row.observedAt, { now }) // '3 hours ago'
 * fmt.formatMoney(row.total, { currency: 'USD' })
 * ```
 *
 * This is the intended entry point, and `timeZone` being required here is how
 * an app answers the question once instead of at 228 call sites. The zone an
 * app passes should be a **decision** — the market's zone, the gauge's zone,
 * `'UTC'` — never `Intl.DateTimeFormat().resolvedOptions().timeZone`, which is
 * the host's and differs between the server and the browser.
 *
 * Per-call options still win, so one row can render in another zone without a
 * second bound set.
 */
/**
 * `options` with every explicitly-`undefined` value dropped.
 *
 * {@link createFormatters}'s bound signatures take `Partial<…>`, so
 * `{ timeZone: undefined }` type-checks — and a caller gets exactly that for
 * free from any optional field (`formatDateTime(at, { timeZone: row.zone })`
 * where `zone` is `string | undefined`). A plain spread keeps that own
 * property, and `Intl.DateTimeFormat` treats an own `undefined` `timeZone`
 * exactly like an absent one: the **host's** zone. That would render
 * `Mar 8, 2026, 8:30 AM` in a UTC Worker and `5:30 PM` in a Tokyo browser for
 * the same call — the hydration mismatch this module's header says it prevents
 * by construction. Dropping the key restores the bound default instead.
 * Nothing is lost: no field of {@link NeFormatterDefaults} has an "unset"
 * meaning a caller could want. (narduk-libs#283 review.)
 */
function definedValues<T extends object>(options: T | undefined): Partial<T> {
  if (options === undefined) return {}
  const defined: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) defined[key] = value
  }
  return defined as Partial<T>
}

export function createFormatters(defaults: NeFormatterDefaults): NeFormatters {
  // The assertion is the spread's own shape, which TypeScript cannot see
  // through an unresolved `T`: the result carries every key of `options` and
  // every key of `defaults`, and per-call options win because they are spread
  // second. Each call below then supplies the rest of its own required
  // options (`now`, `currency`, `unit`) as `T`.
  const bind = <T extends object>(options: T | undefined): T & NeFormatterDefaults =>
    ({ ...defaults, ...definedValues(options) }) as T & NeFormatterDefaults
  return Object.freeze({
    formatDate: (value, options) => formatDate(value, bind(options)),
    formatDateTime: (value, options) => formatDateTime(value, bind(options)),
    formatRelative: (value, options) => formatRelative(value, bind(options)),
    formatDuration: (milliseconds, options) => formatDuration(milliseconds, bind(options)),
    formatNumber: (value, options) => formatNumber(value, bind(options)),
    formatCompact: (value, options) => formatCompact(value, bind(options)),
    formatPercent: (value, options) => formatPercent(value, bind(options)),
    formatMoney: (value, options) => formatMoney(value, bind(options)),
    formatQuantity: (value, options) => formatQuantity(value, bind(options)),
  } satisfies NeFormatters)
}
