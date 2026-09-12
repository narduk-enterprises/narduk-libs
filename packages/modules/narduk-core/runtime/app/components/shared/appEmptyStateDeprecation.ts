/**
 * One-time, dev-only pointer from the deprecated `AppEmptyState` to
 * `NeStatePanel`. D4 (Logan 2026-09-11): deprecate now, remove in the next
 * narduk-core major (narduk-libs#254). The empty-state markup itself is
 * unchanged; this is the only new runtime behaviour.
 */

export const APP_EMPTY_STATE_DEPRECATION_MESSAGE =
  '[narduk-core] AppEmptyState is deprecated and will be removed in the next major. Use NeStatePanel from @narduk-enterprises/narduk-shell (currently pre-1.0) instead (narduk-libs#254).'

let warned = false

/**
 * Emit the deprecation once per process, and only in development. Production
 * stays silent so a patch release does not fill app logs.
 */
export function warnAppEmptyStateDeprecated(isDev = import.meta.dev): void {
  if (!isDev || warned) return
  warned = true
  console.warn(APP_EMPTY_STATE_DEPRECATION_MESSAGE)
}
