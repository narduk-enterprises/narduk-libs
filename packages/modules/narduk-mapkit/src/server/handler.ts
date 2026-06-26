import { createMapKitToken } from '../token/jwt.js'
import {
  hasSigningConfig,
  hasUsableStaticToken,
  isOriginAllowed,
  mapKitConfigFromEnv,
  parseAllowedOrigins,
} from './config.js'

import type { MapKitServerConfig } from './config.js'

export interface MapKitTokenRequestOptions {
  config?: MapKitServerConfig
  request: Request
}

export interface MapKitTokenResult {
  configured: boolean
  error?: string
  origin: string
  token: string
}

export function getOriginFromRequest(request: Request, fallbackOrigin = 'http://localhost:3000') {
  const origin = request.headers.get('origin')
  if (origin) return origin

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      // Fall back below.
    }
  }

  try {
    return new URL(request.url).origin
  } catch {
    return fallbackOrigin
  }
}

export async function issueMapKitTokenForRequest(
  options: MapKitTokenRequestOptions,
): Promise<MapKitTokenResult> {
  const config = { ...mapKitConfigFromEnv(), ...options.config }
  const origin = getOriginFromRequest(options.request, config.fallbackOrigin)
  const allowedOrigins = parseAllowedOrigins(config.allowedOrigins)

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return {
      configured: true,
      error: 'Origin is not allowed for MapKit token issuance.',
      origin,
      token: '',
    }
  }

  if (hasSigningConfig(config)) {
    const tokenOptions = {
      keyId: config.keyId!,
      origin,
      privateKey: config.privateKey!,
      teamId: config.teamId!,
      ...(config.tokenExpiresInSeconds !== undefined
        ? { expiresInSeconds: config.tokenExpiresInSeconds }
        : {}),
    }
    const token = await createMapKitToken(tokenOptions)
    return { configured: true, origin, token }
  }

  if (hasUsableStaticToken(config)) {
    return { configured: true, origin, token: config.staticToken!.trim() }
  }

  return {
    configured: false,
    error:
      'MapKit is not configured. Set APPLE_PRIVATE_KEY, APPLE_TEAM_ID, and APPLE_KEY_ID to sign origin-scoped tokens, or provide a non-expired MAPKIT_TOKEN / APPLE_MAPKIT_TOKEN.',
    origin,
    token: '',
  }
}

export async function mapKitTokenResponse(
  request: Request,
  config?: MapKitServerConfig,
): Promise<Response> {
  try {
    const result = await issueMapKitTokenForRequest(
      config ? { request, config } : { request },
    )
    const status = result.configured ? (result.token ? 200 : 403) : 503
    return jsonResponse(result, status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate MapKit token'
    return jsonResponse({ configured: false, error: message, token: '' }, 500)
  }
}

export function createMapKitTokenHandler(config?: MapKitServerConfig) {
  return (request: Request): Promise<Response> =>
    config ? mapKitTokenResponse(request, config) : mapKitTokenResponse(request)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  })
}
