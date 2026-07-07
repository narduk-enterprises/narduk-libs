import { useSession } from 'h3'

import { readRuntimeStringFromKeys } from './runtime-env'

import type { H3Event, SessionConfig } from 'h3'

export interface LayerUserSession extends Record<string, unknown> {
  id: string
  user?: unknown
}

type SessionData = Omit<LayerUserSession, 'id'>

function resolveSessionConfig(
  event: H3Event,
  overrides: Partial<SessionConfig> = {},
): SessionConfig {
  const password = readRuntimeStringFromKeys(event, ['NUXT_SESSION_PASSWORD', 'SESSION_PASSWORD'])

  return {
    name: 'nuxt-session',
    password,
    cookie: {
      sameSite: 'lax',
      secure: true,
    },
    ...overrides,
  }
}

export async function getLayerUserSession(event: H3Event): Promise<LayerUserSession> {
  const session = await useSession(event, resolveSessionConfig(event))
  return {
    ...session.data,
    id: session.id,
  } as LayerUserSession
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
