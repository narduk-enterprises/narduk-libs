import { describe, expect, it } from 'vitest'

import { resolveAnalyticsWindow } from '../server/utils/analyticsWindow'
import {
  analyticsCacheTtl,
  buildPosthogBucketExpr,
  buildPosthogTrafficClause,
  buildPosthogWindowClause,
  posthogNumber,
  posthogUpstreamError,
  resolveAnalyticsQueryOr400,
  TRAFFIC_CLASS_EXPR,
} from '../server/utils/posthogQuery'

const NOW = Date.UTC(2026, 9, 5, 18, 9, 0)

describe('buildPosthogWindowClause', () => {
  it('is a half-open UTC interval', () => {
    const window = resolveAnalyticsWindow({ period: '1d' }, NOW)
    expect(buildPosthogWindowClause(window)).toBe(
      "timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC') AND timestamp < toDateTime('2026-10-06 00:00:00', 'UTC')",
    )
  })
})

describe('buildPosthogTrafficClause', () => {
  it('adds nothing for all traffic', () => {
    expect(buildPosthogTrafficClause({ classes: null })).toBe('')
  })

  it('counts a missing traffic_class as unmarked, never as a person or an owner', () => {
    expect(TRAFFIC_CLASS_EXPR).toContain(
      "coalesce(nullIf(toString(properties.traffic_class), ''), 'unmarked')",
    )
    expect(buildPosthogTrafficClause({ classes: ['unmarked'] })).toBe(
      `AND ${TRAFFIC_CLASS_EXPR} IN ('unmarked', 'external')`,
    )
  })

  it('lists exactly the requested classes', () => {
    expect(buildPosthogTrafficClause({ classes: ['owner'] })).toBe(
      `AND ${TRAFFIC_CLASS_EXPR} IN ('owner')`,
    )
    expect(buildPosthogTrafficClause({ classes: ['owner', 'unmarked'] })).toContain(
      "'owner', 'unmarked', 'external'",
    )
  })
})

describe('buildPosthogBucketExpr', () => {
  it('groups days by the local calendar date in the display zone', () => {
    const window = resolveAnalyticsWindow({ period: '7d', tz: 'America/Chicago' }, NOW)
    expect(buildPosthogBucketExpr(window)).toBe(
      "formatDateTime(toTimeZone(timestamp, 'America/Chicago'), '%Y-%m-%d')",
    )
  })

  it.each([
    ['1h', 300],
    ['3h', 900],
    ['24h', 3600],
  ])('groups %s by epoch-aligned %i s buckets', (period, seconds) => {
    const window = resolveAnalyticsWindow({ period }, NOW)
    expect(buildPosthogBucketExpr(window)).toBe(
      `intDiv(toUnixTimestamp(timestamp), ${seconds}) * ${seconds}`,
    )
  })
})

describe('request plumbing', () => {
  it('answers 400 with the window message, defaulting the period', () => {
    expect(resolveAnalyticsQueryOr400({}, '7d', NOW).window.label).toBe('7d')
    expect(() => resolveAnalyticsQueryOr400({ period: '500d' }, '30d', NOW)).toThrow(
      expect.objectContaining({ statusCode: 400, statusMessage: 'Up to 180 days.' }),
    )
  })

  it('carries noCache and traffic through', () => {
    const resolved = resolveAnalyticsQueryOr400({ traffic: 'all', noCache: true }, '30d', NOW)
    expect(resolved.noCache).toBe(true)
    expect(resolved.traffic.key).toBe('all')
  })

  it('caches short windows for a minute and long ones for the default', () => {
    const hourly = resolveAnalyticsWindow({ period: '3h' }, NOW)
    const daily = resolveAnalyticsWindow({ period: '7d' }, NOW)
    expect(analyticsCacheTtl(hourly, false)).toBe(60_000)
    expect(analyticsCacheTtl(daily, false)).toBeUndefined()
    expect(analyticsCacheTtl(daily, true)).toBe(0)
  })

  it('keeps an upstream status and reads counts as numbers', () => {
    expect(posthogUpstreamError({ status: 429, message: 'slow down' })).toMatchObject({
      statusCode: 429,
      statusMessage: 'PostHog Error: slow down',
    })
    expect(posthogUpstreamError(new Error('boom'))).toMatchObject({ statusCode: 500 })
    expect(posthogNumber('12')).toBe(12)
    expect(posthogNumber(null)).toBe(0)
    expect(posthogNumber(undefined)).toBe(0)
  })
})
