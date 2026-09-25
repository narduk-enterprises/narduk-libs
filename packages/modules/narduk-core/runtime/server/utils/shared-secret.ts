import { createError, getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeString } from './runtime-env'

import type { H3Event } from 'h3'

/**
 * A static shared secret on an inbound request: a cron or scheduler secret,
 * an ingest token, a diagnostics key (narduk-libs#979). Import from
 * `@narduk-enterprises/narduk-core/server/utils/shared-secret`.
 */

const encoder = new TextEncoder()

/**
 * Compare two strings in time that depends only on the longer one's length,
 * so a rejected guess does not reveal how many leading bytes matched. `!==`
 * exits at the first differing character (narduk-libs#871).
 */
export function timingSafeEqualText(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return difference === 0
}

export interface SharedSecretOptions {
  /** The runtimeConfig fallback, e.g. `useRuntimeConfig(event).recapIngestToken`. */
  fallback?: unknown
  /**
   * The request header holding the secret. The default, `authorization`,
   * strips a case-insensitive `Bearer` scheme; any other header is read raw.
   */
  header?: string
  /** Message when the presented value does not match; default `'Unauthorized.'`. */
  rejectMessage?: string
  /** Status when the presented value does not match; default 401. */
  rejectStatus?: 401 | 403
  /** Runtime key read through `readRuntimeString`, e.g. `'RECAP_INGEST_TOKEN'`. */
  secretKey: string
  /** Status when the secret is unset outside dev; default 500. */
  unsetStatus?: 500 | 503
}

function readConfiguredSecret(event: H3Event, options: SharedSecretOptions): string {
  return readRuntimeString(event, options.secretKey, {
    config: useRuntimeConfig(event),
    fallback: options.fallback,
  })
}

function readPresentedSecret(event: H3Event, header: string): string {
  const value = getHeader(event, header)?.trim() ?? ''
  return header.toLowerCase() === 'authorization' ? value.replace(/^Bearer\s+/i, '').trim() : value
}

/**
 * Whether the request presents the configured secret. Never throws, and is
 * `false` whenever the secret is unset, dev included, so a "session OR
 * token" guard falls through to its session check:
 * `hasSharedSecret(event, options) || (await requireAdmin(event))`.
 */
export function hasSharedSecret(event: H3Event, options: SharedSecretOptions): boolean {
  const secret = readConfiguredSecret(event, options)
  if (!secret) return false
  return timingSafeEqualText(readPresentedSecret(event, options.header ?? 'authorization'), secret)
}

/**
 * Require the configured secret on the request, compared in constant time.
 * An unset secret passes in dev and fails closed everywhere else.
 */
export function requireSharedSecret(event: H3Event, options: SharedSecretOptions): void {
  const secret = readConfiguredSecret(event, options)
  if (!secret) {
    if (import.meta.dev) return

    throw createError({
      statusCode: options.unsetStatus ?? 500,
      message: `${options.secretKey} is not configured.`,
    })
  }

  const presented = readPresentedSecret(event, options.header ?? 'authorization')
  if (!timingSafeEqualText(presented, secret)) {
    throw createError({
      statusCode: options.rejectStatus ?? 401,
      message: options.rejectMessage ?? 'Unauthorized.',
    })
  }
}
