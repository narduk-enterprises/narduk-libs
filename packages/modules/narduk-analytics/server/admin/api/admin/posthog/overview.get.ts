import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'

import {
  buildPosthogCurrentUrlClause,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import {
  analyticsCacheTtl,
  buildPosthogBucketExpr,
  buildPosthogTrafficClause,
  buildPosthogWindowClause,
  posthogNumber,
  posthogRows,
  posthogUpstreamError,
  readAnalyticsQuery,
  TRAFFIC_CLASS_EXPR,
} from '#narduk-analytics-server/utils/posthogQuery'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

interface OverviewTotals {
  pageviews: number
  sessions: number
  /** Distinct people over the whole window. Not the sum of the per-bucket people. */
  visitors: number
}

interface OverviewPoint extends OverviewTotals {
  endMs: number
  key: string
  startMs: number
}

interface PosthogOverviewPayload {
  /** Events per traffic class in the window, whatever the traffic filter. */
  classes: Array<{ class: string; events: number }>
  previous: OverviewTotals
  series: OverviewPoint[]
  totals: OverviewTotals
}

interface PosthogOverviewResponse extends PosthogOverviewPayload {
  bucket: string
  cached: boolean
  fetchedAt: string
  period: string
  traffic: string
  window: { from: string; label: string; to: string; tz: string }
}

const SESSION_EXPR = "nullIf(toString(properties.$session_id), '')"

const totalsSql = (where: string) => `
  SELECT
    count() AS pageviews,
    count(DISTINCT ${SESSION_EXPR}) AS sessions,
    count(DISTINCT person_id) AS visitors
  FROM events
  WHERE event = '$pageview' AND ${where}
`

const toTotals = (row: Array<string | number | null> | undefined): OverviewTotals => ({
  pageviews: posthogNumber(row?.[0]),
  sessions: posthogNumber(row?.[1]),
  visitors: posthogNumber(row?.[2]),
})

const stripAnd = (clause: string) => clause.replace(/^\s*AND\s+/u, '')

export default defineEventHandler(async (event): Promise<PosthogOverviewResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const { window, traffic, noCache } = await readAnalyticsQuery(event, '7d')
  const cacheKey = `posthog:overview:${project.projectId}:${project.domain}:${window.key}:${traffic.key}`

  const host = stripAnd(buildPosthogCurrentUrlClause(project.domain))
  const trafficClause = stripAnd(buildPosthogTrafficClause(traffic))
  const scope = (windowClause: string, withTraffic = true) =>
    [windowClause, host, withTraffic ? trafficClause : ''].filter(Boolean).join(' AND ')

  const length = window.toMs - window.fromMs
  const previousWindow = { fromMs: window.fromMs - length, toMs: window.fromMs }

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogOverviewPayload>(
      cacheKey,
      async (): Promise<PosthogOverviewPayload> => {
        const current = scope(buildPosthogWindowClause(window))
        const [seriesRows, totalRows, previousRows, classRows] = await Promise.all([
          posthogRows(
            project,
            `
              SELECT
                ${buildPosthogBucketExpr(window)} AS bucket,
                count() AS pageviews,
                count(DISTINCT ${SESSION_EXPR}) AS sessions,
                count(DISTINCT person_id) AS visitors
              FROM events
              WHERE event = '$pageview' AND ${current}
              GROUP BY bucket
              ORDER BY bucket
            `,
          ),
          posthogRows(project, totalsSql(current)),
          posthogRows(project, totalsSql(scope(buildPosthogWindowClause(previousWindow)))),
          posthogRows(
            project,
            `
              SELECT ${TRAFFIC_CLASS_EXPR} AS traffic_class, count() AS events
              FROM events
              WHERE event = '$pageview' AND ${scope(buildPosthogWindowClause(window), false)}
              GROUP BY traffic_class
              ORDER BY events DESC
            `,
          ),
        ])

        const byKey = new Map(seriesRows.map((row) => [String(row[0]), row]))
        return {
          series: window.slots.map((slot) => ({
            key: slot.key,
            startMs: slot.startMs,
            endMs: slot.endMs,
            ...toTotals(byKey.get(slot.key)?.slice(1)),
          })),
          totals: toTotals(totalRows[0]),
          previous: toTotals(previousRows[0]),
          classes: classRows.map((row) => ({
            class: String(row[0] ?? 'unmarked'),
            events: posthogNumber(row[1]),
          })),
        }
      },
      analyticsCacheTtl(window, noCache),
    )

    return {
      ...data,
      bucket: window.bucket,
      cached,
      fetchedAt,
      period: window.label,
      traffic: traffic.key,
      window: { from: window.fromIso, to: window.toIso, tz: window.tz, label: window.label },
    }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
