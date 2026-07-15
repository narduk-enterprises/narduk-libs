import { readAppRequestHeader } from '@narduk-enterprises/narduk-app/server/http'

import type { User as LocalUser } from '#narduk-core/schema'
import type { AppAuthProvider, AppSessionUser } from './types'
import type { User as SupabaseUser } from '@supabase/auth-js'
import type { H3Event } from 'h3'

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function deriveDisplayName(email: string) {
  const localPart = email.split('@')[0] ?? 'User'
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

export function normalizeAuthUrl(value: string) {
  if (!value) return ''
  return value.endsWith('/auth/v1') ? value : `${value.replace(/\/$/, '')}/auth/v1`
}

export function isAuthProvider(value: string): value is AppAuthProvider {
  return value === 'apple' || value === 'email'
}

export function getSessionCookieSecure(event: H3Event) {
  const host = readAppRequestHeader(event, 'host') ?? ''
  return !(host.startsWith('localhost') || host.startsWith('127.0.0.1'))
}

export function encodeQrCodeDataUrl(svg: string) {
  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`
}

export function decodeAccessTokenPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) return {}

  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    const json = atob(`${normalized}${padding}`)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function sanitizeNextPath(value: string | null | undefined, fallback: string) {
  if (!value) return fallback

  try {
    const url = new URL(value, 'https://app.local')
    if (url.origin !== 'https://app.local' || !url.pathname.startsWith('/')) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function buildAppUrl(
  baseUrl: string,
  path: string,
  search?: Record<string, string | null | undefined>,
) {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

export function toSessionUser(
  user: LocalUser,
  extras: Partial<AppSessionUser> = {},
): AppSessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    ...extras,
  }
}

export function extractProviderMetadata(user: SupabaseUser) {
  const appMetadata = (typeof user.app_metadata === 'object' ? user.app_metadata : {}) as Record<
    string,
    unknown
  >
  const userMetadata = (typeof user.user_metadata === 'object' ? user.user_metadata : {}) as Record<
    string,
    unknown
  >
  const providers = Array.isArray(appMetadata.providers)
    ? appMetadata.providers.filter((provider): provider is string => typeof provider === 'string')
    : typeof appMetadata.provider === 'string'
      ? [appMetadata.provider]
      : []
  const primaryProvider =
    typeof appMetadata.provider === 'string' ? appMetadata.provider : (providers[0] ?? null)
  const displayName =
    (typeof userMetadata.name === 'string' && userMetadata.name.trim()) ||
    (typeof userMetadata.full_name === 'string' && userMetadata.full_name.trim()) ||
    (typeof userMetadata.display_name === 'string' && userMetadata.display_name.trim()) ||
    null

  const appleIdentity = Array.isArray(user.identities)
    ? user.identities.find((identity) => identity.provider === 'apple')
    : null
  const appleId =
    appleIdentity?.identity_data &&
    typeof appleIdentity.identity_data === 'object' &&
    typeof (appleIdentity.identity_data as Record<string, unknown>).sub === 'string'
      ? ((appleIdentity.identity_data as Record<string, unknown>).sub as string)
      : null

  return {
    providers,
    primaryProvider,
    displayName,
    appleId,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    needsPasswordSetup: !providers.includes('email'),
  }
}
