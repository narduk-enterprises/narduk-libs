export function sanitizeLocalRedirectPath(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback

  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /%5c/iu.test(path)) {
    return fallback
  }

  try {
    const url = new URL(path, 'https://app.local')
    if (url.origin !== 'https://app.local' || !url.pathname.startsWith('/')) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export interface LocalRedirectRequest {
  path: string
  requested: boolean
}

/** Resolve an explicit component redirect before a route-level `next` query. */
export function resolveLocalRedirectRequest(
  explicitPath: string | undefined,
  routeNext: unknown,
  fallback: string,
): LocalRedirectRequest {
  const candidate = explicitPath ?? (typeof routeNext === 'string' ? routeNext : undefined)

  return {
    path: sanitizeLocalRedirectPath(candidate, fallback),
    requested: typeof candidate === 'string' && candidate.trim().length > 0,
  }
}

/** Preserve an explicitly requested local redirect while moving between auth routes. */
export function withLocalRedirectQuery(
  path: string,
  redirect: LocalRedirectRequest,
  query: Record<string, string> = {},
): string | { path: string; query: Record<string, string> } {
  const resolvedQuery = redirect.requested ? { ...query, next: redirect.path } : query

  return Object.keys(resolvedQuery).length > 0 ? { path, query: resolvedQuery } : path
}
