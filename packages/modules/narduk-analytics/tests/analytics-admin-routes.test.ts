import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cachedAnalyticsFetch } from '../server/utils/analyticsCache'

import type * as PosthogUtils from '../server/utils/posthog'
import type * as H3 from 'h3'

/**
 * The admin Analytics reads, run end to end against a stubbed PostHog: what
 * HogQL each route sends for a window, a time zone and a traffic filter, and
 * how it shapes the rows it gets back. PostHog itself is not reachable from a
 * unit test, so the query text is asserted structurally and the answers are
 * canned.
 */

const NOW = Date.UTC(2026, 9, 5, 18, 9, 0)

const posthog = vi.hoisted(() => ({ calls: [] as string[], answers: [] as unknown[][][] }))

// The routes read the query through h3's helper; a fake event carries it as `.query`.
vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof H3>()),
  getValidatedQuery: (
    event: { query: Record<string, string> },
    parse: (value: unknown) => unknown,
  ) => parse(event.query),
}))
vi.mock('@narduk-enterprises/narduk-core/server/utils/auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => {
  const log = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  return { useLogger: () => log }
})
vi.mock('#narduk-analytics-server/utils/runtimeConfig', () => ({
  analyticsRuntimeConfig: () => ({}),
}))
vi.mock('#narduk-analytics-server/utils/posthog', async (importOriginal) => {
  const actual = await importOriginal<typeof PosthogUtils>()
  return {
    ...actual,
    resolvePosthogProjectConfig: () => ({
      apiHost: 'https://p.example',
      apiKey: 'k',
      domain: 'farm.example',
      projectId: '1',
    }),
    posthogQueryFetch: vi.fn(async (_project: unknown, body: { query: string }) => {
      posthog.calls.push(body.query)
      return { results: posthog.answers.shift() ?? [] }
    }),
  }
})

type Handler = (event: { query: Record<string, string> }) => Promise<Record<string, unknown>>

async function route(path: string): Promise<Handler> {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal(
    'getValidatedQuery',
    (event: { query: Record<string, string> }, parse: (value: unknown) => unknown) =>
      parse(event.query),
  )
  vi.stubGlobal('getQuery', (event: { query: Record<string, string> }) => event.query)
  vi.stubGlobal('cachedAnalyticsFetch', cachedAnalyticsFetch)
  return (await import(`../server/admin/api/admin/posthog/${path}.get.ts`)).default as Handler
}

const ask = (handler: Handler, query: Record<string, string> = {}) =>
  handler({ query: { noCache: '1', ...query } })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  posthog.calls = []
  posthog.answers = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('overview', () => {
  it('asks for the window, the host and external traffic, and fills empty buckets with zero', async () => {
    posthog.answers = [
      [
        ['2026-10-03', 4, 3, 2],
        ['2026-10-05', 10, 6, 5],
      ],
      [[14, 9, 7]],
      [[8, 5, 4]],
      [
        ['unmarked', 12],
        ['owner', 2],
      ],
    ]
    const res = await ask(await route('overview'), { period: '3d', tz: 'UTC' })

    expect(res.series).toEqual([
      expect.objectContaining({ key: '2026-10-03', pageviews: 4, sessions: 3, visitors: 2 }),
      expect.objectContaining({ key: '2026-10-04', pageviews: 0, sessions: 0, visitors: 0 }),
      expect.objectContaining({ key: '2026-10-05', pageviews: 10, sessions: 6, visitors: 5 }),
    ])
    expect(res.totals).toEqual({ pageviews: 14, sessions: 9, visitors: 7 })
    expect(res.previous).toEqual({ pageviews: 8, sessions: 5, visitors: 4 })
    expect(res.classes).toEqual([
      { class: 'unmarked', events: 12 },
      { class: 'owner', events: 2 },
    ])
    expect(res).toMatchObject({ bucket: '1d', period: '3d', traffic: 'external' })

    const [series, totals, previous, classes] = posthog.calls
    expect(series).toContain("formatDateTime(toTimeZone(timestamp, 'UTC'), '%Y-%m-%d')")
    expect(series).toContain("timestamp >= toDateTime('2026-10-03 00:00:00', 'UTC')")
    expect(series).toContain("timestamp < toDateTime('2026-10-06 00:00:00', 'UTC')")
    expect(series).toContain("lower(domain(properties.$current_url)) = 'farm.example'")
    expect(series).toContain("IN ('unmarked', 'external')")
    // The previous range is the equal span just before.
    expect(previous).toContain("timestamp >= toDateTime('2026-09-30 00:00:00', 'UTC')")
    expect(previous).toContain("timestamp < toDateTime('2026-10-03 00:00:00', 'UTC')")
    expect(totals).toContain('count(DISTINCT person_id)')
    // The class breakdown ignores the traffic filter: it is how the filter is chosen.
    expect(classes).not.toContain('IN (')
    expect(classes).toContain('GROUP BY traffic_class')
  })

  it('does not filter at all for all traffic and counts sessions from $session_id', async () => {
    posthog.answers = [[], [[0, 0, 0]], [[0, 0, 0]], []]
    await ask(await route('overview'), { period: '24h', traffic: 'all' })
    expect(posthog.calls[0]).not.toContain('traffic_class')
    expect(posthog.calls[0]).toContain('$session_id')
    expect(posthog.calls[0]).toContain('intDiv(toUnixTimestamp(timestamp), 3600) * 3600')
  })

  it('answers 400 with the reason for a bad custom range, before any query', async () => {
    const handler = await route('overview')
    await expect(ask(handler, { start: '2026-10-04', end: '2026-10-04' })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'End must be after start. The end day is excluded.',
    })
    expect(posthog.calls).toHaveLength(0)
  })

  it("keeps PostHog's own status when it fails", async () => {
    const { posthogQueryFetch } = await import('#narduk-analytics-server/utils/posthog')
    vi.mocked(posthogQueryFetch).mockRejectedValueOnce({ status: 429, message: 'throttled' })
    await expect(ask(await route('overview'), { period: '7d' })).rejects.toMatchObject({
      statusCode: 429,
    })
  })
})

describe('devices and referrers', () => {
  it('flags a blank device as unknown and does not rename it a device', async () => {
    posthog.answers = [
      [
        ['Mobile', 20, 10],
        [null, 3, 2],
      ],
    ]
    const res = await ask(await route('devices'), { period: '7d' })
    expect(res.rows).toEqual([
      { device: 'Mobile', pageviews: 20, uniqueVisitors: 10 },
      { device: 'Unknown', pageviews: 3, uniqueVisitors: 2, unknown: true },
    ])
  })

  it('reports a blank referrer as unknown, never (direct)', async () => {
    posthog.answers = [
      [
        ['google.com', 9, 7],
        ['', 30, 20],
      ],
    ]
    const res = await ask(await route('referrers'), { period: '28d' })
    expect(res.rows).toEqual([
      { referrer: 'google.com', visits: 9, uniqueVisitors: 7 },
      { referrer: '(no referrer)', visits: 30, uniqueVisitors: 20, unknown: true },
    ])
    expect(JSON.stringify(res)).not.toContain('(direct)')
    expect(posthog.calls[0]).not.toContain('(direct)')
  })
})

describe('entry and exit', () => {
  it("takes each session's first and last pageview, not $pageleave", async () => {
    posthog.answers = [[['/', 12]], [['/pricing', 7]]]
    const res = await ask(await route('entry-exit'), { period: '7d' })
    expect(res.entryPages).toEqual([{ page: '/', count: 12 }])
    expect(res.exitPages).toEqual([{ page: '/pricing', count: 7 }])
    expect(posthog.calls[0]).toContain('argMin(')
    expect(posthog.calls[0]).toContain('argMax(')
    expect(posthog.calls.join('\n')).not.toContain('$pageleave')
    expect(posthog.calls.join('\n')).not.toContain('$is_initial_landing')
    expect(posthog.calls[0]).toContain("IN ('unmarked', 'external')")
  })
})

describe('health', () => {
  it('reads the trailing 28 days across every traffic class and classifies it', async () => {
    posthog.answers = [[[840, 210, Math.floor(NOW / 1000) - 60, 84]]]
    const res = await ask(await route('health'))
    expect(res).toMatchObject({ state: 'tracking', events28d: 840, markedShare: 0.1 })
    expect(posthog.calls[0]).not.toContain("IN ('")
    expect(posthog.calls[0]).toContain('toIntervalDay(28)')
  })

  it('says silent for an app with no events, with no last event', async () => {
    posthog.answers = [[[0, 0, null, 0]]]
    const res = await ask(await route('health'))
    expect(res).toMatchObject({ state: 'silent', lastEventAt: null, markedShare: null })
  })
})

describe('origins', () => {
  it('groups first-pageview sessions into channels, with a blank referrer as unknown', async () => {
    posthog.answers = [
      [
        ['google.com', '', 30],
        ['', '', 50],
        ['', 'email', 5],
        ['claude.ai', '', 4],
      ],
    ]
    const res = await ask(await route('origins'), { period: '28d' })
    expect(res.rows).toEqual([
      { label: 'No referrer (unknown)', sessions: 50, unknown: true },
      { label: 'Organic search', sessions: 30 },
      { label: 'Email', sessions: 5 },
      { label: 'AI assistants', sessions: 4 },
    ])
    expect(posthog.calls[0]).toContain('argMin(')
  })

  it('counts sessions that carry no campaign apart, so rows are not padded', async () => {
    posthog.answers = [
      [
        ['', 90],
        ['spring', 10],
      ],
    ]
    const res = await ask(await route('origins'), { dimension: 'campaigns', period: '28d' })
    expect(res.rows).toEqual([{ label: 'spring', sessions: 10 }])
    expect(res.sessionsWithoutValue).toBe(90)
  })

  it('refuses a dimension it does not know', async () => {
    await expect(ask(await route('origins'), { dimension: 'cookies' })).rejects.toBeTruthy()
    expect(posthog.calls).toHaveLength(0)
  })
})
