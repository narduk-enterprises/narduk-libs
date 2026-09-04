import {
  clearMapKitTokenCacheForTests,
  getOriginFromRequest,
  issueMapKitTokenForRequest as issueWorkerMapKitTokenForRequest,
  mapKitTokenResponse as workerMapKitTokenResponse,
  mapKitTokenResponseFromEnv,
} from './handler.js'
import { resolveMapKitServerConfig } from './config.js'

import type {
  MapKitTokenRequestOptions,
  MapKitTokenResponseOptions,
  MapKitTokenResult,
} from './handler.js'
import type { MapKitServerConfig } from './shared-config.js'

export * from './config.js'
export {
  clearMapKitTokenCacheForTests,
  getOriginFromRequest,
  mapKitTokenResponseFromEnv,
}
export type {
  MapKitRateLimitContext,
  MapKitRateLimitDecision,
  MapKitRateLimitHook,
  MapKitTokenRequestOptions,
  MapKitTokenResponseOptions,
  MapKitTokenResult,
} from './handler.js'

/**
 * Node-only token resolver. It may read `process.env` and use the optional
 * Doppler CLI fallback before delegating token creation to the Web Crypto
 * implementation.
 */
export async function issueMapKitTokenForRequest(
  options: MapKitTokenRequestOptions,
): Promise<MapKitTokenResult> {
  const config = await resolveMapKitServerConfig(options.config)
  return issueWorkerMapKitTokenForRequest({
    config,
    ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    request: options.request,
  })
}

export async function mapKitTokenResponse(
  request: Request,
  config?: MapKitServerConfig,
  options: MapKitTokenResponseOptions = {},
): Promise<Response> {
  try {
    const resolvedConfig = await resolveMapKitServerConfig(config)
    return workerMapKitTokenResponse(request, resolvedConfig, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate MapKit token'
    return new Response(
      JSON.stringify({ configured: false, error: message, token: '' }),
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        },
        status: 500,
      },
    )
  }
}

export function createMapKitTokenHandler(
  config?: MapKitServerConfig,
  options: MapKitTokenResponseOptions = {},
) {
  return (request: Request): Promise<Response> => mapKitTokenResponse(request, config, options)
}
