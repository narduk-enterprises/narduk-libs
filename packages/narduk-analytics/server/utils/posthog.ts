import { readRuntimeString } from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { createError } from 'h3'

import { resolvePosthogApiHost, resolvePosthogDomain } from './siteConfig'

import type { H3Event } from 'h3'

export const POSTHOG_DEFAULT_PERIOD = '30d'

export interface PosthogProjectConfig {
  apiHost: string
  apiKey: string
  domain: string
  projectId: string
}

export interface ResolvedPosthogPeriod {
  dateFrom: string
  intervalExpression: string
  unit: 'd' | 'h'
  value: number
}

export type PosthogQueryValue = string | number | null

export interface PosthogQueryResults {
  results?: PosthogQueryValue[][]
}

function normalizeApiHost(value: string) {
  return value.replace(/\/+$/, '')
}

function escapeHogLiteral(value: string) {
  return value.replaceAll("'", "''")
}

export function resolvePosthogProjectConfig(
  config: ReturnType<typeof useRuntimeConfig>,
  event?: H3Event,
) {
  const apiKey = event
    ? readRuntimeString(event, 'POSTHOG_PERSONAL_API_KEY', {
        config,
        fallback: config.posthogApiKey,
      })
    : String(config.posthogApiKey).trim()
  const projectId = event
    ? readRuntimeString(event, 'POSTHOG_PROJECT_ID', {
        config,
        fallback: config.posthogProjectId,
      })
    : String(config.posthogProjectId).trim()
  const apiHost = normalizeApiHost(resolvePosthogApiHost(config, event))
  const domain = resolvePosthogDomain(config, event)

  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'POSTHOG_PERSONAL_API_KEY not configured' })
  }

  if (!projectId) {
    throw createError({ statusCode: 500, statusMessage: 'POSTHOG_PROJECT_ID not configured' })
  }

  return {
    apiHost,
    apiKey,
    domain,
    projectId,
  } satisfies PosthogProjectConfig
}

export function resolvePosthogPeriod(period: string | undefined): ResolvedPosthogPeriod {
  const normalized = (period ?? POSTHOG_DEFAULT_PERIOD).trim().toLowerCase()
  const match = normalized.match(/^(\d+)([dh])$/)
  const value = Number.parseInt(match?.[1] ?? '', 10)
  const unit = match?.[2] === 'h' ? 'h' : 'd'
  const safeValue = Number.isFinite(value) && value > 0 ? value : unit === 'h' ? 24 : 30

  return {
    dateFrom: `-${safeValue}${unit}`,
    intervalExpression:
      unit === 'h' ? `toIntervalHour(${safeValue})` : `toIntervalDay(${safeValue})`,
    value: safeValue,
    unit,
  }
}

export function buildPosthogCurrentUrlClause(domain: string) {
  const normalized = domain.trim()
  if (!normalized) {
    return ''
  }

  return `AND properties.$current_url LIKE '%${escapeHogLiteral(normalized)}%'`
}

export async function posthogQueryFetch<T>(
  config: PosthogProjectConfig,
  query: Record<string, unknown>,
): Promise<T> {
  return (await $fetch<T>(`${config.apiHost}/api/projects/${config.projectId}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: { query },
  })) as T
}

export async function posthogRecordingsFetch<T>(
  config: PosthogProjectConfig,
  params: Record<string, string>,
): Promise<T> {
  return (await $fetch<T>(
    `${config.apiHost}/api/projects/${config.projectId}/session_recordings/`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      params,
    },
  )) as T
}
