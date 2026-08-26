import { and, eq, lt, sql } from 'drizzle-orm'
import { createError, getHeader, setResponseHeader } from 'h3'

import { executeDatabaseQuery, getDatabaseRow } from '#layer/server/utils/database'
import { authLocalEmailAttempts } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'

import { hashLocalEmailValue, localEmailLockSeconds } from './local-email-core'

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

function throwLocked(event: H3Event, lockedUntil: number, now: number): never {
  const retryAfter = Math.max(1, lockedUntil - now)
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
  )

  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    throwLocked(event, attempt.lockedUntil, now)
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
    )
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
  )

  if (!attempt) return
  const lockSeconds = localEmailLockSeconds(attempt.failures)
  if (!lockSeconds) return

  const lockedUntil = now + lockSeconds
  await executeDatabaseQuery(
    appDb
      .update(authLocalEmailAttempts)
      .set({
        lockedUntil: sql<number>`CASE WHEN ${authLocalEmailAttempts.lockedUntil} IS NULL OR ${authLocalEmailAttempts.lockedUntil} < ${lockedUntil} THEN ${lockedUntil} ELSE ${authLocalEmailAttempts.lockedUntil} END`,
        updatedAt,
      })
      .where(eq(authLocalEmailAttempts.keyHash, keyHash)),
  )
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
  )
}
