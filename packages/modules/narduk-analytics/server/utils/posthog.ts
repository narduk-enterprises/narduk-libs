import {
  hostnameFromUrl,
  readRuntimeString,
} from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { createError } from 'h3'

import { resolvePosthogApiHost, resolvePosthogDomain } from './siteConfig'

import type { AnalyticsServerRuntimeConfig } from './runtimeConfig'
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

export function resolvePosthogProjectConfig(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
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

  const missing = [
    !apiKey ? 'POSTHOG_PERSONAL_API_KEY' : '',
    !projectId ? 'POSTHOG_PROJECT_ID' : '',
  ].filter((name) => name.length > 0)

  if (missing.length > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: `${missing.join(', ')} not configured`,
      data: { state: 'not_configured', missing },
    })
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

/**
 * HogQL boolean: the event's `$current_url` host is the app's host or a
 * subdomain of it, the same test `recordingStartUrlMatchesDomain` applies. A
 * substring match counted any app whose host merely contains this one, and
 * any URL carrying the domain in its path or query (#924). With no domain it
 * is `false`: the shared project would otherwise return every app's data.
 */
export function buildPosthogCurrentUrlHostMatch(domain: string) {
  const host = normalizePosthogDomainHost(domain)
  if (!host) {
    return 'false'
  }

  const literal = escapeHogLiteral(host)
  const eventHost = 'lower(domain(properties.$current_url))'
  return `(${eventHost} = '${literal}' OR endsWith(${eventHost}, '.${literal}'))`
}

export function buildPosthogCurrentUrlClause(domain: string) {
  return `AND ${buildPosthogCurrentUrlHostMatch(domain)}`
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

export function normalizePosthogDomainHost(domain: string): string {
  return hostnameFromUrl(domain).toLowerCase()
}

/**
 * Host match for a recording `start_url` against `POSTHOG_DOMAIN`.
 * Exact hostname or a subdomain of the configured domain. A substring
 * match would let `evil-farm.example` through for `farm.example`.
 */
export function recordingStartUrlMatchesDomain(startUrl: string, domain: string): boolean {
  const expected = normalizePosthogDomainHost(domain)
  const host = hostnameFromUrl(startUrl).toLowerCase()
  if (!expected || !host) return false
  return host === expected || host.endsWith(`.${expected}`)
}

/**
 * Drop recordings whose `start_url` host is another app. Shared PostHog
 * project 325202 lists every estate app unless this filter runs.
 */
export function selectRecordingsForDomain<T extends { start_url?: string }>(
  recordings: readonly T[],
  domain: string,
): T[] {
  return recordings.filter((recording) =>
    recordingStartUrlMatchesDomain(recording.start_url ?? '', domain),
  )
}

export function buildPosthogRecordingsCacheKey(
  projectId: string,
  domain: string,
  limit: number,
): string {
  return `posthog:recordings:${projectId}:${domain}:${limit}`
}

/**
 * List-query params for `/session_recordings/`. `events` asks PostHog for
 * this domain the same way the other admin routes filter `$current_url`.
 * Local `selectRecordingsForDomain` is still the return-path guarantee.
 */
export function buildPosthogRecordingsListParams(
  domain: string,
  limit: number,
): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(limit),
    order: '-start_time',
  }
  const normalized = domain.trim()
  if (!normalized) {
    return params
  }

  params.events = JSON.stringify([
    {
      id: '$pageview',
      type: 'events',
      order: 0,
      name: '$pageview',
      properties: [
        {
          key: '$current_url',
          value: normalized,
          operator: 'icontains',
          type: 'event',
        },
      ],
    },
  ])
  return params
}
