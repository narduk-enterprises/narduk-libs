/**
 * Mint-time lifetime for a boundary-class API key (narduk-libs#168).
 *
 * `authenticateApiKey` looks a presented token up by `key_hash` (uniquely
 * indexed in narduk-core 0007). This module owns the other half of that
 * issue: a key whose scopes include `*` admits its bearer to every
 * scope-gated route, so it must expire and may not outlive 90 days.
 *
 * Pure and dependency-free so the POST /api/auth/api-keys handler and the
 * settings panel share one verdict a unit test can drive directly.
 */

export const API_KEY_WILDCARD_SCOPE = '*'
export const DEFAULT_API_KEY_EXPIRY_DAYS = 30
export const BOUNDARY_API_KEY_MAX_EXPIRY_DAYS = 90

export type ApiKeyMintExpiryReason = 'boundary-unbounded' | 'boundary-ceiling'

export type ApiKeyMintExpiryVerdict =
  { expiresInDays: number | null; ok: true } | { ok: false; reason: ApiKeyMintExpiryReason }

export function isBoundaryClassApiKey(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.trim() === API_KEY_WILDCARD_SCOPE)
}

export function resolveApiKeyMintExpiry(
  scopes: readonly string[],
  expiresInDays: number | null | undefined,
): ApiKeyMintExpiryVerdict {
  const resolvedDays = expiresInDays === undefined ? DEFAULT_API_KEY_EXPIRY_DAYS : expiresInDays

  if (!isBoundaryClassApiKey(scopes)) {
    return { ok: true, expiresInDays: resolvedDays }
  }

  if (resolvedDays === null) {
    return { ok: false, reason: 'boundary-unbounded' }
  }

  if (resolvedDays > BOUNDARY_API_KEY_MAX_EXPIRY_DAYS) {
    return { ok: false, reason: 'boundary-ceiling' }
  }

  return { ok: true, expiresInDays: resolvedDays }
}

export type ChildApiKeyExpiryVerdict = { expiresAt: number | null; ok: true } | { ok: false }

/**
 * Bound a key minted by another API key to its parent's lifetime
 * (narduk-libs#920). Both values are `expires_at` unix seconds, `null` for a
 * key that never expires.
 *
 * A child may end no later than its parent. When the caller named no expiry,
 * the default is clamped to the parent's; an explicit expiry past the parent,
 * or none at all under a parent that expires, is refused. Without this, a
 * leaked short-lived key could mint a never-expiring copy of itself, and a
 * `*` key could renew itself for another 90 days before each expiry.
 */
export function boundChildApiKeyExpiry(
  requestedExpiresAt: number | null,
  parentExpiresAt: number | null,
  requestedExplicitly: boolean,
): ChildApiKeyExpiryVerdict {
  if (parentExpiresAt === null) {
    return { ok: true, expiresAt: requestedExpiresAt }
  }

  if (requestedExpiresAt !== null && requestedExpiresAt <= parentExpiresAt) {
    return { ok: true, expiresAt: requestedExpiresAt }
  }

  return requestedExplicitly ? { ok: false } : { ok: true, expiresAt: parentExpiresAt }
}
