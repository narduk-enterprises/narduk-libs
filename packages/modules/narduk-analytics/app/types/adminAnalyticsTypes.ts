/** Response shapes of the admin Analytics page's own reads (`/api/admin/posthog/*`). */

export const ADMIN_ANALYTICS_PAGE_PATH = '/admin/analytics' as const

export const adminAnalyticsApi = {
  overview: '/api/admin/posthog/overview',
  health: '/api/admin/posthog/health',
  origins: '/api/admin/posthog/origins',
  pages: '/api/admin/posthog/pages',
  devices: '/api/admin/posthog/devices',
  entryExit: '/api/admin/posthog/entry-exit',
  ga: '/api/admin/ga/overview',
  gsc: '/api/admin/gsc/performance',
} as const

export interface AdminAnalyticsTotals {
  pageviews: number
  sessions: number
  /** Distinct people over the whole range. Never the sum of the per-bucket people. */
  visitors: number
}

export interface AdminAnalyticsPoint extends AdminAnalyticsTotals {
  endMs: number
  /** Day buckets: the local `YYYY-MM-DD`; finer buckets: epoch seconds. */
  key: string
  startMs: number
}

interface Stamped {
  cached: boolean
  fetchedAt: string
}

export interface AdminAnalyticsWindow {
  from: string
  label: string
  to: string
  tz: string
}

export interface AdminAnalyticsOverview extends Stamped {
  bucket: '1d' | '1h' | '5m' | '15m'
  classes: Array<{ class: string; events: number }>
  period: string
  previous: AdminAnalyticsTotals
  series: AdminAnalyticsPoint[]
  totals: AdminAnalyticsTotals
  traffic: string
  window: AdminAnalyticsWindow
}

export type AdminAnalyticsHealthState = 'drop' | 'quiet' | 'silent' | 'tracking'

export interface AdminAnalyticsHealth extends Stamped {
  baselinePerDay: number
  events28d: number
  lastEventAt: string | null
  markedShare: number | null
  reason: string
  recentPerDay: number
  state: AdminAnalyticsHealthState
  title: string
}

export type AdminAnalyticsOriginDimension =
  'campaigns' | 'channels' | 'countries' | 'landing' | 'referrers'

export interface AdminAnalyticsOriginRow {
  group?: string
  label: string
  other?: boolean
  sessions: number
  unknown?: boolean
}

export interface AdminAnalyticsOrigins extends Stamped {
  dimension: AdminAnalyticsOriginDimension
  period: string
  rows: AdminAnalyticsOriginRow[]
  sessionsWithoutValue: number
  traffic: string
  truncated: boolean
}

export interface AdminAnalyticsPages extends Stamped {
  period: string
  rows: Array<{ page: string; pageviews: number; uniqueVisitors: number }>
  traffic: string
}

export interface AdminAnalyticsDevices extends Stamped {
  period: string
  rows: Array<{ device: string; pageviews: number; uniqueVisitors: number; unknown?: boolean }>
  traffic: string
}

export interface AdminAnalyticsEntryExit extends Stamped {
  entryPages: Array<{ count: number; page: string }>
  exitPages: Array<{ count: number; page: string }>
  period: string
  traffic: string
}

export interface AdminAnalyticsGa extends Stamped {
  endDate: string
  rows: Array<{
    dimensionValues?: Array<{ value: string }>
    metricValues?: Array<{ value: string }>
  }>
  startDate: string
  /** activeUsers, sessions, screenPageViews, bounceRate, averageSessionDuration */
  totals: Array<{ value: string }>
}

export interface AdminAnalyticsGscRow {
  clicks: number
  ctr: number
  impressions: number
  keys: string[]
  position: number
}

export interface AdminAnalyticsGsc extends Stamped {
  dimension: string
  endDate: string
  rows: AdminAnalyticsGscRow[]
  startDate: string
}
