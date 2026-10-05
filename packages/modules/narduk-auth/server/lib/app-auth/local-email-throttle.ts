import { and, eq, lt, sql } from 'drizzle-orm'
import { createError, getHeader, setResponseHeader } from 'h3'

import { executeDatabaseQuery, getDatabaseRow } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { authLocalEmailAttempts } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'

import {
  hashLocalEmailValue,
  isMissingLocalEmailAttemptsTableError,
  localEmailLockSeconds,
} from './local-email-core'

import type { H3Event } from 'h3'

const ATTEMPT_WINDOW_SECONDS = 15 * 60

type LocalEmailAttemptKind = 'complete' | 'login' | 'request'
type LocalEmailAttempt = typeof authLocalEmailAttempts.$inferSelect

function getClientIp(event: H3Event): string {
  const cloudflareIp = getHeader(event, 'cf-connecting-ip')?.trim()
  if (cloudflareIp) return cloudflareIp
  return getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
}

async function attemptKey(
  event: H3Event,
  kind: LocalEmailAttemptKind,
  principal: string,
): Promise<string> {
  return hashLocalEmailValue(`${kind}\0${principal}\0${getClientIp(event)}`)
}

function rethrowThrottleError(error: unknown): never {
  if (isMissingLocalEmailAttemptsTableError(error)) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'The auth_local_email_attempts table is missing. Apply drizzle/0002_local_email_auth.sql (required since narduk-auth 1.20.0).',
    })
  }
  throw error
}

/*
 * Throttle records name the attempt kind and counts only. The principal (an
 * email address or a link token hash) and the client IP stay out of the logs;
 * the key hash is per-IP, so it is not logged either.
 */
function throttleLog(event: H3Event) {
  return useLogger(event).child('AppAuth')
}

function throwLocked(
  event: H3Event,
  kind: LocalEmailAttemptKind,
  lockedUntil: number,
  now: number,
): never {
  const retryAfter = Math.max(1, lockedUntil - now)
  throttleLog(event).warn('Local auth attempt refused while locked out', {
    kind,
    retryAfterSeconds: retryAfter,
  })
  setResponseHeader(event, 'Retry-After', retryAfter)
  throw createError({
    statusCode: 429,
    statusMessage: 'Too many authentication attempts. Try again later.',
  })
}

export async function assertLocalEmailAttemptAllowed(
  event: H3Event,
  kind: LocalEmailAttemptKind,
  principal: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const keyHash = await attemptKey(event, kind, principal)
  const appDb = useAuthBridgeDatabase(event)
  const attempt = await getDatabaseRow<LocalEmailAttempt>(
    appDb.select().from(authLocalEmailAttempts).where(eq(authLocalEmailAttempts.keyHash, keyHash)),
  ).catch(rethrowThrottleError)

  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    throwLocked(event, kind, attempt.lockedUntil, now)
  }

  if (attempt && attempt.windowStartedAt < now - ATTEMPT_WINDOW_SECONDS) {
    await executeDatabaseQuery(
      appDb
        .delete(authLocalEmailAttempts)
        .where(
          and(
            eq(authLocalEmailAttempts.keyHash, keyHash),
            lt(authLocalEmailAttempts.windowStartedAt, now - ATTEMPT_WINDOW_SECONDS),
          ),
        ),
    ).catch(rethrowThrottleError)
  }
}

export async function recordLocalEmailAttemptFailure(
  event: H3Event,
  kind: LocalEmailAttemptKind,
  principal: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - ATTEMPT_WINDOW_SECONDS
  const keyHash = await attemptKey(event, kind, principal)
  const appDb = useAuthBridgeDatabase(event)
  const updatedAt = new Date().toISOString()
  const attempt = await getDatabaseRow<LocalEmailAttempt>(
    appDb
      .insert(authLocalEmailAttempts)
      .values({
        keyHash,
        failures: 1,
        windowStartedAt: now,
        lockedUntil: null,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: authLocalEmailAttempts.keyHash,
        set: {
          failures: sql<number>`CASE WHEN ${authLocalEmailAttempts.windowStartedAt} < ${cutoff} THEN 1 ELSE ${authLocalEmailAttempts.failures} + 1 END`,
          windowStartedAt: sql<number>`CASE WHEN ${authLocalEmailAttempts.windowStartedAt} < ${cutoff} THEN ${now} ELSE ${authLocalEmailAttempts.windowStartedAt} END`,
          lockedUntil: sql<
            number | null
          >`CASE WHEN ${authLocalEmailAttempts.windowStartedAt} < ${cutoff} THEN NULL ELSE ${authLocalEmailAttempts.lockedUntil} END`,
          updatedAt,
        },
      })
      .returning(),
  ).catch(rethrowThrottleError)

  if (!attempt) return
  const lockSeconds = localEmailLockSeconds(attempt.failures)
  const log = throttleLog(event)
  log.info('Local auth attempt failed', { kind, failures: attempt.failures })
  if (!lockSeconds) return

  log.warn('Local auth lockout started', { kind, failures: attempt.failures, lockSeconds })

  const lockedUntil = now + lockSeconds
  await executeDatabaseQuery(
    appDb
      .update(authLocalEmailAttempts)
      .set({
        lockedUntil: sql<number>`CASE WHEN ${authLocalEmailAttempts.lockedUntil} IS NULL OR ${authLocalEmailAttempts.lockedUntil} < ${lockedUntil} THEN ${lockedUntil} ELSE ${authLocalEmailAttempts.lockedUntil} END`,
        updatedAt,
      })
      .where(eq(authLocalEmailAttempts.keyHash, keyHash)),
  ).catch(rethrowThrottleError)
}

export async function clearLocalEmailAttempts(
  event: H3Event,
  kind: LocalEmailAttemptKind,
  principal: string,
): Promise<void> {
  const keyHash = await attemptKey(event, kind, principal)
  const appDb = useAuthBridgeDatabase(event)
  await executeDatabaseQuery(
    appDb.delete(authLocalEmailAttempts).where(eq(authLocalEmailAttempts.keyHash, keyHash)),
  ).catch(rethrowThrottleError)
}
