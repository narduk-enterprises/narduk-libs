/**
 * Relying Party configuration for the passkey (WebAuthn) ceremonies
 * (narduk-libs#125, W7 A1).
 *
 * Pure and dependency-free on purpose: origin/RP-ID binding is the single
 * decision that separates a passkey from a phishable credential, so it is
 * resolved and validated in one place a unit test can drive directly, rather
 * than being reassembled inside each route.
 *
 * Every failure mode resolves to `{ enabled: false, reason }` — never to a
 * partially-configured RP. A route that cannot read a fully-valid config
 * refuses the ceremony.
 */

export type WebauthnDisabledReason =
  | 'backend-not-local'
  | 'missing-origin'
  | 'missing-rp-id'
  | 'origin-not-bound-to-rp-id'
  | 'invalid-origin'
  | 'invalid-rp-id'
  | 'provider-not-enabled'

export interface ResolvedWebauthnConfig {
  challengeTtlSeconds: number
  enabled: true
  origins: string[]
  rpId: string
  rpName: string
}

export interface UnresolvedWebauthnConfig {
  enabled: false
  reason: WebauthnDisabledReason
}

export type WebauthnConfig = ResolvedWebauthnConfig | UnresolvedWebauthnConfig

export const WEBAUTHN_CHALLENGE_TTL_DEFAULT_SECONDS = 300
export const WEBAUTHN_CHALLENGE_TTL_MIN_SECONDS = 60
export const WEBAUTHN_CHALLENGE_TTL_MAX_SECONDS = 900

/**
 * An RP ID must be a valid registrable domain (or `localhost`). Reject an IP
 * literal, a bare TLD, anything carrying a scheme, port, path or wildcard, and
 * anything with a trailing dot — each of those either cannot be an RP ID or
 * widens the credential's scope beyond a single site.
 */
function isValidRpId(value: string): boolean {
  if (value === 'localhost') return true
  if (value.length > 253) return false
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(value)) {
    return false
  }
  // An all-numeric final label means an IPv4 literal, which is never an RP ID.
  const labels = value.split('.')
  return !/^\d+$/u.test(labels.at(-1) ?? '')
}

/**
 * WebAuthn requires an origin's effective domain to equal the RP ID or be a
 * subdomain of it. A credential registered at `staging.ops.example.com` with
 * RP ID `staging.ops.example.com` is unusable at `ops.example.com`, and that
 * is the intended behaviour — see narduk-libs#125 risk R4. Widening the RP ID
 * to the registrable parent to share one credential across the zone hands that
 * credential to every host in the zone; this function permits the
 * configuration but the README explicitly advises against it.
 */
export function isOriginBoundToRpId(origin: string, rpId: string): boolean {
  let host: string
  let protocol: string
  try {
    const url = new URL(origin)
    host = url.hostname.toLowerCase()
    protocol = url.protocol
  } catch {
    return false
  }
  if (protocol !== 'https:' && !(protocol === 'http:' && host === 'localhost')) return false
  return host === rpId || host.endsWith(`.${rpId}`)
}

/** Normalizes to scheme://host[:port] so a configured trailing path never leaks in. */
function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.pathname !== '/' && url.pathname !== '') return null
    if (url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function parseTtlSeconds(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return WEBAUTHN_CHALLENGE_TTL_DEFAULT_SECONDS
  return Math.min(
    WEBAUTHN_CHALLENGE_TTL_MAX_SECONDS,
    Math.max(WEBAUTHN_CHALLENGE_TTL_MIN_SECONDS, parsed),
  )
}

export interface ResolveWebauthnConfigInput {
  /** The resolved auth backend. Passkeys are local-backend only in this release. */
  authBackend: string
  /** The resolved provider advertisement list — `passkey` must be present. */
  authProviders: readonly string[]
  env: Record<string, string | undefined>
}

/**
 * Resolves the RP configuration, or the exact reason it is unusable.
 *
 * Passkeys are **local-backend only** here. The Supabase path owns its own
 * session model (`auth_sessions` rows, refresh tokens, AAL), and establishing a
 * local-style session on it would produce a session shape the Supabase refresh
 * middleware does not expect. Extending passkeys to the Supabase backend is a
 * separate change with its own session design.
 */
export function resolveWebauthnConfig(input: ResolveWebauthnConfigInput): WebauthnConfig {
  if (input.authBackend !== 'local') return { enabled: false, reason: 'backend-not-local' }
  if (!input.authProviders.includes('passkey')) {
    return { enabled: false, reason: 'provider-not-enabled' }
  }

  const rpId = (input.env.AUTH_WEBAUTHN_RP_ID ?? '').trim().toLowerCase()
  if (!rpId) return { enabled: false, reason: 'missing-rp-id' }
  if (!isValidRpId(rpId)) return { enabled: false, reason: 'invalid-rp-id' }

  const rawOrigins = (input.env.AUTH_WEBAUTHN_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (rawOrigins.length === 0) return { enabled: false, reason: 'missing-origin' }

  const origins: string[] = []
  for (const raw of rawOrigins) {
    const normalized = normalizeOrigin(raw)
    if (!normalized) return { enabled: false, reason: 'invalid-origin' }
    if (!isOriginBoundToRpId(normalized, rpId)) {
      return { enabled: false, reason: 'origin-not-bound-to-rp-id' }
    }
    if (!origins.includes(normalized)) origins.push(normalized)
  }

  return {
    enabled: true,
    challengeTtlSeconds: parseTtlSeconds(input.env.AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS),
    origins,
    rpId,
    rpName: (input.env.AUTH_WEBAUTHN_RP_NAME ?? '').trim() || rpId,
  }
}

export function describeWebauthnDisabledReason(reason: WebauthnDisabledReason): string {
  switch (reason) {
    case 'backend-not-local': {
      return 'Passkeys are available on the local auth backend only.'
    }
    case 'provider-not-enabled': {
      return 'Passkeys are not enabled for this app. Add `passkey` to AUTH_LOCAL_PROVIDERS.'
    }
    case 'missing-rp-id': {
      return 'AUTH_WEBAUTHN_RP_ID is not set.'
    }
    case 'invalid-rp-id': {
      return 'AUTH_WEBAUTHN_RP_ID is not a valid Relying Party ID.'
    }
    case 'missing-origin': {
      return 'AUTH_WEBAUTHN_ORIGIN is not set.'
    }
    case 'invalid-origin': {
      return 'AUTH_WEBAUTHN_ORIGIN must be a comma-separated list of scheme://host[:port] origins.'
    }
    case 'origin-not-bound-to-rp-id': {
      return 'Every AUTH_WEBAUTHN_ORIGIN host must equal AUTH_WEBAUTHN_RP_ID or be a subdomain of it.'
    }
  }
}
