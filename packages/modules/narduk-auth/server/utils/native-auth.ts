import { createError, getHeader, getRequestURL, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

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
  return clients
}

export function useNativeAuth(event: H3Event) {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  return createNativeAuth(useAuthBridgeDatabase(event), nativeAuthClients(event))
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
