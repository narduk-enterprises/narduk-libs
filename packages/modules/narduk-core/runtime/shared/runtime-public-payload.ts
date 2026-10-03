/**
 * The request-time public overlay, carried in the SSR payload.
 *
 * The server `runtime-public-payload` plugin writes the overlay it resolved
 * for the request under `payload.runtimePublic`; the browser `runtime-public`
 * plugin applies it with no network round trip, so hydration does not wait on
 * `GET /api/runtime/public` (narduk-libs#1368). HTML that carries no overlay
 * (prerendered, or served by an older server) keeps the awaited fetch.
 */

/** Key under `nuxtApp.payload` that carries the overlay. */
export const RUNTIME_PUBLIC_PAYLOAD_KEY = 'runtimePublic'

/**
 * Embedded values older than this are applied at once and then refreshed from
 * `/api/runtime/public` in the background, so cached HTML cannot hold an old
 * overlay for longer than one request.
 */
export const RUNTIME_PUBLIC_REFRESH_AFTER_MS = 60_000

export interface EmbeddedRuntimePublic {
  /** `Date.now()` on the server when it resolved the overlay. */
  at: number
  values: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The overlay a live SSR response embedded, or `null` when the HTML carries
 * none that can be trusted: absent, malformed, or from a prerendered page
 * (`prerenderedAt` is set), whose values would be the build's, not the Worker's.
 */
export function readEmbeddedRuntimePublic(
  payload: Record<string, unknown>,
): EmbeddedRuntimePublic | null {
  if (payload.prerenderedAt) return null
  const embedded = payload[RUNTIME_PUBLIC_PAYLOAD_KEY]
  if (!isRecord(embedded) || !isRecord(embedded.values)) return null
  const at = typeof embedded.at === 'number' && Number.isFinite(embedded.at) ? embedded.at : 0
  return { at, values: embedded.values }
}

/** True when `at` is far enough from `now` that the overlay should be re-read. */
export function isRuntimePublicStale(at: number, now: number): boolean {
  return Math.abs(now - at) > RUNTIME_PUBLIC_REFRESH_AFTER_MS
}
