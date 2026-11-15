import { createError, getHeader, getRequestURL, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'

import { createNativeAuth } from '../lib/app-auth/native-core'

import { useAuthBridgeDatabase } from './auth-bridge-database'

import type { H3Event } from 'h3'

export function nativeAuthClients(event: H3Event) {
  const config = useRuntimeConfig(event)
  const clients = config.authNativeClients
  if (!Array.isArray(clients) || clients.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Native sign-in is not enabled.' })
  }
  if (config.authBackend !== 'local') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Native sessions currently require local authentication.',
    })
  }
  const parsed = z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        redirectUris: z.array(z.string().url()).min(1),
      }),
    )
    .safeParse(clients)
  if (!parsed.success) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Native sign-in is not configured correctly.',
    })
  }
  return parsed.data
}

export function useNativeAuth(event: H3Event) {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  return createNativeAuth(useAuthBridgeDatabase(event), nativeAuthClients(event))
}

/**
 * The native service for a direct sign-in (passkey or Apple), refusing an
 * unconfigured client before the caller's credential is checked, so a bad
 * `clientId` never consumes a challenge or creates an account.
 */
export function useNativeAuthForClient(event: H3Event, clientId: string) {
  if (!nativeAuthClients(event).some((client) => client.id === clientId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid native sign-in request.' })
  }
  return useNativeAuth(event)
}

/** Native credentials do not become browser cookies or bypass app authorization. */
export async function getNativeAuthSession(event: H3Event) {
  const header = getHeader(event, 'authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (!/^[\w-]{43}$/.test(token)) return null
  return useNativeAuth(event).resolve(token)
}

/** Code minting requires a same-origin browser POST in addition to a signed-in user. */
export function requireNativeAuthorizationOrigin(event: H3Event): void {
  const expected = new URL(String(useRuntimeConfig(event).public.appUrl)).origin
  const origin = getHeader(event, 'origin')
  if (origin !== expected || getRequestURL(event).origin !== expected) {
    throw createError({ statusCode: 403, statusMessage: 'Native sign-in must start in this app.' })
  }
}
