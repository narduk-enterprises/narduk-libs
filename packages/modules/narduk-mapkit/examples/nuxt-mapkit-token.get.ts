import { mapKitTokenResponseFromEnv } from '@narduk-enterprises/narduk-mapkit/worker'
import { toWebRequest } from 'h3'

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
    MAPKIT_ALLOWED_ORIGINS:
      stringFromEnv(cloudflareEnv, 'MAPKIT_ALLOWED_ORIGINS') || config.mapkitAllowedOrigins,
    MAPKIT_TOKEN:
      stringFromEnv(cloudflareEnv, 'MAPKIT_TOKEN') ||
      stringFromEnv(cloudflareEnv, 'APPLE_MAPKIT_TOKEN') ||
      config.public.mapkitToken,
  }

  return mapKitTokenResponseFromEnv(toWebRequest(event), env, {
    allowedOrigins: env.MAPKIT_ALLOWED_ORIGINS,
    fallbackOrigin: config.public.appUrl,
  })
})

function stringFromEnv(env: Record<string, unknown>, key: string): string {
  const value = env[key]
  return typeof value === 'string' ? value : ''
}
