import { type AuthError, GoTrueClient } from '@supabase/auth-js'
import { createError, deleteCookie, getCookie, setCookie } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { getSessionCookieSecure, isAuthProvider, normalizeAuthUrl } from './helpers'

import type { AuthConfig, CookieLikeStorage } from './types'
import type { H3Event } from 'h3'

const PKCE_COOKIE_NAME = 'app_auth_pkce'

type RuntimeConfigRecord = Record<string, unknown> & {
  public: Record<string, unknown>
}

function getRuntimeConfigRecord(event: H3Event): RuntimeConfigRecord {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const publicConfig =
    config.public && typeof config.public === 'object'
      ? (config.public as Record<string, unknown>)
      : {}

  return {
    ...config,
    public: publicConfig,
  }
}

export function readRuntimeConfigString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function readRuntimeConfigBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readRuntimeConfigStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function getAuthConfig(event: H3Event): AuthConfig {
  const config = getRuntimeConfigRecord(event)
  const authorityUrl = readRuntimeConfigString(config.authAuthorityUrl)

  return {
    backend: config.authBackend === 'supabase' ? 'supabase' : 'local',
    authorityUrl,
    authUrl: normalizeAuthUrl(authorityUrl),
    anonKey: readRuntimeConfigString(config.authAnonKey),
    serviceRoleKey: readRuntimeConfigString(config.authServiceRoleKey),
    storageKey: readRuntimeConfigString(config.authStorageKey, 'web-auth'),
    appUrl: readRuntimeConfigString(config.public.appUrl),
    loginPath: readRuntimeConfigString(config.public.authLoginPath, '/login'),
    registerPath: readRuntimeConfigString(config.public.authRegisterPath, '/register'),
    callbackPath: readRuntimeConfigString(config.public.authCallbackPath, '/auth/callback'),
    confirmPath: readRuntimeConfigString(config.public.authConfirmPath, '/auth/confirm'),
    resetPath: readRuntimeConfigString(config.public.authResetPath, '/reset-password'),
    logoutPath: readRuntimeConfigString(config.public.authLogoutPath, '/logout'),
    redirectPath: readRuntimeConfigString(config.public.authRedirectPath, '/dashboard/'),
    publicSignup: readRuntimeConfigBoolean(config.public.authPublicSignup, true),
    requireMfa: readRuntimeConfigBoolean(config.public.authRequireMfa),
    providers: readRuntimeConfigStringArray(config.public.authProviders).filter(isAuthProvider),
  }
}

export function isSupabaseConfigured(config: AuthConfig) {
  return Boolean(config.authorityUrl && config.authUrl && config.anonKey)
}

function getPkceStorage(event: H3Event): CookieLikeStorage {
  const memory = new Map<string, string>()

  return {
    isServer: true,
    getItem(key) {
      if (key.endsWith('-code-verifier')) {
        return getCookie(event, PKCE_COOKIE_NAME) ?? null
      }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      if (key.endsWith('-code-verifier')) {
        setCookie(event, PKCE_COOKIE_NAME, value, {
          httpOnly: true,
          sameSite: 'lax',
          secure: getSessionCookieSecure(event),
          maxAge: 60 * 15,
          path: '/',
        })
        return
      }

      memory.set(key, value)
    },
    removeItem(key) {
      if (key.endsWith('-code-verifier')) {
        deleteCookie(event, PKCE_COOKIE_NAME, { path: '/' })
        return
      }

      memory.delete(key)
    },
  }
}

export function createSupabaseClient(event: H3Event, apiKey: string) {
  const config = getAuthConfig(event)
  if (!config.authUrl || !apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase auth is not configured for this app.',
    })
  }

  return new GoTrueClient({
    url: config.authUrl,
    headers: {
      apikey: apiKey,
      ...(apiKey === config.serviceRoleKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    storageKey: config.storageKey,
    flowType: 'pkce',
    detectSessionInUrl: false,
    autoRefreshToken: false,
    persistSession: true,
    storage: getPkceStorage(event),
  })
}

export function createSupabaseUserClient(event: H3Event) {
  const config = getAuthConfig(event)
  return createSupabaseClient(event, config.anonKey)
}

export function toSupabaseHttpError(error: AuthError, fallbackStatusCode = 400): never {
  throw createError({
    statusCode: error.status ?? fallbackStatusCode,
    statusMessage: error.message || 'Auth request failed.',
  })
}
