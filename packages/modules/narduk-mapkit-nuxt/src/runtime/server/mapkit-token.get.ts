import { issueMapKitTokenForRequest } from '@narduk-enterprises/narduk-mapkit/worker'
import { useRuntimeConfig } from '#imports'
import {
  defineEventHandler,
  getRequestHeaders,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from 'h3'

import { readMapKitRuntimeString } from './runtime-env'

import type { MapKitRateLimitHook } from '@narduk-enterprises/narduk-mapkit/worker'
import type { H3Event } from 'h3'
import type { MapKitRuntimeEnv } from './runtime-env'

function readProcessEnv(): MapKitRuntimeEnv {
  const processValue = Reflect.get(globalThis, 'process') as { env?: MapKitRuntimeEnv } | undefined
  return processValue?.env ?? {}
}

function readCloudflareEnv(event: H3Event): MapKitRuntimeEnv {
  const context = event.context as {
    _platform?: { cloudflare?: { env?: MapKitRuntimeEnv } }
    cloudflare?: { env?: MapKitRuntimeEnv }
  }
  return context.cloudflare?.env ?? context._platform?.cloudflare?.env ?? {}
}

function requestFromEvent(event: H3Event): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (value) headers.set(name, value)
  }
  return new Request(getRequestURL(event), { headers, method: 'GET' })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const publicConfig = config.public as { appUrl?: string; mapkitToken?: string }
  const envSources = [readCloudflareEnv(event), readProcessEnv()]
  const rateLimit = (
    event.context as {
      nardukMapKit?: { rateLimit?: MapKitRateLimitHook }
    }
  ).nardukMapKit?.rateLimit
  const result = await issueMapKitTokenForRequest({
    config: {
      allowedOrigins: readMapKitRuntimeString(
        envSources,
        ['MAPKIT_ALLOWED_ORIGINS'],
        config.mapkitAllowedOrigins,
      ),
      doppler: false,
      fallbackOrigin: publicConfig.appUrl,
      keyId: readMapKitRuntimeString(envSources, ['APPLE_KEY_ID'], config.appleKeyId),
      privateKey: readMapKitRuntimeString(
        envSources,
        ['APPLE_PRIVATE_KEY', 'APPLE_SECRET_KEY'],
        config.applePrivateKey || config.appleSecretKey,
      ),
      staticToken: readMapKitRuntimeString(
        envSources,
        ['APPLE_MAPKIT_TOKEN', 'MAPKIT_TOKEN'],
        publicConfig.mapkitToken,
      ),
      teamId: readMapKitRuntimeString(envSources, ['APPLE_TEAM_ID'], config.appleTeamId),
    },
    ...(rateLimit ? { rateLimit } : {}),
    request: requestFromEvent(event),
  })

  setResponseHeader(event, 'cache-control', 'no-store')
  if (result.retryAfterSeconds !== undefined) {
    setResponseHeader(event, 'retry-after', result.retryAfterSeconds)
  }
  if (result.status) setResponseStatus(event, result.status)
  else if (!result.configured) setResponseStatus(event, 503)
  else if (!result.token) setResponseStatus(event, 403)
  return result
})
