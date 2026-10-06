/**
 * What the Overview tab shows, built from the raw reads: KPI tiles, the
 * per-bucket Google series, and the source chips. Pure, so the honest states
 * ("Not measured", daily-only, not yet settled) are tested rather than drawn.
 */
import {
  adminAddDays,
  adminAgeLabel,
  adminDateKey,
  adminDelta,
  adminFormatCount,
} from './analyticsAdminRange'

import type {
  AdminAnalyticsGa,
  AdminAnalyticsGsc,
  AdminAnalyticsOverview,
} from '../types/adminAnalyticsTypes'
import type { AdminSourceFailure } from './analyticsAdminRange'

/** Search Console data settles about two to three days late. */
export const ADMIN_GSC_LAG_DAYS = 2

export interface AdminSourceState<T> {
  /** The range has no daily dates (a sub-day range), so Google cannot answer. */
  dailyOnly?: boolean
  data: T | null
  failure: AdminSourceFailure | null
  pending: boolean
}

export interface AdminTile {
  badge?: string
  delta?: { label: string; sign: -1 | 0 | 1 }
  id: string
  label: string
  note: string
  /** The value could not be measured; `value` is the reason's headline, never a number. */
  notMeasured: boolean
  value: string
}

const gaNumber = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function notMeasured(
  id: string,
  label: string,
  state: AdminSourceState<unknown>,
  what: string,
): AdminTile {
  let note = 'Loading.'
  if (state.dailyOnly) note = `${what} is daily only. Choose 7 d or longer.`
  else if (state.failure === 'not_configured') note = `${what} is not set up for this app.`
  else if (state.failure === 'denied') note = 'Sign in as an admin.'
  else if (state.failure) note = `${what} could not be read.`
  else if (!state.pending) note = `${what} returned nothing.`
  return { id, label, value: 'Not measured', note, notMeasured: true }
}

export function adminGaDailyUsers(ga: AdminAnalyticsGa | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of ga?.rows ?? []) {
    const raw = row.dimensionValues?.[0]?.value ?? ''
    if (!/^\d{8}$/u.test(raw)) continue
    out.set(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      gaNumber(row.metricValues?.[0]?.value),
    )
  }
  return out
}

export function adminGscDailyClicks(gsc: AdminAnalyticsGsc | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of gsc?.rows ?? []) {
    const key = row.keys[0]
    if (key) out.set(key, row.clicks)
  }
  return out
}

/**
 * One value per daily slot, `null` where Google has not published the day yet.
 * A published day with no row is a real zero; a day after the last one Google
 * answered for is unknown, never zero.
 */
export function adminDailyGoogleValues(
  slotKeys: string[],
  byDay: Map<string, number>,
  settledThrough: string | null,
): Array<number | null> {
  return slotKeys.map((key) => {
    if (settledThrough && key > settledThrough) return null
    return byDay.get(key) ?? 0
  })
}

/** The last local day Search Console has settled, from today in the display zone. */
export const adminGscSettledThrough = (nowMs: number, tz: string) =>
  adminAddDays(adminDateKey(nowMs, tz), -ADMIN_GSC_LAG_DAYS)

/** The last day GA4 has a row for, which is as far as its figure goes. */
export function adminGaThrough(ga: AdminAnalyticsGa | null): string | null {
  const days = [...adminGaDailyUsers(ga).keys()].sort()
  return days.at(-1) ?? null
}

export interface AdminTilesInput {
  ga: AdminSourceState<AdminAnalyticsGa>
  gscSeries: AdminSourceState<AdminAnalyticsGsc>
  nowMs: number
  overview: AdminSourceState<AdminAnalyticsOverview>
  tz: string
}

export function adminBuildTiles(input: AdminTilesInput): AdminTile[] {
  const { overview, ga, gscSeries } = input
  const tiles: AdminTile[] = []
  const o = overview.data

  if (!o) {
    for (const [id, label] of [
      ['people', 'People'],
      ['sessions', 'Sessions'],
      ['pageviews', 'Pageviews'],
      ['depth', 'Pages per session'],
    ] as const) {
      tiles.push(notMeasured(id, label, overview, 'PostHog'))
    }
  } else {
    const vs = `vs previous ${o.window.label.includes('..') ? 'range' : o.window.label}`
    const delta = (current: number, previous: number) => {
      const found = adminDelta(current, previous)
      return found ? { delta: found } : {}
    }
    tiles.push(
      {
        id: 'people',
        label: 'People',
        value: adminFormatCount(o.totals.visitors),
        note: `distinct in this range · ${vs}`,
        notMeasured: false,
        ...delta(o.totals.visitors, o.previous.visitors),
      },
      {
        id: 'sessions',
        label: 'Sessions',
        value: adminFormatCount(o.totals.sessions),
        note: `PostHog · ${vs}`,
        notMeasured: false,
        ...delta(o.totals.sessions, o.previous.sessions),
      },
      {
        id: 'pageviews',
        label: 'Pageviews',
        value: adminFormatCount(o.totals.pageviews),
        note: `PostHog · ${vs}`,
        notMeasured: false,
        ...delta(o.totals.pageviews, o.previous.pageviews),
      },
      o.totals.sessions > 0
        ? {
            id: 'depth',
            label: 'Pages per session',
            value: (o.totals.pageviews / o.totals.sessions).toFixed(1),
            note: 'pageviews ÷ sessions',
            notMeasured: false,
          }
        : {
            id: 'depth',
            label: 'Pages per session',
            value: 'Not measured',
            note: 'No sessions in this range.',
            notMeasured: true,
          },
    )
  }

  if (!ga.data) {
    tiles.push({ ...notMeasured('ga-users', 'GA4 users', ga, 'GA4'), badge: 'Unfiltered' })
  } else {
    const through = adminGaThrough(ga.data)
    tiles.push({
      id: 'ga-users',
      label: 'GA4 users',
      value: adminFormatCount(gaNumber(ga.data.totals[0]?.value)),
      note: through ? `active users · through ${through}` : 'active users · no days published yet',
      badge: 'Unfiltered',
      notMeasured: false,
    })
  }

  if (!gscSeries.data) {
    tiles.push({
      ...notMeasured('search-clicks', 'Search clicks', gscSeries, 'Search Console'),
      badge: 'Unfiltered',
    })
  } else {
    const settled = adminGscSettledThrough(input.nowMs, input.tz)
    const clicks = [...adminGscDailyClicks(gscSeries.data).entries()]
      .filter(([day]) => day <= settled)
      .reduce((sum, [, value]) => sum + value, 0)
    const unsettled =
      gscSeries.data.endDate > settled
        ? Math.round(
            (Date.parse(`${gscSeries.data.endDate}T00:00:00Z`) -
              Date.parse(`${settled}T00:00:00Z`)) /
              86_400_000,
          )
        : 0
    tiles.push({
      id: 'search-clicks',
      label: 'Search clicks',
      value: adminFormatCount(clicks),
      note: unsettled > 0 ? `${unsettled} d not settled, left out` : 'settled days only',
      badge: 'Unfiltered',
      notMeasured: false,
    })
  }

  return tiles
}

export type AdminChipState = 'bad' | 'muted' | 'ok' | 'warn'

export interface AdminSourceChip {
  id: 'ga' | 'gsc' | 'posthog'
  label: string
  state: AdminChipState
  text: string
}

/** The one-line status of each source: how old, how far it goes, or why it failed. */
export function adminSourceChips(input: {
  ga: AdminSourceState<AdminAnalyticsGa>
  gsc: AdminSourceState<AdminAnalyticsGsc>
  nowMs: number
  overview: AdminSourceState<AdminAnalyticsOverview>
}): AdminSourceChip[] {
  const { overview, ga, gsc, nowMs } = input
  const chips: AdminSourceChip[] = []

  if (overview.failure === 'not_configured') {
    chips.push({ id: 'posthog', label: 'PostHog', state: 'bad', text: 'Not set up' })
  } else if (overview.failure) {
    chips.push({
      id: 'posthog',
      label: 'PostHog',
      state: 'bad',
      text: overview.data ? 'Refresh failed, showing the last read' : 'Read failed',
    })
  } else if (overview.data) {
    const fetched = Date.parse(overview.data.fetchedAt)
    const age = Number.isNaN(fetched) ? null : Math.max(0, nowMs - fetched)
    chips.push({
      id: 'posthog',
      label: 'PostHog',
      state: age !== null && age > 10 * 60_000 ? 'warn' : 'ok',
      text:
        age === null
          ? 'Read'
          : overview.data.cached
            ? `Cache ${adminAgeLabel(age)} old`
            : `Read ${adminAgeLabel(age)} ago`.replace('just now ago', 'just now'),
    })
  } else {
    chips.push({ id: 'posthog', label: 'PostHog', state: 'muted', text: 'Loading' })
  }

  const google = (
    id: 'ga' | 'gsc',
    label: string,
    state: AdminSourceState<unknown>,
    ok: string,
  ) => {
    if (state.dailyOnly) return { id, label, state: 'muted' as const, text: 'Daily only' }
    if (state.failure === 'not_configured')
      return { id, label, state: 'bad' as const, text: 'Not set up' }
    if (state.failure) return { id, label, state: 'bad' as const, text: 'Last pull failed' }
    if (state.data) return { id, label, state: 'ok' as const, text: ok }
    return { id, label, state: 'muted' as const, text: 'Loading' }
  }
  chips.push(google('ga', 'GA4', ga, `Through ${adminGaThrough(ga.data) ?? 'no day yet'}`))
  chips.push(
    google('gsc', 'Search Console', gsc, `Lags ${ADMIN_GSC_LAG_DAYS}–${ADMIN_GSC_LAG_DAYS + 1} d`),
  )
  return chips
}
