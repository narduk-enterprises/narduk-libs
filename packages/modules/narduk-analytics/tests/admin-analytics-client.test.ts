import { describe, expect, it } from 'vitest'

import {
  adminAxisIndices,
  adminBarPercent,
  adminChartScale,
  adminIndexFromOffset,
  adminSlotCentre,
  adminSlotInProgress,
  adminSlotLabel,
  adminStepIndex,
  adminTrendPolygon,
} from '../app/utils/analyticsAdminChart'
import {
  adminAddDays,
  adminAgeLabel,
  adminClassifyFailure,
  adminDateKey,
  adminDelta,
  adminFreshness,
  adminRangeDates,
  adminRangeDefaults,
  adminRangeLine,
  adminRangeQuery,
  adminTrafficParam,
  adminValidateCustomRange,
} from '../app/utils/analyticsAdminRange'
import {
  adminBuildTiles,
  adminDailyGoogleValues,
  adminGaDailyUsers,
  adminGaThrough,
  adminGscSettledThrough,
  adminSourceChips,
} from '../app/utils/analyticsAdminTiles'

import type {
  AdminAnalyticsGa,
  AdminAnalyticsGsc,
  AdminAnalyticsOverview,
} from '../app/types/adminAnalyticsTypes'
import type { AdminSourceState } from '../app/utils/analyticsAdminTiles'

// 2026-10-05 18:09 UTC = 13:09 in Chicago.
const NOW = Date.UTC(2026, 9, 5, 18, 9, 0)
const CHICAGO = 'America/Chicago'
const SEP_01 = '2026-09-01'
const SEP_08 = '2026-09-08'
const OCT_01 = '2026-10-01'
const OCT_02 = '2026-10-02'
const OCT_05 = '2026-10-05'

describe('range query', () => {
  it('sends a preset with its zone and the external default', () => {
    expect(adminRangeQuery(adminRangeDefaults(), CHICAGO)).toEqual({
      period: '28d',
      tz: CHICAGO,
      traffic: 'external',
    })
  })

  it('sends UTC when UTC is chosen, and a custom range as start and end only', () => {
    const state = {
      ...adminRangeDefaults(),
      preset: 'custom' as const,
      start: SEP_01,
      end: SEP_08,
      tz: 'utc' as const,
    }
    expect(adminRangeQuery(state, CHICAGO)).toEqual({
      start: SEP_01,
      end: SEP_08,
      tz: 'UTC',
      traffic: 'external',
    })
  })

  it('maps the traffic controls onto the API value', () => {
    const base = adminRangeDefaults()
    expect(adminTrafficParam(base)).toBe('external')
    expect(adminTrafficParam({ ...base, traffic: 'internal' })).toBe('all')
    expect(adminTrafficParam({ ...base, traffic: 'internal', includeClasses: ['owner'] })).toBe(
      'owner,unmarked',
    )
    expect(
      adminTrafficParam({ ...base, traffic: 'internal', includeClasses: ['automation'] }),
    ).toBe('automation,unmarked')
    // Nothing added back is just External, not an empty filter.
    expect(adminTrafficParam({ ...base, traffic: 'internal', includeClasses: [] })).toBe('external')
  })
})

describe('custom range validation', () => {
  const check = (start: string, end: string) => adminValidateCustomRange(start, end, NOW, 'UTC')

  it('accepts a valid range, with tomorrow as the excluded end', () => {
    expect(check(SEP_01, SEP_08)).toBeNull()
    expect(check(OCT_01, '2026-10-06')).toBeNull()
  })

  it("explains each way it can be wrong, in the server's words", () => {
    expect(check('', '')).toBe('Pick a start and an end date.')
    expect(check('2026-02-30', '2026-03-05')).toBe('Dates are YYYY-MM-DD.')
    expect(check(SEP_08, SEP_08)).toBe('End must be after start. The end day is excluded.')
    expect(check(SEP_08, SEP_01)).toBe('End must be after start. The end day is excluded.')
    expect(check('2026-01-01', SEP_01)).toBe('Up to 180 days.')
    expect(check(OCT_01, '2026-10-07')).toBe('End can’t be after tomorrow.')
  })

  it('judges "tomorrow" in the display zone, not UTC', () => {
    // 2026-10-06 02:00 UTC is still 5 Oct in Chicago, so 7 Oct is two days out there.
    const late = Date.UTC(2026, 9, 6, 2, 0, 0)
    expect(adminValidateCustomRange(OCT_01, '2026-10-07', late, 'UTC')).toBeNull()
    expect(adminValidateCustomRange(OCT_01, '2026-10-07', late, CHICAGO)).toBe(
      'End can’t be after tomorrow.',
    )
  })
})

describe('daily dates for the Google reads', () => {
  it('has none for a sub-day range: Google is daily only', () => {
    for (const preset of ['1h', '3h', '12h', '24h'] as const) {
      expect(adminRangeDates({ ...adminRangeDefaults(), preset }, NOW, 'UTC')).toBeNull()
    }
  })

  it('covers the last N local days, today included', () => {
    expect(adminRangeDates({ ...adminRangeDefaults(), preset: '7d' }, NOW, 'UTC')).toEqual({
      startDate: '2026-09-29',
      endDate: OCT_05,
    })
  })

  it('shifts with the zone near midnight', () => {
    const late = Date.UTC(2026, 9, 6, 2, 0, 0)
    expect(adminRangeDates({ ...adminRangeDefaults(), preset: '7d' }, late, CHICAGO)?.endDate).toBe(
      OCT_05,
    )
    expect(
      adminRangeDates({ ...adminRangeDefaults(), preset: '7d', tz: 'utc' }, late, CHICAGO)?.endDate,
    ).toBe('2026-10-06')
  })

  it('turns an excluded custom end into the last included day', () => {
    expect(
      adminRangeDates(
        { ...adminRangeDefaults(), preset: 'custom', start: SEP_01, end: SEP_08 },
        NOW,
        'UTC',
      ),
    ).toEqual({ startDate: SEP_01, endDate: '2026-09-07' })
    expect(
      adminRangeDates(
        { ...adminRangeDefaults(), preset: 'custom', start: SEP_08, end: SEP_08 },
        NOW,
        'UTC',
      ),
    ).toBeNull()
  })

  it('does date arithmetic across a month', () => {
    expect(adminAddDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(adminDateKey(Date.UTC(2026, 9, 5, 2, 0, 0), CHICAGO)).toBe('2026-10-04')
  })
})

describe('labels', () => {
  it('prints the half-open window in the display zone', () => {
    expect(adminRangeLine('2026-10-05T05:00:00.000Z', '2026-10-06T05:00:00.000Z', CHICAGO)).toMatch(
      /^\[5 Oct, 00:00 → 6 Oct, 00:00\) C[DS]T$/u,
    )
    expect(adminRangeLine('nope', 'nope', 'UTC')).toBe('')
  })

  it('says how old a cached read is', () => {
    expect(adminAgeLabel(10_000)).toBe('just now')
    expect(adminAgeLabel(12 * 60_000)).toBe('12 m')
    expect(adminAgeLabel((3 * 60 + 12) * 60_000)).toBe('3 h 12 m')
    expect(adminAgeLabel(50 * 3_600_000)).toBe('2 d 2 h')
  })

  it('stamps a read stale only past twice what a fresh one can be', () => {
    const iso = (ageMs: number) => new Date(NOW - ageMs).toISOString()
    expect(adminFreshness(iso(4 * 60_000), '28d', NOW)?.state).toBe('fresh')
    expect(adminFreshness(iso(11 * 60_000), '28d', NOW)?.state).toBe('stale')
    expect(adminFreshness(iso(90_000), '1h', NOW)?.state).toBe('fresh')
    expect(adminFreshness(iso(3 * 60_000), '1h', NOW)?.state).toBe('stale')
    expect(adminFreshness(undefined, '28d', NOW)).toBeNull()
  })

  it('shows a change against the previous range, and nothing when there is none', () => {
    expect(adminDelta(150, 100)).toEqual({ label: '+50%', sign: 1 })
    expect(adminDelta(90, 100)).toEqual({ label: '−10%', sign: -1 })
    expect(adminDelta(100, 100)).toEqual({ label: '0%', sign: 0 })
    expect(adminDelta(5, 0)).toBeNull()
  })

  it('tells "not set up" and "signed out" from a failure', () => {
    expect(adminClassifyFailure({ statusCode: 401 })).toBe('denied')
    expect(adminClassifyFailure({ statusCode: 403 })).toBe('denied')
    expect(
      adminClassifyFailure({ statusCode: 503, data: { data: { state: 'not_configured' } } }),
    ).toBe('not_configured')
    expect(adminClassifyFailure({ statusMessage: 'GA_PROPERTY_ID not configured' })).toBe(
      'not_configured',
    )
    expect(adminClassifyFailure({ statusCode: 500, statusMessage: 'boom' })).toBe('failed')
    expect(adminClassifyFailure(null)).toBe('failed')
  })
})

describe('chart geometry', () => {
  it('picks a nice top and ticks that reach it', () => {
    expect(adminChartScale(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(adminChartScale(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] })
    const { max, ticks } = adminChartScale(1234)
    expect(max).toBeGreaterThanOrEqual(1234)
    expect(ticks.at(-1)).toBe(max)
    expect(ticks[0]).toBe(0)
  })

  it('gives a non-zero value a visible sliver and a zero none', () => {
    expect(adminBarPercent(0, 100)).toBe(0)
    expect(adminBarPercent(1, 10_000)).toBe(1.5)
    expect(adminBarPercent(50, 100)).toBe(50)
    expect(adminBarPercent(500, 100)).toBe(100)
  })

  it('finds the slot under a pointer, clamped to the chart', () => {
    expect(adminIndexFromOffset(0, 100, 10)).toBe(0)
    expect(adminIndexFromOffset(55, 100, 10)).toBe(5)
    expect(adminIndexFromOffset(999, 100, 10)).toBe(9)
    expect(adminIndexFromOffset(-5, 100, 10)).toBe(0)
    expect(adminIndexFromOffset(5, 0, 10)).toBe(-1)
    expect(adminIndexFromOffset(5, 100, 0)).toBe(-1)
  })

  it('steps by keyboard: arrows, Home, End, paging, and ignores other keys', () => {
    expect(adminStepIndex('ArrowRight', -1, 5)).toBe(0)
    expect(adminStepIndex('ArrowLeft', -1, 5)).toBe(4)
    expect(adminStepIndex('ArrowRight', 4, 5)).toBe(4)
    expect(adminStepIndex('ArrowLeft', 0, 5)).toBe(0)
    expect(adminStepIndex('ArrowRight', 1, 5)).toBe(2)
    expect(adminStepIndex('Home', 3, 5)).toBe(0)
    expect(adminStepIndex('End', 1, 5)).toBe(4)
    expect(adminStepIndex('PageDown', 1, 30)).toBe(8)
    expect(adminStepIndex('PageUp', 3, 30)).toBe(0)
    expect(adminStepIndex('a', 1, 5)).toBeNull()
    expect(adminStepIndex('ArrowRight', 0, 0)).toBeNull()
  })

  it('draws a trend line inside its box and lines each point up with its bar', () => {
    expect(adminTrendPolygon([0, 50, 100], 100)).toBe(
      'polygon(16.67% 100%, 16.67% 100.00%, 50.00% 50.00%, 83.33% 0.00%, 83.33% 100%)',
    )
    expect(adminTrendPolygon([0, 100], 100, 2)).toBe(
      'polygon(25.00% 100%, 25.00% calc(100.00% + 2px), 75.00% calc(0.00% + 2px), 75.00% 100%)',
    )
    // Not measured is skipped, not drawn as zero.
    expect(adminTrendPolygon([10, null, 10], 100)).toBe(
      'polygon(16.67% 100%, 16.67% 90.00%, 83.33% 90.00%, 83.33% 100%)',
    )
    expect(adminTrendPolygon([null, null], 100)).toBe('')
    expect(adminTrendPolygon([], 100)).toBe('')
    expect(adminSlotCentre(0, 4)).toBe(12.5)
    expect(adminSlotCentre(3, 4)).toBe(87.5)
  })

  it('labels days from their own key and finer buckets in the display zone', () => {
    const day = { key: OCT_05, startMs: 0, endMs: 0 }
    expect(adminSlotLabel(day, '1d', CHICAGO, 'axis')).toBe('Oct 5')
    expect(adminSlotLabel(day, '1d', 'Pacific/Kiritimati', 'full')).toBe('Mon, Oct 5')
    const hour = { key: String(NOW / 1000), startMs: NOW, endMs: NOW + 3_600_000 }
    expect(adminSlotLabel(hour, '1h', 'UTC', 'axis')).toBe('6:09 PM')
    expect(adminSlotLabel(hour, '1h', 'UTC', 'full')).toBe('Oct 5, 6:09 PM – 7:09 PM')
  })

  it('thins the axis and marks the bucket that is still filling', () => {
    expect(adminAxisIndices(4, 6)).toEqual([0, 1, 2, 3])
    expect(adminAxisIndices(30, 6)).toEqual([0, 5, 10, 15, 20, 25])
    expect(adminAxisIndices(0)).toEqual([])
    expect(adminSlotInProgress({ startMs: 10, endMs: 20 }, 15)).toBe(true)
    expect(adminSlotInProgress({ startMs: 10, endMs: 20 }, 20)).toBe(false)
  })
})

describe('overview tiles and source chips', () => {
  const overviewData: AdminAnalyticsOverview = {
    bucket: '1d',
    cached: false,
    classes: [],
    fetchedAt: new Date(NOW - 60_000).toISOString(),
    period: '28d',
    previous: { pageviews: 200, sessions: 100, visitors: 50 },
    series: [],
    totals: { pageviews: 313, sessions: 237, visitors: 113 },
    traffic: 'external',
    window: {
      from: '2026-09-08T00:00:00.000Z',
      to: '2026-10-06T00:00:00.000Z',
      tz: 'UTC',
      label: '28d',
    },
  }
  const gaData: AdminAnalyticsGa = {
    cached: false,
    endDate: OCT_05,
    fetchedAt: '',
    startDate: SEP_08,
    totals: [{ value: '390' }],
    rows: [
      { dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '10' }] },
      { dimensionValues: [{ value: '20261002' }], metricValues: [{ value: '12' }] },
    ],
  }
  const gscData: AdminAnalyticsGsc = {
    cached: false,
    dimension: 'date',
    endDate: OCT_05,
    fetchedAt: '',
    startDate: SEP_08,
    rows: [
      { keys: [OCT_01], clicks: 4, impressions: 40, ctr: 0.1, position: 5 },
      { keys: ['2026-10-04'], clicks: 9, impressions: 90, ctr: 0.1, position: 5 },
    ],
  }
  const ok = <T>(data: T): AdminSourceState<T> => ({ data, failure: null, pending: false })
  const none = <T>(over: Partial<AdminSourceState<T>> = {}): AdminSourceState<T> => ({
    data: null,
    failure: null,
    pending: false,
    ...over,
  })
  const build = (over: Partial<Parameters<typeof adminBuildTiles>[0]> = {}) =>
    adminBuildTiles({
      overview: ok(overviewData),
      ga: ok(gaData),
      gscSeries: ok(gscData),
      nowMs: NOW,
      tz: 'UTC',
      ...over,
    })

  it('shows measured figures with a change against the previous range', () => {
    const tiles = build()
    const by = (id: string) => tiles.find((tile) => tile.id === id)!
    expect(by('people')).toMatchObject({
      value: '113',
      notMeasured: false,
      delta: { label: '+126%', sign: 1 },
    })
    expect(by('sessions').value).toBe('237')
    expect(by('pageviews').value).toBe('313')
    expect(by('depth').value).toBe('1.3')
    expect(by('ga-users')).toMatchObject({ value: '390', badge: 'Unfiltered' })
    expect(by('ga-users').note).toContain('through 2026-10-02')
  })

  it('leaves unsettled Search Console days out and says how many', () => {
    // Settled through 2026-10-03: the 4 Oct day is not counted, 2 days are unsettled.
    expect(adminGscSettledThrough(NOW, 'UTC')).toBe('2026-10-03')
    const tile = build().find((item) => item.id === 'search-clicks')!
    expect(tile.value).toBe('4')
    expect(tile.note).toBe('2 d not settled, left out')
  })

  it('says Not measured, with the reason, instead of a zero', () => {
    const tiles = build({
      overview: none({ failure: 'not_configured' }),
      ga: none({ dailyOnly: true }),
      gscSeries: none({ failure: 'failed' }),
    })
    const by = (id: string) => tiles.find((tile) => tile.id === id)!
    for (const id of ['people', 'sessions', 'pageviews', 'depth', 'ga-users', 'search-clicks']) {
      expect(by(id).notMeasured).toBe(true)
      expect(by(id).value).toBe('Not measured')
    }
    expect(by('people').note).toBe('PostHog is not set up for this app.')
    expect(by('ga-users').note).toBe('GA4 is daily only. Choose 7 d or longer.')
    expect(by('search-clicks').note).toBe('Search Console could not be read.')
  })

  it('does not invent pages per session when there are no sessions', () => {
    const tiles = build({
      overview: ok({ ...overviewData, totals: { pageviews: 0, sessions: 0, visitors: 0 } }),
    })
    expect(tiles.find((tile) => tile.id === 'people')?.value).toBe('0')
    expect(tiles.find((tile) => tile.id === 'depth')).toMatchObject({ notMeasured: true })
  })

  it('leaves days Google has not published blank, never zero', () => {
    const keys = [OCT_01, OCT_02, '2026-10-03', '2026-10-04']
    expect(adminDailyGoogleValues(keys, adminGaDailyUsers(gaData), adminGaThrough(gaData))).toEqual(
      [10, 12, null, null],
    )
    // A published day with no row is a real zero.
    expect(adminDailyGoogleValues([OCT_01, OCT_02], new Map([[OCT_02, 3]]), OCT_02)).toEqual([0, 3])
    expect(adminDailyGoogleValues([OCT_02], new Map(), null)).toEqual([0])
  })

  it('reads one status per source: age, how far it goes, or why it failed', () => {
    const chips = adminSourceChips({
      overview: ok({
        ...overviewData,
        cached: true,
        fetchedAt: new Date(NOW - (3 * 60 + 12) * 60_000).toISOString(),
      }),
      ga: none({ failure: 'failed' }),
      gsc: ok(gscData),
      nowMs: NOW,
    })
    expect(chips).toEqual([
      { id: 'posthog', label: 'PostHog', state: 'warn', text: 'Cache 3 h 12 m old' },
      { id: 'ga', label: 'GA4', state: 'bad', text: 'Last pull failed' },
      { id: 'gsc', label: 'Search Console', state: 'ok', text: 'Lags 2–3 d' },
    ])
    expect(
      adminSourceChips({
        overview: none({ failure: 'failed', data: overviewData }),
        ga: none({ dailyOnly: true }),
        gsc: none({ dailyOnly: true }),
        nowMs: NOW,
      }).map((chip) => chip.text),
    ).toEqual(['Refresh failed, showing the last read', 'Daily only', 'Daily only'])
  })
})
