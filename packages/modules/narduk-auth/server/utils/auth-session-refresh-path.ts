const PUBLIC_AUTH_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password/reset',
  '/api/auth/password/complete',
  '/api/auth/oauth/start',
  '/api/auth/runtime-public',
])

/**
 * Dev/Node asset prefixes. Cloudflare static assets never hit the worker, but
 * a Node listener would otherwise D1-lookup every cookie'd `/_nuxt/*` request.
 * Page SSR and `/api/*` stay covered.
 */
export function isStaticAssetAuthPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  if (pathname.startsWith('/_nuxt/') || pathname === '/_nuxt') return true
  if (pathname.startsWith('/_ipx/')) return true
  if (pathname.startsWith('/_og/')) return true
  if (pathname.startsWith('/__nuxt')) return true
  if (pathname.startsWith('/favicon')) return true
  if (pathname === '/robots.txt') return true
  if (pathname.startsWith('/sitemap')) return true
  return false
}

export function shouldRevalidateAuthSession(path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  if (pathname.startsWith('/api/health') || pathname.startsWith('/api/runtime/')) {
    return false
  }
  if (isStaticAssetAuthPath(pathname)) {
    return false
  }
  if (PUBLIC_AUTH_API_PATHS.has(pathname)) {
    return false
  }
  return true
}
