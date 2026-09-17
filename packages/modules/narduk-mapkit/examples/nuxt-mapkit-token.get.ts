import { mapKitTokenResponseFromEnv } from '@narduk-enterprises/narduk-mapkit/worker'
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

  // `xForwardedHost: false` is the whole point: the origin in the JWT claim is
  // the one this app is actually routed as, never one a proxy header names
  // (narduk-libs#421 §e.1). The request object is rebuilt from that same URL.
  const self = getRequestURL(event, { xForwardedHost: false }).origin
  const request = new Request(getRequestURL(event).toString(), {
    headers: event.headers,
    method: event.method,
  })

  return mapKitTokenResponseFromEnv(request, env, {}, { self })
})

function stringFromEnv(env: Record<string, unknown>, key: string): string {
  const value = env[key]
  return typeof value === 'string' ? value : ''
}
