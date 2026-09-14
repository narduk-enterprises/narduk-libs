import { fetchMapKitToken } from '@narduk-enterprises/narduk-mapkit/client'
import { isJwtExpired } from '@narduk-enterprises/narduk-mapkit/token'
import { useRuntimeConfig } from '#imports'

export function useMapkitToken() {
  const config = useRuntimeConfig()
  const staticToken = String(config.public.mapkitToken || '')
  const tokenEndpoint = String(config.public.mapkitTokenEndpoint || '/api/mapkit-token')

  async function getMapkitToken(): Promise<string> {
    if (staticToken && !isJwtExpired(staticToken, Date.now(), 60_000)) return staticToken
    return fetchMapKitToken(tokenEndpoint)
  }

  return { getMapkitToken }
}
