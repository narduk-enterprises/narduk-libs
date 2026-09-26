/**
 * Mint-time scope ceiling for a key minted by another API key (narduk-libs#858).
 *
 * `POST /api/auth/api-keys` only requires `auth:api-keys:write`. Without this
 * check, a key holding just that scope could mint a `*` key and escalate
 * from a narrow machine credential to every scope. An API-key caller may
 * therefore mint only scopes it already holds; `*` is mintable only by a key
 * that holds `*`. Session callers are not bounded here.
 *
 * A key with no scopes keeps full admin reach on admin routes
 * (`requireAdminRouteScopes`, narduk-libs#971), so an unscoped mint is not the
 * least a key can hold. Only a key that holds `*` may mint one
 * (narduk-libs#1122).
 *
 * Pure and dependency-free, like `api-key-lifetime`, so a unit test can
 * drive the verdict directly.
 */

import { API_KEY_WILDCARD_SCOPE } from './api-key-lifetime'

/** What {@link findScopesBeyondCaller} names when a scoped key asks for no scopes. */
export const UNSCOPED_MINT = '(no scopes)'

/**
 * The requested scopes the caller does not hold, in request order. Empty
 * means the mint stays within the caller's own scopes. A caller holding
 * scopes other than `*` that requests none gets {@link UNSCOPED_MINT}.
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
  if (held.size > 0 && !requestedScopes.some((scope) => scope.trim())) {
    // An unscoped child would outrank its scoped parent on admin routes.
    refused.add(UNSCOPED_MINT)
  }
  for (const scope of requestedScopes) {
    const normalized = scope.trim()
    if (normalized && !held.has(normalized)) {
      refused.add(normalized)
    }
  }
  return [...refused]
}
