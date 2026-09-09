import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'

import { authVerifiedEmails } from '../database/native-auth-schema'

import { useAuthBridgeDatabase } from './auth-bridge-database'

import type { H3Event } from 'h3'

/** Opt in only after applying 0004_native_auth.sql; old consumers need no new tables. */
export async function getLocalEmailVerification(
  event: H3Event,
  userId: string,
  email: string,
): Promise<string | null> {
  if (!useRuntimeConfig(event).authLocalEmailVerification) return null
  const [proof] = await useAuthBridgeDatabase(event)
    .select()
    .from(authVerifiedEmails)
    .where(
      and(
        eq(authVerifiedEmails.userId, userId),
        eq(authVerifiedEmails.email, email.trim().toLowerCase()),
      ),
    )
    .limit(1)
  return proof?.verifiedAt ?? null
}

/** Call only after successfully redeeming an emailed credential, never on password login. */
export async function recordLocalEmailVerification(
  event: H3Event,
  userId: string,
  email: string,
  verifiedAt: string,
): Promise<void> {
  if (!useRuntimeConfig(event).authLocalEmailVerification) return
  const values = { userId, email: email.trim().toLowerCase(), verifiedAt }
  await useAuthBridgeDatabase(event)
    .insert(authVerifiedEmails)
    .values(values)
    .onConflictDoUpdate({ target: authVerifiedEmails.userId, set: values })
}
