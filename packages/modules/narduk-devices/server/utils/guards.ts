import { createError, getHeader } from 'h3'

import type { CredentialClass, DeviceSession } from '../../shared/types/devices'
import type { DevicesService } from './devices'
import type { H3Event } from 'h3'

export const DEVICES_UNAUTHORIZED_ERROR_CODE = 'unauthorized'
export const DEVICES_DENIED_ERROR_CODE = 'entitlement_denied'

/**
 * The devices surface a guard needs. Narrower than `DevicesService` on
 * purpose: a guard resolves a session and mutates nothing.
 */
export type DeviceSessionResolver = Pick<DevicesService, 'getSession'>

export interface RequireDeviceSessionOptions {
  /** The class this route requires; an `ingest` session never passes a `command` route. */
  credentialClass: CredentialClass
  devices: DeviceSessionResolver
  /** Override where the session id is read from. Default: `Authorization: Bearer <id>`. */
  resolveSessionId?: (event: H3Event) => string | null
}

function unauthorized(): Error {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: { errorCode: DEVICES_UNAUTHORIZED_ERROR_CODE, message: 'device session required' },
  })
}

function denied(): Error {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: { errorCode: DEVICES_DENIED_ERROR_CODE, message: 'credential class not permitted' },
  })
}

export function readBearerSessionId(event: H3Event): string | null {
  const header = getHeader(event, 'authorization')
  if (!header) return null
  const [scheme, value, ...rest] = header.trim().split(/\s+/u)
  if (rest.length > 0 || !value || scheme?.toLowerCase() !== 'bearer') return null
  return value
}

/**
 * Device-session gate: the bearer session id must name an active session whose
 * credential class is the one the route requires. 401 `unauthorized` when
 * there is no active session, 403 `entitlement_denied` when the class differs.
 */
export async function requireDeviceSession(
  event: H3Event,
  options: RequireDeviceSessionOptions,
): Promise<DeviceSession> {
  const sessionId = (options.resolveSessionId ?? readBearerSessionId)(event)
  if (!sessionId) throw unauthorized()
  const session = await options.devices.getSession(sessionId)
  if (!session) throw unauthorized()
  if (session.credentialClass !== options.credentialClass) throw denied()
  return session
}
