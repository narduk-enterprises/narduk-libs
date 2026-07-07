export const adminPosthogPagesApi = '/api/admin/posthog/pages' as const
export const adminPosthogReferrersApi = '/api/admin/posthog/referrers' as const
export const adminPosthogDevicesApi = '/api/admin/posthog/devices' as const
export const adminPosthogEntryExitApi = '/api/admin/posthog/entry-exit' as const
export const adminPosthogInsightsApi = '/api/admin/posthog/insights' as const
export const adminPosthogRecordingsApi = '/api/admin/posthog/recordings' as const

export const defaultPosthogDashboardKeyPrefix = 'layer-admin-posthog'

export interface AdminPosthogTableRow {
  count?: number
  device?: string
  page?: string
  pageviews?: number
  referrer?: string
  uniqueVisitors?: number
  visits?: number
}

export interface AdminPosthogTableListResponse {
  cached: boolean
  fetchedAt: string
  rows: AdminPosthogTableRow[]
}

export interface AdminPosthogEntryExitResponse {
  cached: boolean
  entryPages: Array<{ count: number; page: string }>
  exitPages: Array<{ count: number; page: string }>
  fetchedAt: string
}

export interface AdminPosthogRecordingsResponse {
  cached: boolean
  fetchedAt: string
  limit: number
  projectReplayUrl: string
  recordings: Array<{
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
  }>
}

export interface AdminPosthogInsightsResponse {
  cached: boolean
  dateFrom: string
  dateTo: string
  fetchedAt: string
  results?: unknown[]
}
