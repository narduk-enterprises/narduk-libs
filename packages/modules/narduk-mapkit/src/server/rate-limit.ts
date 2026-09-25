/**
 * §e.4's fixed-window token-route limiter, on the Worker-safe entry points.
 *
 * The 2.1 Nuxt module applies it to its own route by default (`rateLimit` module option, 30
 * requests / 60 s). A Worker or Fetch caller of `mapKitTokenResponseFromEnv` passes it as the
 * `rateLimit` option (narduk-libs#485):
 *
 * ```ts
 * const rateLimit = createMapKitFixedWindowRateLimit({
 *   key: ({ request, self }) => request.headers.get('cf-connecting-ip') ?? self,
 *   limit: 30,
 *   windowSeconds: 60,
 * })
 * mapKitTokenResponseFromEnv(request, env, {}, { rateLimit })
 * ```
 *
 * Deliberately in-process and per-instance: it bounds one isolate's own signing work and makes no
 * claim to be a distributed limiter. A serverless deployment gets one window per warm instance,
 * which is why an app with real abuse exposure still mounts narduk-core's limiter.
 */
import type { MapKitRateLimitContext, MapKitRateLimitHook } from './handler.js'

export interface MapKitFixedWindowOptions {
  /**
   * Names the bucket a request spends from. Defaults to the routed origin (`context.self`), so
   * every client of one host shares a window. A Worker that knows the client address can key per
   * client instead, e.g. on `cf-connecting-ip`.
   */
  key?: (context: MapKitRateLimitContext) => string
  limit: number
  /**
   * Most client windows held at once (default 10,000). Expired windows are dropped as time
   * passes; past this many LIVE windows the oldest is dropped, and that client starts a fresh
   * window. Bounds a per-client key under traffic from many addresses (narduk-libs#869).
   */
  maxKeys?: number
  /** Injected so a test does not have to wait a window out. */
  now?: () => number
  windowSeconds: number
}

interface Window {
  count: number
  resetAtMs: number
}

const DEFAULT_MAX_KEYS = 10_000

export function createMapKitFixedWindowRateLimit(
  options: MapKitFixedWindowOptions,
): MapKitRateLimitHook {
  const now = options.now ?? Date.now
  const keyOf = options.key ?? ((context: MapKitRateLimitContext) => context.self)
  const windowMs = Math.max(1, options.windowSeconds) * 1000
  const maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS)
  /**
   * Insertion order is reset order: every window is the same length and a renewed window is
   * re-inserted at the back, so expired windows are always at the front.
   */
  const windows = new Map<string, Window>()

  return (context: MapKitRateLimitContext) => {
    const at = now()
    for (const [staleKey, stale] of windows) {
      if (at < stale.resetAtMs) break
      windows.delete(staleKey)
    }

    const key = keyOf(context)
    const window = windows.get(key)
    if (!window || at >= window.resetAtMs) {
      // Delete first so a renewed window moves to the back (a clock that steps backwards can
      // leave an expired window behind a live one, which the sweep above then stops at).
      windows.delete(key)
      windows.set(key, { count: 1, resetAtMs: at + windowMs })
      if (windows.size > maxKeys) {
        const oldestKey = windows.keys().next().value
        if (oldestKey !== undefined) windows.delete(oldestKey)
      }
      return { allowed: true }
    }
    window.count += 1
    if (window.count <= options.limit) return { allowed: true }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - at) / 1000)),
    }
  }
}
