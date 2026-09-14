import { getRequestHeader, getRequestIP } from 'h3'

import type { H3Event } from 'h3'

/**
 * The header Cloudflare sets to the connecting client's address on every request that reaches a
 * Worker. The edge sets it; a client cannot choose it.
 */
export const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip'

export interface ClientIpOptions {
  /**
   * When `cf-connecting-ip` is absent, take the first `x-forwarded-for` entry.
   *
   * Off by default, because the first entry is whatever the client wrote unless a proxy in front
   * of the app is proven to overwrite the header. Cloudflare *appends* the real address rather
   * than overwriting, so behind Cloudflare the first entry is attacker-chosen and the Cloudflare
   * header is the one to read — which is why it is read first, unconditionally. Turn this on only
   * behind a proxy that strips or overwrites the header.
   */
  trustForwardedFor?: boolean
}

/**
 * The address to attribute this request to, for rate limits, lockouts and audit rows.
 *
 * Order: `cf-connecting-ip`; then, only if `trustForwardedFor` is set, the first
 * `x-forwarded-for` entry; then whatever h3's `getRequestIP` knows without consulting
 * `x-forwarded-for` (`event.context.clientAddress`, then the socket). `undefined` when none of
 * those is present, so a caller can decline to key anything on an address rather than key it on
 * an empty string or a placeholder.
 *
 * h3's own `getRequestIP` never reads the Cloudflare header, and with `xForwardedFor: true` it
 * trusts the first forwarded entry — the combination that let a consuming app's per-IP lockout be
 * defeated by rotating one request header (mybo-at-v2#30 review).
 */
export function getClientIp(event: H3Event, options: ClientIpOptions = {}): string | undefined {
  const cloudflare = getRequestHeader(event, CF_CONNECTING_IP_HEADER)?.trim()
  if (cloudflare) return cloudflare
  if (options.trustForwardedFor) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return getRequestIP(event) || undefined
}
