import type { AnalyticsTransport } from './analyticsTransport'

/** Session edges are authoritative; an initial restored session is not a new login. */
export function createAnalyticsIdentity(transport: AnalyticsTransport, appId: string) {
  let previous: string | undefined
  let initialized = false
  return (opaqueId: unknown) => {
    // Accept the opaque-id format. Callers must never pass names or credentials as an ID.
    const next =
      typeof opaqueId === 'string' && /^[\w-]{1,128}$/u.test(opaqueId) ? opaqueId : undefined
    if (initialized && previous === next) return
    if (previous) {
      transport.capture('auth_session_ended', {
        reason: next ? 'account_changed' : 'session_ended',
      })
      transport.reset()
    }
    if (next) {
      transport.identify(appId + ':' + next)
      if (initialized) transport.capture('auth_session_started', {})
    }
    initialized = true
    previous = next
  }
}
