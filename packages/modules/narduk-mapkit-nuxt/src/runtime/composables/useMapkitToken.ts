import { fetchMapKitToken } from '@narduk-enterprises/narduk-mapkit/client'
import { isJwtExpired } from '@narduk-enterprises/narduk-mapkit/token'
import { useRuntimeConfig } from '#imports'

export function useMapkitToken() {
  const config = useRuntimeConfig()
  const staticToken = String(config.public.mapkitToken || '')
  if (staticToken) {
    // narduk-libs#421 §b.1 removes `public.mapkitToken`: the same-host route
    // mints per routed origin, and a portal token that works everywhere is one
    // with no origin restriction at all. Named, never valued.
    console.warn(
      '[narduk-mapkit] runtimeConfig.public.mapkitToken is deprecated and is removed in 2.1: ' +
        'use the same-host token route (narduk-libs#421 §b.1).',
    )
  }
  const tokenEndpoint = String(config.public.mapkitTokenEndpoint || '/api/mapkit-token')

  async function getMapkitToken(): Promise<string> {
    if (staticToken && !isJwtExpired(staticToken, Date.now(), 60_000)) return staticToken
    return fetchMapKitToken(tokenEndpoint)
  }

  return { getMapkitToken }
}
