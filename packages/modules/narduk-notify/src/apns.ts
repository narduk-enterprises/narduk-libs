import { createApnsTokenProvider } from './apns-token.js'
import { NotifyError } from './errors.js'

import type { ApnsCredentials, ApnsTokenProvider, ApnsTokenProviderOptions } from './apns-token.js'

export type ApnsEnvironment = 'development' | 'production'
export type ApnsPushType = 'alert' | 'background' | 'liveactivity'
export type ApnsPriority = 1 | 5 | 10

export const APNS_ORIGINS: Readonly<Record<ApnsEnvironment, string>> = {
  development: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

/** Apple's limit for alert, background and Live Activity payloads. */
export const APNS_MAX_PAYLOAD_BYTES = 4096

export interface ApnsAlertContent {
  body: string
  subtitle?: string
  title: string
}

export interface ApnsAlertNotification {
  alert: ApnsAlertContent
  badge?: number
  category?: string
  /** App-defined keys placed beside `aps`. */
  data?: Record<string, unknown>
  interruptionLevel?: 'active' | 'critical' | 'passive' | 'time-sensitive'
  pushType: 'alert'
  relevanceScore?: number
  sound?: string
  threadId?: string
}

export interface ApnsBackgroundNotification {
  data: Record<string, unknown>
  pushType: 'background'
}

export interface ApnsLiveActivityNotification {
  /** Optional alert shown with the update, e.g. when an alarm fires. */
  alert?: ApnsAlertContent & { sound?: string }
  /** Required with `event: 'start'` (push-to-start). */
  attributes?: Record<string, unknown>
  /** Required with `event: 'start'`: the Swift `ActivityAttributes` type name. */
  attributesType?: string
  /** The activity's `ContentState`; required for `start` and `update`. */
  contentState?: Record<string, unknown>
  /** Seconds since the epoch. */
  dismissalDate?: number
  event: 'end' | 'start' | 'update'
  pushType: 'liveactivity'
  relevanceScore?: number
  /** Seconds since the epoch. */
  staleDate?: number
  /** Seconds since the epoch; defaults to the send time. APNs drops older updates. */
  timestamp?: number
}

export type ApnsNotification =
  ApnsAlertNotification | ApnsBackgroundNotification | ApnsLiveActivityNotification

export interface ApnsRequestOptions {
  /** A UUID APNs echoes back; generated when absent. */
  apnsId?: string
  /** The app's bundle id. Live Activity pushes add `.push-type.liveactivity` to it. */
  bundleId: string
  /** At most 64 bytes. */
  collapseId?: string
  /** A device token for alert and background pushes, an activity push token for Live Activities. */
  deviceToken: string
  environment: ApnsEnvironment
  /** Seconds since the epoch after which APNs stops retrying; 0 means try once. */
  expiration?: number
  /** Overrides Apple's host for `environment`; for a local fixture or an egress proxy. */
  origin?: string
  /** Defaults: 10 for an alert or an alerting Live Activity, 5 otherwise. */
  priority?: ApnsPriority
}

/** A transport-neutral HTTP/2 request. Header names are lowercase. */
export interface ApnsRequest {
  body: string
  headers: Record<string, string>
  method: 'POST'
  url: string
}

export interface ApnsTransportResponse {
  body: string
  /** Lowercase header names. */
  headers: Record<string, string>
  status: number
}

/**
 * Sends one request. APNs accepts HTTP/2 only. Node's global `fetch` does not
 * negotiate HTTP/2 by default, so in Node use `createNodeHttp2Transport` from
 * `./node`. Whether a Cloudflare Worker's `fetch` reaches APNs over HTTP/2 is
 * not yet measured (README, "Open items").
 */
export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsTransportResponse>

export interface ApnsSendResult {
  apnsId: string | null
  ok: boolean
  /** APNs' `reason`, or `TransportError` when the request never got an answer. */
  reason: string | null
  retryable: boolean
  status: number
  /** True when the token will never work again: drop it. */
  tokenInvalid: boolean
}

const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/iu
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'])

function invalid(message: string): NotifyError {
  return new NotifyError('invalid_notification', message)
}

function apsAlert(alert: ApnsAlertContent): Record<string, string> {
  if (!alert.title.trim() || !alert.body.trim()) throw invalid('alert title and body are required')
  return {
    title: alert.title,
    ...(alert.subtitle === undefined ? {} : { subtitle: alert.subtitle }),
    body: alert.body,
  }
}

function payloadFor(notification: ApnsNotification, nowSeconds: number): Record<string, unknown> {
  switch (notification.pushType) {
    case 'alert': {
      const aps: Record<string, unknown> = { alert: apsAlert(notification.alert) }
      if (notification.sound !== undefined) aps.sound = notification.sound
      if (notification.badge !== undefined) aps.badge = notification.badge
      if (notification.threadId !== undefined) aps['thread-id'] = notification.threadId
      if (notification.category !== undefined) aps.category = notification.category
      if (notification.interruptionLevel !== undefined) {
        aps['interruption-level'] = notification.interruptionLevel
      }
      if (notification.relevanceScore !== undefined) {
        aps['relevance-score'] = notification.relevanceScore
      }
      return { ...notification.data, aps }
    }
    case 'background':
      return { ...notification.data, aps: { 'content-available': 1 } }
    case 'liveactivity': {
      const aps: Record<string, unknown> = {
        timestamp: notification.timestamp ?? nowSeconds,
        event: notification.event,
      }
      if (notification.event !== 'end' && !notification.contentState) {
        throw invalid(`a Live Activity ${notification.event} needs contentState`)
      }
      if (notification.contentState) aps['content-state'] = notification.contentState
      if (notification.event === 'start') {
        if (!notification.attributesType?.trim() || !notification.attributes) {
          throw invalid('a Live Activity start needs attributesType and attributes')
        }
        aps['attributes-type'] = notification.attributesType
        aps.attributes = notification.attributes
      }
      if (notification.staleDate !== undefined) aps['stale-date'] = notification.staleDate
      if (notification.dismissalDate !== undefined) {
        aps['dismissal-date'] = notification.dismissalDate
      }
      if (notification.relevanceScore !== undefined) {
        aps['relevance-score'] = notification.relevanceScore
      }
      if (notification.alert) {
        const { sound, ...content } = notification.alert
        aps.alert = { ...apsAlert(content), ...(sound === undefined ? {} : { sound }) }
      }
      return { aps }
    }
  }
}

function defaultPriority(notification: ApnsNotification): ApnsPriority {
  if (notification.pushType === 'alert') return 10
  if (notification.pushType === 'liveactivity' && notification.alert) return 10
  return 5
}

/**
 * Build the exact HTTP/2 request APNs expects, without sending it. Pure apart
 * from the generated `apns-id`, so a fixture can assert every header and byte.
 */
export function buildApnsRequest(
  notification: ApnsNotification,
  options: ApnsRequestOptions,
  providerToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): ApnsRequest {
  const deviceToken = options.deviceToken.trim()
  if (!DEVICE_TOKEN.test(deviceToken)) {
    throw new NotifyError('invalid_device_token', 'APNs device token must be 64 to 200 hex digits')
  }
  const bundleId = options.bundleId.trim()
  if (!bundleId) throw invalid('bundleId is required')
  const apnsId = options.apnsId ?? crypto.randomUUID()
  if (!UUID.test(apnsId)) throw invalid('apnsId must be a UUID')

  const priority = options.priority ?? defaultPriority(notification)
  if (notification.pushType === 'background' && priority !== 5) {
    throw invalid('background pushes must use priority 5')
  }
  if (notification.pushType === 'liveactivity' && priority === 1) {
    throw invalid('Live Activity pushes use priority 5 or 10')
  }

  const body = JSON.stringify(payloadFor(notification, nowSeconds))
  const bytes = new TextEncoder().encode(body).byteLength
  if (bytes > APNS_MAX_PAYLOAD_BYTES) {
    throw new NotifyError(
      'payload_too_large',
      `APNs payload is ${bytes} bytes; the limit is ${APNS_MAX_PAYLOAD_BYTES}`,
    )
  }

  const headers: Record<string, string> = {
    authorization: `bearer ${providerToken}`,
    'apns-id': apnsId,
    'apns-push-type': notification.pushType,
    'apns-topic':
      notification.pushType === 'liveactivity' ? `${bundleId}.push-type.liveactivity` : bundleId,
    'apns-priority': String(priority),
    'content-type': 'application/json',
  }
  if (options.expiration !== undefined) headers['apns-expiration'] = String(options.expiration)
  if (options.collapseId !== undefined) {
    if (new TextEncoder().encode(options.collapseId).byteLength > 64) {
      throw invalid('collapseId must be at most 64 bytes')
    }
    headers['apns-collapse-id'] = options.collapseId
  }

  return {
    method: 'POST',
    url: `${options.origin ?? APNS_ORIGINS[options.environment]}/3/device/${deviceToken.toLowerCase()}`,
    headers,
    body,
  }
}

/** A transport over a `fetch` that negotiates HTTP/2 with APNs. */
export function createFetchApnsTransport(fetcher: typeof fetch = globalThis.fetch): ApnsTransport {
  return async (request) => {
    const response = await fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(10_000),
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value
    })
    return { status: response.status, headers, body: await response.text() }
  }
}

function reasonOf(body: string): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as { reason?: unknown }
    return typeof parsed.reason === 'string' ? parsed.reason : null
  } catch {
    return null
  }
}

export interface ApnsClientOptions extends ApnsTokenProviderOptions {
  bundleId: string
  credentials: ApnsCredentials
  /** Default environment; a send may override it (TestFlight tokens are production). */
  environment: ApnsEnvironment
  /** See `ApnsRequestOptions.origin`. */
  origin?: string
  transport: ApnsTransport
}

export type ApnsSendOptions = Omit<ApnsRequestOptions, 'bundleId' | 'environment' | 'origin'> & {
  environment?: ApnsEnvironment
}

export interface ApnsClient {
  readonly bundleId: string
  readonly environment: ApnsEnvironment
  send: (notification: ApnsNotification, options: ApnsSendOptions) => Promise<ApnsSendResult>
  readonly tokens: ApnsTokenProvider
}

export function createApnsClient(options: ApnsClientOptions): ApnsClient {
  const tokens = createApnsTokenProvider(options.credentials, options)
  const now = options.now ?? Date.now

  const attempt = async (
    notification: ApnsNotification,
    sendOptions: ApnsSendOptions,
  ): Promise<ApnsSendResult> => {
    const request = buildApnsRequest(
      notification,
      {
        ...sendOptions,
        bundleId: options.bundleId,
        environment: sendOptions.environment ?? options.environment,
        ...(options.origin === undefined ? {} : { origin: options.origin }),
      },
      await tokens.token(),
      Math.floor(now() / 1000),
    )
    let response: ApnsTransportResponse
    try {
      response = await options.transport(request)
    } catch {
      return {
        ok: false,
        status: 0,
        apnsId: request.headers['apns-id'] ?? null,
        reason: 'TransportError',
        retryable: true,
        tokenInvalid: false,
      }
    }
    const reason = response.status === 200 ? null : reasonOf(response.body)
    return {
      ok: response.status === 200,
      status: response.status,
      apnsId: response.headers['apns-id'] ?? request.headers['apns-id'] ?? null,
      reason,
      retryable: response.status === 429 || response.status >= 500,
      tokenInvalid:
        response.status === 410 || (reason !== null && INVALID_TOKEN_REASONS.has(reason)),
    }
  }

  return {
    bundleId: options.bundleId,
    environment: options.environment,
    tokens,
    send: async (notification, sendOptions) => {
      // One apns-id for both attempts, so APNs and the audit see one notification.
      const pinned = { ...sendOptions, apnsId: sendOptions.apnsId ?? crypto.randomUUID() }
      const first = await attempt(notification, pinned)
      if (first.reason !== 'ExpiredProviderToken') return first
      tokens.invalidate()
      return attempt(notification, pinned)
    },
  }
}
