/*
 * Unit tests for `@narduk-enterprises/narduk-shell/format` — components
 * backlog item 5 (narduk-libs#252).
 *
 * Every assertion pins `locale` explicitly. A test that leans on the runner's
 * default locale asserts whatever ICU data the machine happens to carry, which
 * is the flake that makes a formatter suite untrustworthy the first time it
 * runs somewhere else. The module's own default is a fixed `en-US` rather than
 * the host locale, and `defaults` below is the one test that asserts that.
 *
 * The host time zone is *not* pinned here, on purpose: these tests must pass
 * under any `TZ`. `test/format.ssr.test.ts` is the file that proves it, by
 * running the same surface in child processes under three different zones.
 */
import { describe, expect, it } from 'vitest'

import {
  createFormatters,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatRelative,
} from '../src/format'

const CHICAGO = 'America/Chicago'
const TOKYO = 'Asia/Tokyo'
const en = { locale: 'en-US' } as const

describe('formatDate', () => {
  it('renders a calendar date in the zone it is given, not the host zone', () => {
    const at = '2026-03-08T08:30:00Z'
    expect(formatDate(at, { ...en, timeZone: CHICAGO })).toBe('Mar 8, 2026')
    expect(formatDate(at, { ...en, timeZone: TOKYO })).toBe('Mar 8, 2026')
    // 15:30 in Chicago on the 8th is already the 9th in Tokyo.
    expect(formatDate('2026-03-08T21:30:00Z', { ...en, timeZone: TOKYO })).toBe('Mar 9, 2026')
  })

  it('honours dateStyle through `style`', () => {
    const at = '2026-03-08T08:30:00Z'
    expect(formatDate(at, { ...en, timeZone: CHICAGO, style: 'short' })).toBe('3/8/26')
    expect(formatDate(at, { ...en, timeZone: CHICAGO, style: 'full' })).toBe(
      'Sunday, March 8, 2026',
    )
  })

  it('treats a bare YYYY-MM-DD as a calendar date, so it never shifts a day west', () => {
    // `new Date('2026-03-08')` is midnight UTC; read in Chicago that is the
    // 7th. A date-only value has no instant, so it renders as itself.
    expect(formatDate('2026-03-08', { ...en, timeZone: CHICAGO })).toBe('Mar 8, 2026')
    expect(formatDate('2026-03-08', { ...en, timeZone: TOKYO })).toBe('Mar 8, 2026')
    expect(formatDate('2026-03-08', { ...en, timeZone: 'UTC' })).toBe('Mar 8, 2026')
  })

  it('renders the placeholder for null, undefined and unparseable input', () => {
    expect(formatDate(null, { ...en, timeZone: CHICAGO })).toBe('—')
    expect(formatDate(undefined, { ...en, timeZone: CHICAGO })).toBe('—')
    expect(formatDate('not a date', { ...en, timeZone: CHICAGO })).toBe('—')
    expect(formatDate(Number.NaN, { ...en, timeZone: CHICAGO })).toBe('—')
    expect(formatDate(undefined, { ...en, timeZone: CHICAGO, empty: 'unknown' })).toBe('unknown')
  })

  it('accepts a Date and epoch milliseconds as well as a string', () => {
    const milliseconds = Date.parse('2026-03-08T08:30:00Z')
    expect(formatDate(new Date(milliseconds), { ...en, timeZone: CHICAGO })).toBe('Mar 8, 2026')
    expect(formatDate(milliseconds, { ...en, timeZone: CHICAGO })).toBe('Mar 8, 2026')
  })
})

describe('formatDateTime', () => {
  it('renders the wall-clock time of the zone it is given', () => {
    const at = '2026-03-08T08:30:00Z'
    expect(formatDateTime(at, { ...en, timeZone: CHICAGO })).toBe('Mar 8, 2026, 3:30 AM')
    expect(formatDateTime(at, { ...en, timeZone: TOKYO })).toBe('Mar 8, 2026, 5:30 PM')
    expect(formatDateTime(at, { ...en, timeZone: 'UTC' })).toBe('Mar 8, 2026, 8:30 AM')
  })

  it('crosses the spring-forward boundary with the zone ICU knows, not a hand-rolled table', () => {
    // Chicago springs forward at 08:00Z on 2026-03-08: 01:59 CST is followed
    // by 03:00 CDT, and 02:xx local never happens. riverstatus hard-codes this
    // transition for one country; Intl knows it for every zone.
    const before = formatDateTime('2026-03-08T07:59:00Z', {
      ...en,
      timeZone: CHICAGO,
      timeZoneName: 'short',
    })
    const after = formatDateTime('2026-03-08T08:00:00Z', {
      ...en,
      timeZone: CHICAGO,
      timeZoneName: 'short',
    })
    expect(before).toBe('Mar 8, 2026, 1:59 AM CST')
    expect(after).toBe('Mar 8, 2026, 3:00 AM CDT')
  })

  it('distinguishes the two 1:30 AMs of the fall-back night by zone name', () => {
    // Chicago falls back at 07:00Z on 2026-11-01, so 1:30 AM happens twice.
    // The clock alone is ambiguous; the zone name is what disambiguates it.
    const first = formatDateTime('2026-11-01T06:30:00Z', {
      ...en,
      timeZone: CHICAGO,
      timeZoneName: 'short',
    })
    const second = formatDateTime('2026-11-01T07:30:00Z', {
      ...en,
      timeZone: CHICAGO,
      timeZoneName: 'short',
    })
    expect(first).toBe('Nov 1, 2026, 1:30 AM CDT')
    expect(second).toBe('Nov 1, 2026, 1:30 AM CST')
    expect(first).not.toBe(second)
  })

  it('honours style and timeStyle, and keeps a date-only string as an instant', () => {
    const at = '2026-03-08T08:30:00Z'
    expect(
      formatDateTime(at, { ...en, timeZone: 'UTC', style: 'short', timeStyle: 'medium' }),
    ).toBe('3/8/26, 8:30:00 AM')
    // Unlike formatDate, a bare date keeps JavaScript's own reading (midnight
    // UTC): asking for the time of a value that has none is a different
    // question, and inventing one would be worse than answering it literally.
    expect(formatDateTime('2026-03-08', { ...en, timeZone: 'UTC' })).toBe('Mar 8, 2026, 12:00 AM')
  })

  it('renders the placeholder for empty and unparseable input', () => {
    expect(formatDateTime(null, { ...en, timeZone: CHICAGO })).toBe('—')
    expect(formatDateTime('nope', { ...en, timeZone: CHICAGO, empty: 'Not set' })).toBe('Not set')
  })
})

describe('formatRelative', () => {
  const now = '2026-03-08T12:00:00Z'

  it('measures against the caller’s now, never the ambient clock', () => {
    expect(formatRelative('2026-03-08T11:59:30Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '30 seconds ago',
    )
    expect(formatRelative('2026-03-08T11:30:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '30 minutes ago',
    )
    expect(formatRelative('2026-03-08T09:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '3 hours ago',
    )
    expect(formatRelative('2026-03-08T15:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      'in 3 hours',
    )
  })

  it('compares calendar days in the zone, so a 23-hour DST day is still yesterday', () => {
    // Midnight Mar 8 in Chicago is 06:00Z (CST); midnight Mar 9 is 05:00Z
    // (CDT). Exactly 23 hours apart, and still one calendar day. Hour
    // arithmetic would say "23 hours ago".
    expect(
      formatRelative('2026-03-08T06:00:00Z', {
        ...en,
        now: '2026-03-09T05:00:00Z',
        timeZone: CHICAGO,
      }),
    ).toBe('yesterday')
  })

  it('answers the same question differently in two zones, which is the point of timeZone', () => {
    // One instant, one now, 30 hours apart. In Chicago that spans Mar 7 20:00
    // to Mar 9 02:00 — two calendar days. In Tokyo it spans Mar 8 11:00 to
    // Mar 9 17:00 — one. Elapsed-hours arithmetic cannot tell them apart.
    const at = '2026-03-08T02:00:00Z'
    const later = '2026-03-09T08:00:00Z'
    expect(formatRelative(at, { ...en, now: later, timeZone: CHICAGO })).toBe('2 days ago')
    expect(formatRelative(at, { ...en, now: later, timeZone: TOKYO })).toBe('yesterday')
  })

  it('prefers elapsed hours to the calendar below 22 hours, so late last night is hours ago', () => {
    // 02:00Z is 20:00 the previous day in Chicago. Ten hours is ten hours; a
    // pure calendar comparison would call it "yesterday", which is true and
    // much less useful on a freshness readout.
    expect(formatRelative('2026-03-08T02:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '10 hours ago',
    )
  })

  it('climbs to weeks, months and years on calendar boundaries', () => {
    expect(formatRelative('2026-02-26T12:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      'last week',
    )
    expect(formatRelative('2026-01-08T12:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '2 months ago',
    )
    expect(formatRelative('2026-05-08T12:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      'in 2 months',
    )
    expect(formatRelative('2024-03-08T12:00:00Z', { ...en, now, timeZone: CHICAGO })).toBe(
      '2 years ago',
    )
  })

  it('takes numeric: "always" for callers that never want "yesterday"', () => {
    expect(
      formatRelative('2026-03-07T09:00:00Z', {
        ...en,
        now,
        timeZone: CHICAGO,
        numeric: 'always',
      }),
    ).toBe('1 day ago')
  })

  it('renders the placeholder when either instant is missing', () => {
    expect(formatRelative(null, { ...en, now, timeZone: CHICAGO })).toBe('—')
    expect(formatRelative(now, { ...en, now: null, timeZone: CHICAGO })).toBe('—')
  })
})

describe('formatDuration', () => {
  it('renders the two largest non-zero units, trimming a trailing zero', () => {
    expect(formatDuration(5_400_000, en)).toBe('1h 30m')
    expect(formatDuration(3_600_000, en)).toBe('1h')
    expect(formatDuration(93_600_000, en)).toBe('1d 2h')
    expect(formatDuration(90_000, en)).toBe('1m 30s')
    expect(formatDuration(45_000, en)).toBe('45s')
  })

  it('renders zero as zero, not as a placeholder', () => {
    expect(formatDuration(0, en)).toBe('0s')
    expect(formatDuration(0, { ...en, smallestUnit: 'minute' })).toBe('0m')
    // Under a second is zero seconds, which is true, rather than "0.4s".
    expect(formatDuration(400, en)).toBe('0s')
  })

  it('keeps the sign of a negative span instead of calling it unknown', () => {
    // operator-portal's formatAge returns 'unknown' below zero, which hides a
    // clock skew rather than reporting it.
    expect(formatDuration(-90_000, en)).toBe('-1m 30s')
    expect(formatDuration(-4000, en)).toBe('-4s')
  })

  it('takes parts, smallestUnit and unitDisplay', () => {
    expect(formatDuration(5_400_000, { ...en, parts: 1 })).toBe('1h')
    expect(formatDuration(5_430_000, { ...en, parts: 3 })).toBe('1h 30m 30s')
    expect(formatDuration(90_000, { ...en, smallestUnit: 'minute' })).toBe('1m')
    expect(formatDuration(5_400_000, { ...en, unitDisplay: 'long' })).toBe('1 hour 30 minutes')
    expect(formatDuration(5_400_000, { ...en, unitDisplay: 'short' })).toBe('1 hr 30 min')
  })

  it('never climbs above a day, because a month is not a fixed span', () => {
    expect(formatDuration(45 * 86_400_000, en)).toBe('45d')
  })

  it('renders the placeholder for empty and non-finite input', () => {
    expect(formatDuration(null, en)).toBe('—')
    expect(formatDuration(undefined, en)).toBe('—')
    expect(formatDuration(Number.NaN, en)).toBe('—')
    expect(formatDuration(Number.POSITIVE_INFINITY, { ...en, empty: 'unknown' })).toBe('unknown')
  })
})

describe('formatNumber', () => {
  it('groups for the locale it is given', () => {
    expect(formatNumber(1234.5678, en)).toBe('1,234.568')
    expect(formatNumber(1234.5678, { locale: 'de-DE' })).toBe('1.234,568')
  })

  it('takes digits, the explicit minimum/maximum pair, and signDisplay', () => {
    expect(formatNumber(1234.5678, { ...en, digits: 2 })).toBe('1,234.57')
    expect(formatNumber(1234, { ...en, digits: 2 })).toBe('1,234.00')
    expect(
      formatNumber(1234.5, { ...en, minimumFractionDigits: 0, maximumFractionDigits: 4 }),
    ).toBe('1,234.5')
    expect(formatNumber(1234, { ...en, signDisplay: 'always' })).toBe('+1,234')
  })

  it('renders zero and the placeholder distinctly', () => {
    expect(formatNumber(0, en)).toBe('0')
    expect(formatNumber(null, en)).toBe('—')
    expect(formatNumber(undefined, { ...en, empty: '--' })).toBe('--')
    expect(formatNumber(Number.NaN, en)).toBe('—')
  })
})

describe('formatCompact', () => {
  it('abbreviates through Intl rather than a hand-rolled K/M/B ladder', () => {
    expect(formatCompact(999, en)).toBe('999')
    expect(formatCompact(1234, en)).toBe('1.2K')
    expect(formatCompact(1_234_567, en)).toBe('1.2M')
    expect(formatCompact(-1_234_567, en)).toBe('-1.2M')
    expect(formatCompact(1_234_567, { ...en, compactDisplay: 'long' })).toBe('1.2 million')
    expect(formatCompact(1234, { ...en, digits: 2 })).toBe('1.23K')
  })

  it('renders zero and the placeholder distinctly', () => {
    expect(formatCompact(0, en)).toBe('0')
    expect(formatCompact(null, en)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('reads its argument as a fraction by default, the way Intl does', () => {
    expect(formatPercent(0.055, en)).toBe('5.5%')
    expect(formatPercent(0.055, { ...en, digits: 2 })).toBe('5.50%')
    expect(formatPercent(1, en)).toBe('100.0%')
  })

  it('reads percentage points when the call site says so', () => {
    expect(formatPercent(5.5, { ...en, input: 'percent' })).toBe('5.5%')
    expect(formatPercent(-3.25, { ...en, input: 'percent', digits: 2 })).toBe('-3.25%')
  })

  it('takes signDisplay, and renders zero and the placeholder distinctly', () => {
    expect(formatPercent(0.055, { ...en, signDisplay: 'always' })).toBe('+5.5%')
    expect(formatPercent(0, en)).toBe('0.0%')
    expect(formatPercent(null, en)).toBe('—')
  })
})

describe('formatMoney', () => {
  it('uses the currency’s own fraction digits and the locale’s own placement', () => {
    expect(formatMoney(1234.5, { ...en, currency: 'USD' })).toBe('$1,234.50')
    expect(formatMoney(1234.5, { locale: 'de-DE', currency: 'EUR' })).toBe('1.234,50 €')
    // JPY has no minor unit, and Intl knows that without being told.
    expect(formatMoney(1234.5, { ...en, currency: 'JPY' })).toBe('¥1,235')
  })

  it('takes currencyDisplay and explicit digits', () => {
    expect(formatMoney(1234.5, { ...en, currency: 'USD', currencyDisplay: 'code' })).toBe(
      'USD 1,234.50',
    )
    expect(formatMoney(1234.5, { ...en, currency: 'USD', digits: 0 })).toBe('$1,235')
  })

  it('accepts and ignores timeZone, so one bound option bag fits every formatter', () => {
    expect(formatMoney(10, { ...en, currency: 'USD', timeZone: TOKYO })).toBe(
      formatMoney(10, { ...en, currency: 'USD' }),
    )
  })

  it('renders zero and the placeholder distinctly', () => {
    expect(formatMoney(0, { ...en, currency: 'USD' })).toBe('$0.00')
    expect(formatMoney(null, { ...en, currency: 'USD' })).toBe('—')
  })
})

describe('formatQuantity', () => {
  it('renders a sanctioned Intl unit through Intl', () => {
    expect(formatQuantity(5, { ...en, unit: 'foot' })).toBe('5 ft')
    expect(formatQuantity(5, { ...en, unit: 'foot', unitDisplay: 'long' })).toBe('5 feet')
    expect(formatQuantity(21.5, { ...en, unit: 'celsius', digits: 1 })).toBe('21.5°C')
  })

  it('appends an unsanctioned unit instead of throwing the RangeError Intl throws', () => {
    // riverstatus reads `cfs` and `ft3/s` straight off the USGS feed; neither
    // is in Intl's sanctioned list, and `new Intl.NumberFormat` throws on both.
    expect(formatQuantity(1234, { ...en, unit: 'cfs' })).toBe('1,234 cfs')
    expect(formatQuantity(1234.56, { ...en, unit: 'ft3/s', digits: 1 })).toBe('1,234.6 ft3/s')
  })

  it('renders zero and the placeholder distinctly', () => {
    expect(formatQuantity(0, { ...en, unit: 'foot' })).toBe('0 ft')
    expect(formatQuantity(null, { ...en, unit: 'cfs' })).toBe('—')
  })
})

describe('createFormatters', () => {
  const bound = createFormatters({ timeZone: CHICAGO, locale: 'en-US' })

  it('binds the zone once, for every date formatter in the set', () => {
    const at = '2026-03-08T08:30:00Z'
    expect(bound.formatDate(at)).toBe('Mar 8, 2026')
    expect(bound.formatDateTime(at)).toBe('Mar 8, 2026, 3:30 AM')
    expect(bound.formatRelative(at, { now: '2026-03-08T11:30:00Z' })).toBe('3 hours ago')
  })

  it('binds the locale and the placeholder for the number formatters too', () => {
    const german = createFormatters({ timeZone: 'UTC', locale: 'de-DE', empty: 'unbekannt' })
    expect(german.formatNumber(1234.5)).toBe('1.234,5')
    expect(german.formatCompact(1_234_567)).toBe('1,2 Mio.')
    expect(german.formatPercent(0.055)).toBe('5,5 %')
    expect(german.formatDuration(5_400_000)).toBe('1h 30 Min.')
    expect(german.formatQuantity(5, { unit: 'foot' })).toBe('5 ft')
    expect(german.formatMoney(1234.5, { currency: 'EUR' })).toBe('1.234,50 €')
    expect(german.formatDate(null)).toBe('unbekannt')
  })

  it('lets a single call override the bound zone without a second bound set', () => {
    expect(bound.formatDateTime('2026-03-08T08:30:00Z', { timeZone: TOKYO })).toBe(
      'Mar 8, 2026, 5:30 PM',
    )
  })

  it('keeps the bound zone when a per-call option is explicitly undefined', () => {
    // `Partial<NeDateTimeOptions>` admits `{ timeZone: undefined }`, and a
    // caller gets exactly that from any optional field. A plain spread would
    // keep the own property, and `Intl` reads an own `undefined` `timeZone` as
    // the *host's* zone -- so this call would render one string in a UTC Worker
    // and another in the reader's browser. narduk-libs#283 review.
    const at = '2026-03-08T08:30:00Z'
    const zone: string | undefined = undefined
    expect(bound.formatDateTime(at, { timeZone: zone })).toBe(bound.formatDateTime(at))
    expect(bound.formatDateTime(at, { timeZone: zone })).toBe('Mar 8, 2026, 3:30 AM')
    expect(bound.formatDate(at, { timeZone: zone })).toBe('Mar 8, 2026')
    expect(bound.formatRelative(at, { now: '2026-03-08T11:30:00Z', timeZone: zone })).toBe(
      '3 hours ago',
    )
    // The same holds for the other two bound defaults, which have their own
    // `??` fallbacks but must not fall back to a *different* value than the
    // bound one.
    const german = createFormatters({ timeZone: 'UTC', locale: 'de-DE', empty: 'unbekannt' })
    const locale: string | undefined = undefined
    expect(german.formatNumber(1234.5, { locale })).toBe('1.234,5')
    expect(german.formatDate(null, { empty: undefined })).toBe('unbekannt')
  })

  it('is frozen, so one surface cannot quietly repoint another surface’s formatter', () => {
    expect(Object.isFrozen(bound)).toBe(true)
  })
})

describe('defaults', () => {
  it('defaults the locale to a fixed en-US rather than to the host locale', () => {
    // A host-locale default is the same hydration bug as a host-zone default:
    // the server and the browser resolve different locales.
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(formatDate('2026-03-08T08:30:00Z', { timeZone: 'UTC' })).toBe('Mar 8, 2026')
  })
})

/**
 * Count constructions of `Intl.DateTimeFormat` / `Intl.NumberFormat`.
 *
 * Hand-rolled rather than `vi.spyOn`: both are called with `new`, and the
 * spy's wrapper is a plain function, so `new spy(...)` yields the wrapper's
 * own empty object and the very next `.format(...)` throws. `Reflect.construct`
 * forwards the `new` properly.
 */
function countConstructions(key: 'DateTimeFormat' | 'NumberFormat') {
  const patchable = Intl as unknown as Record<string, unknown>
  const original = patchable[key]
  let calls = 0
  patchable[key] = function constructing(...args: unknown[]) {
    calls += 1
    return Reflect.construct(original as new (...rest: unknown[]) => object, args)
  }
  return {
    get calls() {
      return calls
    },
    reset: () => {
      calls = 0
    },
    restore: () => {
      patchable[key] = original
    },
  }
}

describe('the Intl cache', () => {
  it('constructs one formatter per option set and reuses it', () => {
    // A locale nothing else in this file uses, so the first call is a miss
    // whatever order the suites ran in.
    const options = { locale: 'en-SG', timeZone: CHICAGO, style: 'long' } as const
    const counter = countConstructions('DateTimeFormat')
    try {
      expect(formatDate('2026-03-08T08:30:00Z', options)).toBe('8 March 2026')
      const afterFirst = counter.calls
      expect(afterFirst).toBeGreaterThan(0)
      for (let index = 0; index < 5; index++) formatDate('2026-03-09T08:30:00Z', options)
      expect(counter.calls).toBe(afterFirst)
    } finally {
      counter.restore()
    }
  })

  it('is bounded, so an option set derived from data cannot grow it without limit', () => {
    // 300 well-formed but arbitrary ISO-4217-shaped codes: more distinct
    // option sets than the cache holds.
    const currency = (index: number) =>
      `X${String.fromCodePoint(65 + Math.floor(index / 26))}${String.fromCodePoint(65 + (index % 26))}`
    const probe = 'XZZ'
    const counter = countConstructions('NumberFormat')
    try {
      formatMoney(1, { ...en, currency: probe })
      counter.reset()
      formatMoney(1, { ...en, currency: probe })
      expect(counter.calls).toBe(0)

      // The cap clears rather than evicting one entry, so the probe above is
      // gone afterwards and its next call constructs again.
      for (let index = 0; index < 300; index++) formatMoney(1, { ...en, currency: currency(index) })
      counter.reset()
      formatMoney(1, { ...en, currency: probe })
      expect(counter.calls).toBeGreaterThan(0)
    } finally {
      counter.restore()
    }
  })
})
