export const CONTROL_PLANE_PROXY_PREFIX = '/api/control-plane'

const API_PREFIX = '/api'
const FLEET_API_PREFIX = '/api/fleet'

export function normalizeControlPlaneOrigin(controlPlaneUrl: string | undefined): string | null {
  const trimmed = controlPlaneUrl?.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

export function isFleetApiPath(pathname: string): boolean {
  return pathname === FLEET_API_PREFIX || pathname.startsWith(`${FLEET_API_PREFIX}/`)
}

export function resolveControlPlaneProxyPath(
  requestUrl: string | undefined,
  controlPlaneUrl: string | undefined,
  currentOrigin: string,
): string | null {
  if (!requestUrl) return null

  const controlPlaneOrigin = normalizeControlPlaneOrigin(controlPlaneUrl)
  if (!controlPlaneOrigin) return null
  if (controlPlaneOrigin === currentOrigin) return null

  let targetUrl: URL

  try {
    targetUrl = new URL(requestUrl, currentOrigin)
  } catch {
    return null
  }

  if (targetUrl.origin !== controlPlaneOrigin || !isFleetApiPath(targetUrl.pathname)) {
    return null
  }

  return `${CONTROL_PLANE_PROXY_PREFIX}${targetUrl.pathname.slice(API_PREFIX.length)}${targetUrl.search}`
}

export function buildControlPlaneUpstreamUrl(
  path: string | string[] | undefined,
  search: string,
  controlPlaneUrl: string | undefined,
): URL | null {
  const controlPlaneOrigin = normalizeControlPlaneOrigin(controlPlaneUrl)
  if (!controlPlaneOrigin) return null

  const rawPath = Array.isArray(path) ? path.join('/') : (path ?? '')
  const normalizedPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '')
  const pathname = `${API_PREFIX}/${normalizedPath}`

  if (!isFleetApiPath(pathname)) return null

  const upstreamUrl = new URL(pathname, controlPlaneOrigin)
  upstreamUrl.search = search

  return upstreamUrl
}
