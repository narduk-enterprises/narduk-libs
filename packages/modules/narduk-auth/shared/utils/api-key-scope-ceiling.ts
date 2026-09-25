/**
 * Mint-time scope ceiling for a key minted by another API key (narduk-libs#858).
 *
 * `POST /api/auth/api-keys` only requires `auth:api-keys:write`. Without this
 * check, a key holding just that scope could mint a `*` key and escalate
 * from a narrow machine credential to every scope. An API-key caller may
 * therefore mint only scopes it already holds; `*` is mintable only by a key
 * that holds `*`. Session callers are not bounded here.
 *
 * Pure and dependency-free, like `api-key-lifetime`, so a unit test can
 * drive the verdict directly.
 */

import { API_KEY_WILDCARD_SCOPE } from './api-key-lifetime'

/**
 * The requested scopes the caller does not hold, in request order. Empty
 * means the mint stays within the caller's own scopes.
 */
export function findScopesBeyondCaller(
  requestedScopes: readonly string[],
  callerScopes: readonly string[],
): string[] {
  const held = new Set(callerScopes.map((scope) => scope.trim()).filter(Boolean))
  if (held.has(API_KEY_WILDCARD_SCOPE)) {
    return []
  }

  const refused = new Set<string>()
  for (const scope of requestedScopes) {
    const normalized = scope.trim()
    if (normalized && !held.has(normalized)) {
      refused.add(normalized)
    }
  }
  return [...refused]
}
