import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'

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
  readAnalyticsQuery,
} from '#narduk-analytics-server/utils/posthogQuery'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

interface PosthogEntryExitPage {
  count: number
  page: string
}

interface PosthogEntryExitPayload {
  entryPages: PosthogEntryExitPage[]
  exitPages: PosthogEntryExitPage[]
}

interface PosthogEntryExitResponse extends PosthogEntryExitPayload {
  cached: boolean
  fetchedAt: string
  period: string
  traffic: string
}

/**
 * A session's first and last pageview, by timestamp. This replaces the old
 * `$is_initial_landing` and `$pageleave` counts, which miss sessions that
 * never fire either (a closed tab, a blocked unload beacon).
 */
const sessionEdges = (where: string) => `
  SELECT
    argMin(replaceRegexpAll(properties.$pathname, '\\\\?.*', ''), timestamp) AS entry_page,
    argMax(replaceRegexpAll(properties.$pathname, '\\\\?.*', ''), timestamp) AS exit_page
  FROM events
  WHERE event = '$pageview'
    AND ${where}
    AND nullIf(toString(properties.$session_id), '') IS NOT NULL
  GROUP BY properties.$session_id
`

export default defineEventHandler(async (event): Promise<PosthogEntryExitResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const { window, traffic, noCache } = await readAnalyticsQuery(event)
  const cacheKey = `posthog:entry-exit:${project.projectId}:${project.domain}:${window.key}:${traffic.key}`
  const where = [
    buildPosthogWindowClause(window),
    buildPosthogCurrentUrlClause(project.domain).replace(/^\s*AND\s+/u, ''),
    buildPosthogTrafficClause(traffic).replace(/^\s*AND\s+/u, ''),
  ]
    .filter(Boolean)
    .join(' AND ')

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogEntryExitPayload>(
      cacheKey,
      async (): Promise<PosthogEntryExitPayload> => {
        const [entryRows, exitRows] = await Promise.all([
          posthogRows(
            project,
            `
              SELECT entry_page AS page, count() AS sessions
              FROM (${sessionEdges(where)})
              GROUP BY page
              ORDER BY sessions DESC
              LIMIT 10
            `,
          ),
          posthogRows(
            project,
            `
              SELECT exit_page AS page, count() AS sessions
              FROM (${sessionEdges(where)})
              GROUP BY page
              ORDER BY sessions DESC
              LIMIT 10
            `,
          ),
        ])

        const toPages = (rows: typeof entryRows): PosthogEntryExitPage[] =>
          rows.map((row) => ({ page: String(row[0] ?? '/') || '/', count: posthogNumber(row[1]) }))

        return { entryPages: toPages(entryRows), exitPages: toPages(exitRows) }
      },
      analyticsCacheTtl(window, noCache),
    )

    return { ...data, cached, fetchedAt, period: window.label, traffic: traffic.key }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
