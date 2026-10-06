import { describe, expect, it } from 'vitest'

import {
  analyticsAddDays,
  analyticsLocalDateKey,
  analyticsLocalMidnightMs,
  AnalyticsWindowError,
  resolveAnalyticsQuery,
  resolveAnalyticsTraffic,
  resolveAnalyticsWindow,
} from '../server/utils/analyticsWindow'

// 2026-10-05 18:09 UTC, a Monday; 13:09 in Chicago (CDT).
const NOW = Date.UTC(2026, 9, 5, 18, 9, 0)

describe('resolveAnalyticsWindow presets', () => {
  it('cuts a day preset into local calendar days, today included', () => {
    const window = resolveAnalyticsWindow({ period: '7d' }, NOW)
    expect(window.bucket).toBe('1d')
    expect(window.slots).toHaveLength(7)
    expect(window.slots[0]?.key).toBe('2026-09-29')
    expect(window.slots.at(-1)?.key).toBe('2026-10-05')
    expect(window.startDate).toBe('2026-09-29')
    expect(window.endDate).toBe('2026-10-05')
    expect(window.fromIso).toBe('2026-09-29T00:00:00.000Z')
    expect(window.toIso).toBe('2026-10-06T00:00:00.000Z')
  })

  it('takes the day edges in the display zone, not UTC', () => {
    const window = resolveAnalyticsWindow({ period: '1d', tz: 'America/Chicago' }, NOW)
    expect(window.slots).toHaveLength(1)
    expect(window.fromIso).toBe('2026-10-05T05:00:00.000Z')
    expect(window.toIso).toBe('2026-10-06T05:00:00.000Z')
  })

  it('is DST-safe: a 25-hour fall-back day is one slot', () => {
    // 2026-11-01 is the US fall-back day.
    const now = Date.UTC(2026, 10, 1, 18, 0, 0)
    const window = resolveAnalyticsWindow({ period: '1d', tz: 'America/Chicago' }, now)
    expect(window.slots).toHaveLength(1)
    expect((window.toMs - window.fromMs) / 3_600_000).toBe(25)
  })

  it.each([
    ['1h', '5m', 12],
    ['3h', '15m', 12],
    ['12h', '1h', 12],
    ['24h', '1h', 24],
  ])('%s uses %s buckets (%i slots) aligned to the epoch', (period, bucket, count) => {
    const window = resolveAnalyticsWindow({ period }, NOW)
    expect(window.bucket).toBe(bucket)
    expect(window.slots).toHaveLength(count)
    for (const slot of window.slots) {
      expect(slot.startMs % window.bucketMs).toBe(0)
      expect(slot.key).toBe(String(slot.startMs / 1000))
    }
    // The bucket holding "now" is the last one, still filling.
    const last = window.slots.at(-1)!
    expect(NOW).toBeGreaterThanOrEqual(last.startMs)
    expect(NOW).toBeLessThan(last.endMs)
  })

  it('rejects what it cannot cut, with a message the page can show', () => {
    expect(() => resolveAnalyticsWindow({ period: '73h' }, NOW)).toThrow(
      'Hourly ranges go up to 72 h',
    )
    expect(() => resolveAnalyticsWindow({ period: '181d' }, NOW)).toThrow('Up to 180 days.')
    expect(() => resolveAnalyticsWindow({ period: 'soon' }, NOW)).toThrow(AnalyticsWindowError)
    expect(() => resolveAnalyticsWindow({ period: '0d' }, NOW)).toThrow(AnalyticsWindowError)
    expect(() => resolveAnalyticsWindow({ tz: 'Mars/Olympus' }, NOW)).toThrow('Unknown time zone.')
    expect(() => resolveAnalyticsWindow({ tz: '../etc' }, NOW)).toThrow('Unknown time zone.')
  })
})

describe('resolveAnalyticsWindow custom ranges', () => {
  it('includes the start day and excludes the end day', () => {
    const window = resolveAnalyticsWindow({ start: '2026-09-01', end: '2026-09-04' }, NOW)
    expect(window.custom).toBe(true)
    expect(window.slots.map((slot) => slot.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(window.endDate).toBe('2026-09-03')
    expect(window.label).toBe('2026-09-01..2026-09-04')
  })

  it('validates the way the page explains it', () => {
    const run = (start: string, end: string) => () => resolveAnalyticsWindow({ start, end }, NOW)
    expect(run('2026-09-04', '2026-09-04')).toThrow(
      'End must be after start. The end day is excluded.',
    )
    expect(run('2026-09-05', '2026-09-01')).toThrow('End must be after start.')
    expect(run('2026-01-01', '2026-10-01')).toThrow('Up to 180 days.')
    expect(run('2026-10-01', '2026-10-07')).toThrow('End can’t be after tomorrow.')
    expect(run('2026-02-30', '2026-03-05')).toThrow('Dates are YYYY-MM-DD.')
    expect(() => resolveAnalyticsWindow({ start: '2026-09-01' }, NOW)).toThrow(
      'A custom range needs a start and an end date.',
    )
    // Tomorrow as the (excluded) end is how a range includes today.
    expect(run('2026-10-01', '2026-10-06')).not.toThrow()
  })
})

describe('local date helpers', () => {
  it('reads the local date of an instant in a zone', () => {
    expect(analyticsLocalDateKey(Date.UTC(2026, 9, 5, 2, 0, 0), 'America/Chicago')).toBe(
      '2026-10-04',
    )
    expect(analyticsLocalDateKey(Date.UTC(2026, 9, 5, 2, 0, 0), 'UTC')).toBe('2026-10-05')
  })

  it('adds days across months and leap days', () => {
    expect(analyticsAddDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(analyticsAddDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(analyticsAddDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('finds local midnight, skipping a DST gap rather than landing in it', () => {
    // 2026-03-08 02:00 does not exist in Chicago; midnight that day is still CST.
    expect(new Date(analyticsLocalMidnightMs('2026-03-08', 'America/Chicago')).toISOString()).toBe(
      '2026-03-08T06:00:00.000Z',
    )
  })
})

describe('traffic filter', () => {
  it('defaults to external, which is the unmarked class', () => {
    expect(resolveAnalyticsTraffic(undefined)).toEqual({ key: 'external', classes: ['unmarked'] })
    expect(resolveAnalyticsTraffic('external')).toEqual({ key: 'external', classes: ['unmarked'] })
  })

  it('counts everything for all and exactly the listed classes otherwise', () => {
    expect(resolveAnalyticsTraffic('all')).toEqual({ key: 'all', classes: null })
    expect(resolveAnalyticsTraffic('owner,unmarked')).toEqual({
      key: 'owner,unmarked',
      classes: ['owner', 'unmarked'],
    })
    expect(resolveAnalyticsTraffic('unmarked,owner').key).toBe('owner,unmarked')
  })

  it('refuses a class the module never stamps', () => {
    expect(() => resolveAnalyticsTraffic('human')).toThrow(AnalyticsWindowError)
    expect(() => resolveAnalyticsTraffic("owner,'; drop")).toThrow(AnalyticsWindowError)
  })

  it('resolves window and traffic together', () => {
    const resolved = resolveAnalyticsQuery({ period: '24h', traffic: 'all', tz: 'UTC' }, NOW)
    expect(resolved.window.bucket).toBe('1h')
    expect(resolved.traffic.key).toBe('all')
  })
})
