import {
  mapKitRoutedOrigin,
  mapKitTokenResponseFromEnv,
} from '@narduk-enterprises/narduk-mapkit/worker'
import { getRequestURL } from 'h3'

import type { MapKitEnv } from '@narduk-enterprises/narduk-mapkit/worker'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const cloudflareEnv = (event.context.cloudflare?.env as Record<string, unknown> | undefined) ?? {}
  const env: MapKitEnv = {
    APPLE_KEY_ID: stringFromEnv(cloudflareEnv, 'APPLE_KEY_ID') || config.appleKeyId,
    APPLE_PRIVATE_KEY:
      stringFromEnv(cloudflareEnv, 'APPLE_PRIVATE_KEY') ||
      stringFromEnv(cloudflareEnv, 'APPLE_SECRET_KEY') ||
      config.applePrivateKey,
    APPLE_TEAM_ID: stringFromEnv(cloudflareEnv, 'APPLE_TEAM_ID') || config.appleTeamId,
  }

  // The origin in the JWT claim is the one this app is actually routed as
  // (narduk-libs#421 §e.1): the routed Fetch Request where there is one, and
  // `null` (a 403) for an absolute-form request line, which h3's own URL
  // would otherwise believe.
  const self = mapKitRoutedOrigin({
    derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
    request: event.web?.request,
    requestTarget: event.node.req.originalUrl ?? event.path,
  })
  const request =
    event.web?.request ??
    new Request(getRequestURL(event).toString(), { headers: event.headers, method: event.method })

  return mapKitTokenResponseFromEnv(request, env, {}, { self })
})

function stringFromEnv(env: Record<string, unknown>, key: string): string {
  const value = env[key]
  return typeof value === 'string' ? value : ''
}
