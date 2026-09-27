import { getCookie, getRequestHeader, getRequestProtocol, unsealSession, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import {
  DEFAULT_USER_SESSION_MAX_AGE_SECONDS,
  LAYER_USER_SESSION_NAME,
} from '../../shared/user-session-config'

import { readRuntimeStringFromKeys } from './runtime-env'

import type { H3Event, SessionConfig } from 'h3'

export interface LayerUserSession extends Record<string, unknown> {
  id: string
  user?: unknown
}

type SessionData = Omit<LayerUserSession, 'id'>

export { DEFAULT_USER_SESSION_MAX_AGE_SECONDS, LAYER_USER_SESSION_NAME }

/**
 * `runtimeConfig.session`, the config `nuxt-auth-utils` reads its session
 * with. Core seeds its `name` and `maxAge` (`src/module.ts`); an app or a
 * `NUXT_SESSION_*` env override changes them for both readers at once.
 */
function readSessionRuntimeConfig(event: H3Event): { maxAge?: unknown; name?: unknown } {
  try {
    const session = (useRuntimeConfig(event) as Record<string, unknown>).session
    return session && typeof session === 'object' ? (session as Record<string, unknown>) : {}
  } catch {
    // Outside a Nitro app (unit tests, tooling): the shared defaults.
    return {}
  }
}

function sessionNameFrom(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : LAYER_USER_SESSION_NAME
}

function sessionMaxAgeFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_USER_SESSION_MAX_AGE_SECONDS
}

export function resolveSessionConfig(
  event: H3Event,
  overrides: Partial<SessionConfig> = {},
): SessionConfig {
  const password = readRuntimeStringFromKeys(event, ['NUXT_SESSION_PASSWORD', 'SESSION_PASSWORD'])
  const { cookie: cookieOverrides, ...configOverrides } = overrides

  const runtimeSession = readSessionRuntimeConfig(event)

  // Name and lifetime come from the same `runtimeConfig.session` that
  // `nuxt-auth-utils` reads, so both accept and refuse the same cookie
  // (narduk-libs#1214).
  return {
    name: sessionNameFrom(runtimeSession.name),
    password,
    maxAge: sessionMaxAgeFrom(runtimeSession.maxAge),
    ...configOverrides,
    cookie: {
      sameSite: 'lax',
      secure: getRequestProtocol(event) === 'https',
      ...cookieOverrides,
    },
  }
}

/** h3's own fallback when a session config has no name. */
const H3_DEFAULT_SESSION_NAME = 'h3'

function sessionNameOf(config: SessionConfig): string {
  return config.name || H3_DEFAULT_SESSION_NAME
}

/**
 * The sealed session the request carries, found where h3's `getSession` looks:
 * the `x-<name>-session` header (unless `sessionHeader` is off), then the
 * cookie. `undefined` when there is none.
 */
function readSealedSession(event: H3Event, config: SessionConfig): string | undefined {
  const name = sessionNameOf(config)
  if (config.sessionHeader !== false) {
    const headerName =
      typeof config.sessionHeader === 'string'
        ? config.sessionHeader.toLowerCase()
        : `x-${name.toLowerCase()}-session`
    const header = getRequestHeader(event, headerName)
    if (typeof header === 'string' && header) return header
  }
  return getCookie(event, name) || undefined
}

function hasSessionInContext(event: H3Event, config: SessionConfig): boolean {
  return Boolean(event.context.sessions?.[sessionNameOf(config)])
}

/**
 * Whether the request carries a layer session (a sealed cookie or session
 * header), or one was already read or written earlier in this request.
 *
 * Reading nothing: an anonymous request stays cookie-free (narduk-libs#1214).
 */
export function hasLayerUserSession(event: H3Event, config?: Partial<SessionConfig>): boolean {
  const resolved = resolveSessionConfig(event, config)
  return hasSessionInContext(event, resolved) || readSealedSession(event, resolved) !== undefined
}

/**
 * Read the layer session without ever writing a cookie. `null` when the
 * request carries no session, or one that does not unseal (tampered, a
 * rotated password, past `maxAge`).
 *
 * `getLayerUserSession` goes through h3's `useSession`, which seals and sets a
 * brand-new session cookie whenever the request has none. That is right when
 * a caller is about to write the session, and wrong for a pure read: it gave
 * every anonymous request a 30-day cookie (narduk-libs#1214). Use this for
 * reads; keep `setLayerUserSession` / `replaceLayerUserSession` for writes.
 */
export async function peekLayerUserSession(
  event: H3Event,
  config?: Partial<SessionConfig>,
): Promise<LayerUserSession | null> {
  const resolved = resolveSessionConfig(event, config)
  // Already read or written in this request: h3 hands back that session and
  // writes nothing, so a login earlier in the request is seen.
  if (hasSessionInContext(event, resolved)) {
    return toLayerUserSession(await useSession(event, resolved))
  }
  const sealed = readSealedSession(event, resolved)
  if (!sealed) return null
  try {
    const unsealed = await unsealSession(event, resolved, sealed)
    if (!unsealed.id) return null
    return {
      ...(unsealed.data as Record<string, unknown> | undefined),
      id: unsealed.id,
    } as LayerUserSession
  } catch {
    return null
  }
}

function toLayerUserSession(session: { data: unknown; id: string | undefined }): LayerUserSession {
  return {
    ...(session.data as Record<string, unknown>),
    id: session.id,
  } as LayerUserSession
}

/**
 * The layer session through h3's `useSession`. When the request has no
 * session this creates one and sets its cookie; for a read that must not do
 * that, use `peekLayerUserSession`.
 */
export async function getLayerUserSession(event: H3Event): Promise<LayerUserSession> {
  return toLayerUserSession(await useSession(event, resolveSessionConfig(event)))
}

export async function setLayerUserSession(
  event: H3Event,
  data: SessionData,
  config?: Partial<SessionConfig>,
): Promise<LayerUserSession> {
  const session = await useSession(event, resolveSessionConfig(event, config))
  await session.update({
    ...session.data,
    ...data,
  })
  return {
    ...session.data,
    id: session.id,
  } as LayerUserSession
}

export async function replaceLayerUserSession(
  event: H3Event,
  data: SessionData,
  config?: Partial<SessionConfig>,
): Promise<LayerUserSession> {
  const session = await useSession(event, resolveSessionConfig(event, config))
  await session.clear()
  await session.update(data)
  return {
    ...session.data,
    id: session.id,
  } as LayerUserSession
}

export async function clearLayerUserSession(
  event: H3Event,
  config?: Partial<SessionConfig>,
): Promise<boolean> {
  const session = await useSession(event, resolveSessionConfig(event, config))
  await session.clear()
  return true
}
