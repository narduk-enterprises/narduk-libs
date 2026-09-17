/**
 * The default rate-limit hook for the token route.
 *
 * §e.4 hands rate limiting to narduk-core, and an app that mounts its limiter on
 * `event.context.nardukMapKit.rateLimit` still wins. But the route mints signed
 * JWTs, so leaving it unlimited by default when narduk-core is absent is the
 * wrong failure mode -- and the 2.0.x `rateLimit` seam had zero consumers
 * precisely because it required the app to build the limiter itself.
 *
 * Deliberately in-process and per-instance: it bounds one server's own signing
 * work, and it makes no claim to be a distributed limiter. A serverless
 * deployment gets one window per warm instance, which is why an app with real
 * abuse exposure still mounts narduk-core's.
 */
import type { MapKitRateLimitContext, MapKitRateLimitHook } from '../../../server/handler.js'

export interface MapKitFixedWindowOptions {
  limit: number
  /** Injected so a test does not have to wait a window out. */
  now?: () => number
  windowSeconds: number
}

interface Window {
  count: number
  resetAtMs: number
}

export function createMapKitFixedWindowRateLimit(
  options: MapKitFixedWindowOptions,
): MapKitRateLimitHook {
  const now = options.now ?? Date.now
  const windowMs = Math.max(1, options.windowSeconds) * 1000
  const windows = new Map<string, Window>()

  return (context: MapKitRateLimitContext) => {
    const at = now()
    const key = context.self
    const window = windows.get(key)
    if (!window || at >= window.resetAtMs) {
      windows.set(key, { count: 1, resetAtMs: at + windowMs })
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
