/**
 * Configuration resolution and exemption matching for
 * `defineRateLimitedHandler`.
 *
 * Dependency-free like `./window.ts`: every input is passed in, so the whole
 * resolution order is unit-testable without booting Nitro.
 */

import { rateLimitClientBucket } from './client-bucket'

/** Which dimension a route's allowance is counted against. */
export type RateLimitScope =
  /** One allowance per client address, shared by every path using this key. */
  | 'ip'
  /** One allowance per client address per request path. */
  | 'ip-path'
  /** One allowance for the whole route key, shared by every caller. */
  | 'global'

/** Which `RateLimit-*` response header family to publish. */
export type RateLimitHeaderMode =
  /** `RateLimit` + `RateLimit-Policy`, per draft-ietf-httpapi-ratelimit-headers-11. */
  | 'standard'
  /** `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`, the widely deployed triad. */
  | 'legacy'
  /** Both families. The default. */
  | 'both'
  /** Only `Retry-After`, and only on a denial. */
  | 'none'

export interface RateLimitRouteOptions {
  /**
   * Explicit wrangler `ratelimits[].name` to enforce with. Overrides every
   * convention below. Set this when the app's binding is not named by the
   * `RL_<limit>` convention.
   */
  binding?: string
  /** Turn this route's limit off without deleting the wrapper. */
  enabled?: boolean
  /** Which `RateLimit-*` header family to publish. Defaults to `'both'`. */
  headers?: RateLimitHeaderMode
  /**
   * Stable identifier for this route's allowance. It names the counter, it is
   * the `runtimeConfig.nardukRateLimit.routes` override key, and it appears in
   * the denial log record. Choose a slug, not a path: paths change.
   */
  key: string
  /** Requests permitted per window. */
  limit?: number
  /** Counted dimension. Defaults to `'ip'`. */
  scope?: RateLimitScope
  /** Window length in seconds. */
  windowSeconds?: number
}

export interface RateLimitDefaults {
  enabled: boolean
  headers: RateLimitHeaderMode
  limit: number
  windowSeconds: number
}

/**
 * Paths never rate limited, whatever a route declares.
 *
 * Uptime monitors poll `/api/health` far harder than a human browses, and a
 * 429 there reads as an outage; `robots.txt` and the sitemap surfaces are how
 * crawlers discover the site at all, and throttling them is an SEO
 * self-injury. A trailing `*` matches by prefix.
 */
export const RATE_LIMIT_DEFAULT_EXEMPT_PATHS: readonly string[] = [
  '/api/health',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap/*',
  '/__sitemap__/*',
]

export const RATE_LIMIT_DEFAULTS: RateLimitDefaults = {
  enabled: true,
  headers: 'both',
  limit: 120,
  windowSeconds: 60,
}

/** The `runtimeConfig.nardukRateLimit` block, as read at request time. */
export interface RateLimitRuntimeConfig {
  /** Per-route-key binding names, for apps not using the `RL_<limit>` convention. */
  bindings?: Record<string, string | undefined>
  enabled?: boolean
  /** Replaces {@link RATE_LIMIT_DEFAULT_EXEMPT_PATHS} entirely when set. */
  exemptPaths?: string[]
  headers?: RateLimitHeaderMode
  limit?: number
  /** Per-route-key overrides, so an operator can retune without a deploy of the library. */
  routes?: Record<string, Partial<RateLimitRouteOptions> | undefined>
  windowSeconds?: number
}

export interface ResolvedRateLimitPolicy {
  binding?: string
  enabled: boolean
  headers: RateLimitHeaderMode
  key: string
  limit: number
  scope: RateLimitScope
  windowSeconds: number
}

const HEADER_MODES = new Set<RateLimitHeaderMode>(['standard', 'legacy', 'both', 'none'])
const SCOPES = new Set<RateLimitScope>(['ip', 'ip-path', 'global'])

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function headerMode(value: unknown): RateLimitHeaderMode | undefined {
  return typeof value === 'string' && HEADER_MODES.has(value as RateLimitHeaderMode)
    ? (value as RateLimitHeaderMode)
    : undefined
}

function scope(value: unknown): RateLimitScope | undefined {
  return typeof value === 'string' && SCOPES.has(value as RateLimitScope)
    ? (value as RateLimitScope)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Whether `path` is exempt.
 *
 * `path` is compared without its query string, so `/robots.txt?x=1` is exempt
 * exactly as `/robots.txt` is — otherwise an exemption is trivially bypassed,
 * which for a monitor URL carrying a cache-buster would have been an
 * accidental self-throttle rather than an attack.
 */
export function isRateLimitExemptPath(path: string, exemptPaths: readonly string[]): boolean {
  const withoutQuery = path.split('?')[0] ?? path
  const normalized =
    withoutQuery.length > 1 && withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : withoutQuery

  return exemptPaths.some((entry) => {
    if (entry.endsWith('*')) return normalized.startsWith(entry.slice(0, -1))
    return normalized === entry
  })
}

export function resolveExemptPaths(config: RateLimitRuntimeConfig | undefined): readonly string[] {
  const configured = config?.exemptPaths
  if (!Array.isArray(configured)) return RATE_LIMIT_DEFAULT_EXEMPT_PATHS

  const entries = configured.map((entry) => nonEmptyString(entry)).filter((e): e is string => !!e)
  // An app that sets the key to an empty array means "exempt nothing", which is
  // a legitimate choice; only an absent or wholly unusable value inherits.
  return entries.length > 0 || configured.length === 0 ? entries : RATE_LIMIT_DEFAULT_EXEMPT_PATHS
}

/**
 * Merge, in increasing precedence: the package defaults, the app's
 * `runtimeConfig.nardukRateLimit` block, the call-site options, and finally
 * that block's per-key `routes` override — which wins last on purpose, so an
 * operator can retune a limit a route hard-coded without editing the app.
 *
 * `enabled` is the exception: it is an AND across every layer, so switching
 * the block off disables every route regardless of what a route declares.
 */
export function resolveRoutePolicy(
  options: RateLimitRouteOptions,
  config: RateLimitRuntimeConfig | undefined,
): ResolvedRateLimitPolicy {
  const key = nonEmptyString(options.key)
  if (!key) {
    throw new TypeError('defineRateLimitedHandler needs a non-empty `key`.')
  }

  const override = config?.routes?.[key] ?? {}

  const limit =
    positiveInteger(override.limit) ??
    positiveInteger(options.limit) ??
    positiveInteger(config?.limit) ??
    RATE_LIMIT_DEFAULTS.limit

  const windowSeconds =
    positiveInteger(override.windowSeconds) ??
    positiveInteger(options.windowSeconds) ??
    positiveInteger(config?.windowSeconds) ??
    RATE_LIMIT_DEFAULTS.windowSeconds

  const enabled =
    config?.enabled !== false && options.enabled !== false && override.enabled !== false

  return {
    binding:
      nonEmptyString(override.binding) ??
      nonEmptyString(options.binding) ??
      nonEmptyString(config?.bindings?.[key]),
    enabled,
    headers:
      headerMode(override.headers) ??
      headerMode(options.headers) ??
      headerMode(config?.headers) ??
      RATE_LIMIT_DEFAULTS.headers,
    key,
    limit,
    scope: scope(override.scope) ?? scope(options.scope) ?? 'ip',
    windowSeconds,
  }
}

/**
 * The path an `'ip-path'` counter is keyed on.
 *
 * The wrapper runs inside the handler, so every spelling the router dispatches
 * to this route must land in one bucket (narduk-libs#433): the query string is
 * dropped, a percent-encoded spelling is decoded, and a trailing slash is
 * removed. A malformed escape keeps its raw spelling rather than throwing.
 */
function counterPath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? path
  let decoded = withoutQuery
  try {
    decoded = decodeURI(withoutQuery)
  } catch {
    // Keep the raw path; it is still a stable key for that spelling.
  }
  return decoded.length > 1 && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded
}

/**
 * The counter key for one request.
 *
 * `identity` is the client address for the IP-counted scopes and is ignored for
 * `'global'`. An IPv6 address is counted by its /64 (see
 * `./client-bucket.ts`). A request with no resolvable address collapses into
 * one shared bucket rather than escaping the limit — under-serving an unknown
 * caller beats handing every unknown caller an unlimited allowance.
 */
export function rateLimitCounterKey(
  policy: ResolvedRateLimitPolicy,
  identity: string | undefined,
  path: string,
): string {
  const who = identity === undefined ? 'unknown' : rateLimitClientBucket(identity)
  switch (policy.scope) {
    case 'global':
      return `${policy.key}:global`
    case 'ip-path':
      return `${policy.key}:${who}:${counterPath(path)}`
    default:
      return `${policy.key}:${who}`
  }
}

/**
 * The wrangler `ratelimits[].name` to enforce this policy with.
 *
 * Preference order: an explicit `binding`, then the convention this package
 * already established in `utils/rateLimit.ts` — `RL_<requests per minute>` —
 * which only applies to a 60-second window, because the Cloudflare binding's
 * `period` accepts nothing but 10 or 60 seconds and the existing binding names
 * encode a per-minute allowance.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
export function resolveBindingName(policy: ResolvedRateLimitPolicy): string | undefined {
  if (policy.binding) return policy.binding
  if (policy.windowSeconds !== 60) return undefined
  return `RL_${policy.limit}`
}
