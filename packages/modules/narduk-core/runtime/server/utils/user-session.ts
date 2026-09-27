import { getCookie, getRequestHeader, getRequestProtocol, unsealSession, useSession } from 'h3'

import { readRuntimeStringFromKeys } from './runtime-env'

import type { H3Event, SessionConfig } from 'h3'

export interface LayerUserSession extends Record<string, unknown> {
  id: string
  user?: unknown
}

type SessionData = Omit<LayerUserSession, 'id'>

export const DEFAULT_USER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export function resolveSessionConfig(
  event: H3Event,
  overrides: Partial<SessionConfig> = {},
): SessionConfig {
  const password = readRuntimeStringFromKeys(event, ['NUXT_SESSION_PASSWORD', 'SESSION_PASSWORD'])
  const { cookie: cookieOverrides, ...configOverrides } = overrides

  return {
    name: 'nuxt-session',
    password,
    maxAge: DEFAULT_USER_SESSION_MAX_AGE_SECONDS,
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
