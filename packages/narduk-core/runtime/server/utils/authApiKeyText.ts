import { getRequestHeader } from 'h3'

import type { H3Event } from 'h3'

const API_KEY_PREFIX = 'nk_'
const API_KEY_WILDCARD_SCOPE = '*'

const DEFAULT_API_KEY_EXPIRY_DAYS = 30

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function getApiKeyFromAuthorization(event: H3Event): string | null {
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader) return null

  const [scheme, token] = authHeader.trim().split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith(API_KEY_PREFIX)) {
    return null
  }

  return token
}

function normalizeAuthScope(scope: string): string {
  return scope.trim()
}

export function normalizeApiKeyAuthScopes(scopes: readonly string[]) {
  const deduped = new Set<string>()

  for (const scope of scopes) {
    const normalized = normalizeAuthScope(scope)
    if (normalized) {
      deduped.add(normalized)
    }
  }

  return [...deduped]
}

export function parseApiKeyScopeText(scopesJson: string | null | undefined) {
  if (!scopesJson) return []

  try {
    const parsed = JSON.parse(scopesJson) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return normalizeApiKeyAuthScopes(
      parsed.filter((value): value is string => typeof value === 'string'),
    )
  } catch {
    return []
  }
}

export function serializeApiKeyScopeText(scopes: readonly string[]): string {
  return JSON.stringify(normalizeApiKeyAuthScopes(scopes))
}

export function resolveApiKeyExpirySeconds(
  expiresInDays: number | null | undefined,
): number | null {
  if (expiresInDays === null) {
    return null
  }

  const normalizedDays = expiresInDays ?? DEFAULT_API_KEY_EXPIRY_DAYS
  return nowSec() + normalizedDays * 86400
}

export function hasRequiredApiKeyScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const normalizedRequired = normalizeApiKeyAuthScopes(requiredScopes)
  if (normalizedRequired.length === 0) {
    return true
  }

  const normalizedGranted = new Set(normalizeApiKeyAuthScopes(grantedScopes))
  if (normalizedGranted.has(API_KEY_WILDCARD_SCOPE)) {
    return true
  }

  return normalizedRequired.every((scope) => normalizedGranted.has(scope))
}

export { API_KEY_PREFIX, nowSec }
