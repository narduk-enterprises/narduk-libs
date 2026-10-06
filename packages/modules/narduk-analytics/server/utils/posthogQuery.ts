/**
 * HogQL fragments and request plumbing shared by the admin PostHog reads that
 * take a window (`period` or `start`/`end`), a display zone (`tz`) and a
 * traffic filter (`traffic`).
 */
import { createError, getValidatedQuery } from 'h3'

import { analyticsWindowQuerySchema, resolveAnalyticsQuery } from './analyticsWindow'
import { AnalyticsWindowError } from './analyticsZone'
import { posthogQueryFetch } from './posthog'

import type { AnalyticsTraffic, AnalyticsWindow, AnalyticsWindowQuery } from './analyticsWindow'
import type { PosthogProjectConfig, PosthogQueryResults, PosthogQueryValue } from './posthog'
import type { H3Event } from 'h3'

/** An event's class. A missing value is unmarked, never "human" and never "owner". */
export const TRAFFIC_CLASS_EXPR =
  "coalesce(nullIf(toString(properties.traffic_class), ''), 'unmarked')"

const hogDateTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

/** `[from, to)` on `timestamp`, as UTC instants. */
export function buildPosthogWindowClause(window: Pick<AnalyticsWindow, 'fromMs' | 'toMs'>) {
  return `timestamp >= toDateTime('${hogDateTime(window.fromMs)}', 'UTC') AND timestamp < toDateTime('${hogDateTime(window.toMs)}', 'UTC')`
}

/**
 * The traffic filter as an `AND ...` clause (empty for `all`). `external`
 * keeps events with no `properties.traffic_class` and the unmarked ones.
 */
export function buildPosthogTrafficClause(traffic: Pick<AnalyticsTraffic, 'classes'>) {
  if (traffic.classes === null) return ''
  const wanted = new Set(traffic.classes)
  if (wanted.has('unmarked')) wanted.add('external')
  const list = [...wanted].map((item) => `'${item}'`).join(', ')
  return `AND ${TRAFFIC_CLASS_EXPR} IN (${list})`
}

/**
 * The bucket an event falls in. Day buckets are the local calendar date in the
 * display zone (a string key); finer buckets are epoch seconds.
 */
export function buildPosthogBucketExpr(
  window: Pick<AnalyticsWindow, 'bucket' | 'bucketMs' | 'tz'>,
) {
  if (window.bucket === '1d') {
    return `formatDateTime(toTimeZone(timestamp, '${window.tz}'), '%Y-%m-%d')`
  }
  const seconds = window.bucketMs / 1000
  return `intDiv(toUnixTimestamp(timestamp), ${seconds}) * ${seconds}`
}

/** Reads and resolves the window and traffic query, answering 400 on a bad one. */
export async function readAnalyticsQuery(event: H3Event, defaultPeriod = '30d') {
  const query = await getValidatedQuery(event, analyticsWindowQuerySchema.parse)
  return resolveAnalyticsQueryOr400(query, defaultPeriod)
}

export function resolveAnalyticsQueryOr400(
  query: AnalyticsWindowQuery,
  defaultPeriod = '30d',
  nowMs: number = Date.now(),
) {
  try {
    return { ...resolveAnalyticsQuery(query, nowMs, defaultPeriod), noCache: query.noCache }
  } catch (error: unknown) {
    if (error instanceof AnalyticsWindowError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
}

/** Short-window reads go stale fast: cache them for a minute, the rest for the default. */
export function analyticsCacheTtl(
  window: Pick<AnalyticsWindow, 'bucket'>,
  noCache: boolean | undefined,
) {
  if (noCache) return 0
  return window.bucket === '1d' ? undefined : 60_000
}

/** Runs a HogQL query and returns its rows. */
export async function posthogRows(
  project: PosthogProjectConfig,
  query: string,
): Promise<PosthogQueryValue[][]> {
  const response = await posthogQueryFetch<PosthogQueryResults>(project, {
    kind: 'HogQLQuery',
    query,
  })
  return response.results ?? []
}

/** PostHog failures keep their upstream status; anything else is a 500. */
export function posthogUpstreamError(error: unknown) {
  const err = error as { message?: string; status?: number; statusCode?: number }
  return createError({
    statusCode: err.status ?? err.statusCode ?? 500,
    statusMessage: `PostHog Error: ${err.message}`,
  })
}

export const posthogNumber = (value: PosthogQueryValue | undefined) => Number(value ?? 0) || 0
