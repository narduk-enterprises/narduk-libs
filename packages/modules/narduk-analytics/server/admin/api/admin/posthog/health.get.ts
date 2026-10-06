import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'

import { classifyTrackingHealth } from '#narduk-analytics-server/utils/analyticsHealth'
import {
  buildPosthogCurrentUrlClause,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import {
  posthogNumber,
  posthogRows,
  posthogUpstreamError,
  TRAFFIC_CLASS_EXPR,
} from '#narduk-analytics-server/utils/posthogQuery'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

import type { AnalyticsHealth } from '#narduk-analytics-server/utils/analyticsHealth'

interface PosthogHealthResponse extends AnalyticsHealth {
  cached: boolean
  fetchedAt: string
}

const HEALTH_TTL_MS = 60_000

/**
 * Is this app's own event stream alive? Always the trailing 28 days, every
 * traffic class, so a filter on the page cannot hide a dead tracker.
 */
export default defineEventHandler(async (event): Promise<PosthogHealthResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const noCache = !['', 'false', '0'].includes(String(getQuery(event).noCache ?? '').toLowerCase())
  const cacheKey = `posthog:health:${project.projectId}:${project.domain}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<AnalyticsHealth>(
      cacheKey,
      async (): Promise<AnalyticsHealth> => {
        const nowMs = Date.now()
        const rows = await posthogRows(
          project,
          `
            SELECT
              count() AS events_28d,
              countIf(timestamp >= now() - toIntervalDay(7)) AS events_7d,
              toUnixTimestamp(max(timestamp)) AS last_event,
              countIf(${TRAFFIC_CLASS_EXPR} != 'unmarked') AS marked_28d
            FROM events
            WHERE event = '$pageview'
              AND timestamp >= now() - toIntervalDay(28)
              ${buildPosthogCurrentUrlClause(project.domain)}
          `,
        )
        const row = rows[0]
        const events28d = posthogNumber(row?.[0])
        const lastSeconds = posthogNumber(row?.[2])
        return classifyTrackingHealth({
          events28d,
          events7d: posthogNumber(row?.[1]),
          lastEventMs: events28d > 0 && lastSeconds > 0 ? lastSeconds * 1000 : null,
          markedEvents28d: posthogNumber(row?.[3]),
          nowMs,
        })
      },
      noCache ? 0 : HEALTH_TTL_MS,
    )

    return { ...data, cached, fetchedAt }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
