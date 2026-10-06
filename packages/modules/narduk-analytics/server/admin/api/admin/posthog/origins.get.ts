import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { z } from 'zod'

import {
  ANALYTICS_ORIGIN_DIMENSIONS,
  classifyChannel,
  classifyReferrerGroup,
  normalizeReferrerDomain,
  sumOriginRows,
  truncateOriginGroups,
} from '#narduk-analytics-server/utils/analyticsOrigins'
import { analyticsWindowQuerySchema } from '#narduk-analytics-server/utils/analyticsWindow'
import {
  buildPosthogCurrentUrlClause,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import {
  analyticsCacheTtl,
  buildPosthogTrafficClause,
  buildPosthogWindowClause,
  posthogNumber,
  posthogRows,
  posthogUpstreamError,
  resolveAnalyticsQueryOr400,
} from '#narduk-analytics-server/utils/posthogQuery'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

import type {
  AnalyticsOriginDimension,
  AnalyticsOriginRow,
} from '#narduk-analytics-server/utils/analyticsOrigins'

const querySchema = analyticsWindowQuerySchema.extend({
  dimension: z.enum(ANALYTICS_ORIGIN_DIMENSIONS as [string, ...string[]]).default('channels'),
})

interface PosthogOriginsPayload {
  rows: AnalyticsOriginRow[]
  /** Sessions with no value for this dimension (not in any row). */
  sessionsWithoutValue: number
  /** True when rows were folded into "N more" rows. */
  truncated: boolean
}

interface PosthogOriginsResponse extends PosthogOriginsPayload {
  cached: boolean
  dimension: AnalyticsOriginDimension
  fetchedAt: string
  period: string
  traffic: string
}

const PER_GROUP = 12

const stripAnd = (clause: string) => clause.replace(/^\s*AND\s+/u, '')
const text = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value).trim()

/**
 * Where sessions come from, by their first pageview. Origins are sessions, so
 * the counts can be summed across rows; they are never people.
 */
export default defineEventHandler(async (event): Promise<PosthogOriginsResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const dimension = query.dimension as AnalyticsOriginDimension
  const { window, traffic, noCache } = resolveAnalyticsQueryOr400(query)
  const cacheKey = `posthog:origins:${project.projectId}:${project.domain}:${dimension}:${window.key}:${traffic.key}`
  const where = [
    buildPosthogWindowClause(window),
    stripAnd(buildPosthogCurrentUrlClause(project.domain)),
    stripAnd(buildPosthogTrafficClause(traffic)),
  ]
    .filter(Boolean)
    .join(' AND ')

  const firstPageview = `
    SELECT
      argMin(coalesce(nullIf(toString(properties.$referring_domain), ''), ''), timestamp) AS referrer,
      argMin(coalesce(nullIf(toString(properties.utm_medium), ''), ''), timestamp) AS medium,
      argMin(coalesce(nullIf(toString(properties.utm_campaign), ''), ''), timestamp) AS campaign,
      argMin(replaceRegexpAll(properties.$pathname, '\\\\?.*', ''), timestamp) AS landing,
      argMin(coalesce(nullIf(toString(properties.$geoip_country_code), ''), ''), timestamp) AS country
    FROM events
    WHERE event = '$pageview'
      AND ${where}
      AND nullIf(toString(properties.$session_id), '') IS NOT NULL
    GROUP BY properties.$session_id
  `

  const selectFor: Record<AnalyticsOriginDimension, string> = {
    channels: `SELECT referrer, medium, count() AS sessions FROM (${firstPageview}) GROUP BY referrer, medium ORDER BY sessions DESC LIMIT 500`,
    referrers: `SELECT referrer, count() AS sessions FROM (${firstPageview}) GROUP BY referrer ORDER BY sessions DESC LIMIT 200`,
    campaigns: `SELECT campaign, count() AS sessions FROM (${firstPageview}) GROUP BY campaign ORDER BY sessions DESC LIMIT 200`,
    landing: `SELECT landing, count() AS sessions FROM (${firstPageview}) GROUP BY landing ORDER BY sessions DESC LIMIT 200`,
    countries: `SELECT country, count() AS sessions FROM (${firstPageview}) GROUP BY country ORDER BY sessions DESC LIMIT 200`,
  }

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogOriginsPayload>(
      cacheKey,
      async (): Promise<PosthogOriginsPayload> => {
        const raw = await posthogRows(project, selectFor[dimension])
        let sessionsWithoutValue = 0
        let rows: AnalyticsOriginRow[] = []

        if (dimension === 'channels') {
          rows = raw.map((row) => {
            const channel = classifyChannel(
              normalizeReferrerDomain(text(row[0])),
              text(row[1]),
              project.domain,
            )
            return {
              label: channel,
              sessions: posthogNumber(row[2]),
              ...(channel === 'No referrer (unknown)' ? { unknown: true } : {}),
            }
          })
        } else if (dimension === 'referrers') {
          rows = raw.map((row) => {
            const domain = normalizeReferrerDomain(text(row[0]))
            return {
              group: classifyReferrerGroup(domain, project.domain),
              label: domain || 'No referrer (unknown)',
              sessions: posthogNumber(row[1]),
              ...(domain ? {} : { unknown: true }),
            }
          })
        } else {
          for (const row of raw) {
            const label = text(row[0])
            const sessions = posthogNumber(row[1])
            if (!label) sessionsWithoutValue += sessions
            else rows.push({ label, sessions })
          }
        }

        const { rows: kept, truncated } = truncateOriginGroups(sumOriginRows(rows), PER_GROUP)
        return { rows: kept, sessionsWithoutValue, truncated }
      },
      analyticsCacheTtl(window, noCache),
    )

    return {
      ...data,
      cached,
      dimension,
      fetchedAt,
      period: window.label,
      traffic: traffic.key,
    }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
