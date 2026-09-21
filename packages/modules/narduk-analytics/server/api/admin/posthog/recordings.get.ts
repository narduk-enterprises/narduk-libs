import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { z } from 'zod'

import {
  posthogRecordingsFetch,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

interface RawRecording {
  active_seconds?: number
  click_count?: number
  distinct_id?: string
  end_time: string
  id: string
  keypress_count?: number
  person?: { distinct_ids?: string[] }
  recording_duration?: number
  start_time: string
  start_url?: string
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
  noCache: z.coerce.boolean().optional(),
})

interface PosthogRecordingSummary {
  activeSeconds: number
  clickCount: number
  duration: number
  endTime: string
  id: string
  keypressCount: number
  personId: string
  replayUrl: string
  startTime: string
  startUrl: string
}

interface PosthogRecordingsPayload {
  projectReplayUrl: string
  recordings: PosthogRecordingSummary[]
}

interface PosthogRecordingsResponse extends PosthogRecordingsPayload {
  cached: boolean
  fetchedAt: string
  limit: number
}

export default defineEventHandler(async (event): Promise<PosthogRecordingsResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const cacheKey = `posthog:recordings:${project.projectId}:${query.limit}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogRecordingsPayload>(
      cacheKey,
      async (): Promise<PosthogRecordingsPayload> => {
        const response = await posthogRecordingsFetch<{ results?: RawRecording[] }>(project, {
          limit: String(query.limit),
          order: '-start_time',
        })

        return {
          recordings: (response.results ?? []).map((recording) => ({
            id: recording.id,
            startTime: recording.start_time,
            endTime: recording.end_time,
            duration: recording.recording_duration ?? 0,
            activeSeconds: recording.active_seconds ?? 0,
            clickCount: recording.click_count ?? 0,
            keypressCount: recording.keypress_count ?? 0,
            startUrl: recording.start_url ?? '',
            personId: recording.person?.distinct_ids?.[0] ?? recording.distinct_id ?? 'Anonymous',
            replayUrl: `${project.apiHost}/project/${project.projectId}/replay/${recording.id}`,
          })),
          projectReplayUrl: `${project.apiHost}/project/${project.projectId}/replay`,
        }
      },
      query.noCache ? 0 : undefined,
    )

    return {
      ...data,
      cached,
      fetchedAt,
      limit: query.limit,
    }
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    throw createError({
      statusCode: err.status ?? err.statusCode ?? 500,
      statusMessage: `PostHog Error: ${err.message}`,
    })
  }
})
