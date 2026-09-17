/**
 * The in-isolate counter behind `defineRateLimitedHandler`.
 *
 * Deliberately dependency-free — no `h3`, no `nitropack`, no Cloudflare
 * globals — so it is exercised directly by unit tests under an injected clock
 * and so it loads in `nuxt dev`, in vitest, during Nitro's prerender pass and
 * in any non-Workers runtime.
 *
 * ## What this is and is not
 *
 * A fixed-window counter, per key, held in module scope. On Cloudflare Workers
 * each isolate has its own memory and isolates are evicted freely, so the
 * effective ceiling is `limit x live isolates` in a location. That is real
 * under-enforcement, not a rounding error: treat this as a brute-force and
 * scraper dampener, not as a quota.
 *
 * It is kept anyway, even when the Cloudflare Rate Limiting binding is
 * configured, for two reasons the binding cannot cover. The binding's
 * `.limit()` resolves to `{ success }` and nothing else — no remaining count,
 * no reset instant — so it cannot produce the `RateLimit-*` response headers,
 * and its `period` accepts only 10 or 60 seconds, so it cannot express any
 * other window.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */

export interface RateLimitWindowState {
  /** Requests counted in the window that began at `startedAt`. */
  count: number
  /** Epoch milliseconds at which the current window opened. */
  startedAt: number
}

export interface RateLimitVerdict {
  /** False when this request exceeded the window's allowance. */
  allowed: boolean
  /** The allowance the verdict was measured against. */
  limit: number
  /** Requests still available in the current window; never negative. */
  remaining: number
  /** Whole seconds until the current window closes; always at least 1. */
  resetSeconds: number
  /** Seconds the caller should wait before retrying. Only set when denied. */
  retryAfterSeconds?: number
}

/**
 * How many distinct keys one window store retains before the oldest windows
 * are dropped. A Worker isolate has a hard memory ceiling and the key space is
 * client-controlled (one entry per IP per route), so the store is bounded
 * rather than allowed to grow with traffic. Expired windows are swept first;
 * only if every retained window is still live does the sweep evict the oldest.
 */
export const RATE_LIMIT_MAX_TRACKED_KEYS = 10_000

export interface RateLimitWindowStore {
  /** Drop every tracked key. Exposed for tests and for a store's owner. */
  clear(): void
  /** Count one request against `key` and report the resulting verdict. */
  consume(key: string, limit: number, windowMs: number, now: number): RateLimitVerdict
  /** Tracked key count, for the eviction tests and for diagnostics. */
  readonly size: number
}

interface TrackedWindow extends RateLimitWindowState {
  /** The window length this key was last counted under, for expiry sweeps. */
  spanMs: number
}

function sweep(windows: Map<string, TrackedWindow>, now: number) {
  if (windows.size < RATE_LIMIT_MAX_TRACKED_KEYS) return

  for (const [key, state] of windows) {
    // A window whose own span has elapsed can no longer deny anything. The
    // span is recorded per key because different routes use different windows.
    if (state.startedAt + state.spanMs <= now) {
      windows.delete(key)
    }
  }

  // Still full: every retained window is live, so evict in insertion order,
  // which for a Map is oldest-touched-first.
  while (windows.size >= RATE_LIMIT_MAX_TRACKED_KEYS) {
    const oldest = windows.keys().next()
    if (oldest.done) break
    windows.delete(oldest.value)
  }
}

/**
 * Create an isolated window store.
 *
 * Production uses the one shared module-scope store from
 * {@link sharedRateLimitWindowStore}; tests create their own so they never
 * inherit another test's counts.
 */
export function createRateLimitWindowStore(): RateLimitWindowStore {
  const windows = new Map<string, TrackedWindow>()

  return {
    clear() {
      windows.clear()
    },

    get size() {
      return windows.size
    },

    consume(key, limit, windowMs, now) {
      // A non-positive limit denies everything; a non-positive window would
      // make `resetSeconds` meaningless. Both are configuration errors that
      // `resolveRoutePolicy` already rejects, so this is only a floor.
      const effectiveLimit = Math.max(0, Math.floor(limit))
      const span = Math.max(1, Math.floor(windowMs))

      sweep(windows, now)

      let state = windows.get(key)
      if (!state || state.startedAt + state.spanMs <= now) {
        state = { count: 0, startedAt: now, spanMs: span }
        windows.set(key, state)
      } else {
        // Keep insertion order meaningful for the oldest-first eviction above:
        // a key counted again moves to the end.
        windows.delete(key)
        windows.set(key, state)
        state.spanMs = span
      }

      const resetSeconds = Math.max(1, Math.ceil((state.startedAt + state.spanMs - now) / 1000))

      if (state.count >= effectiveLimit) {
        return {
          allowed: false,
          limit: effectiveLimit,
          remaining: 0,
          resetSeconds,
          retryAfterSeconds: resetSeconds,
        }
      }

      state.count += 1

      return {
        allowed: true,
        limit: effectiveLimit,
        remaining: Math.max(0, effectiveLimit - state.count),
        resetSeconds,
      }
    },
  }
}

/**
 * The process-wide store every request shares.
 *
 * Module scope is INTENTIONAL and is what gives the counter any reach at all:
 * it is the only state that survives between requests handled by the same
 * isolate. It is not shared across isolates and is lost on eviction — see this
 * module's header for why that is accepted.
 */
export const sharedRateLimitWindowStore: RateLimitWindowStore = createRateLimitWindowStore()
