import { getRequestHeader, getRequestIP } from 'h3'

import type { H3Event } from 'h3'

/**
 * The header Cloudflare sets to the connecting client's address on every request that reaches a
 * Worker. The edge sets it; a client cannot choose it.
 */
export const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip'

/**
 * The header Fly.io's proxy sets to the connecting client's address on every request that reaches
 * an app machine through the proxy. The proxy sets it itself; a client cannot choose it.
 */
export const FLY_CLIENT_IP_HEADER = 'fly-client-ip'

export interface ClientIpOptions {
  /**
   * Declare the Fly.io proxy as this app's edge: read `fly-client-ip` (set by the proxy) and
   * ignore `cf-connecting-ip`.
   *
   * Off by default. Turn it on only for an app that is *not* behind Cloudflare and is reachable
   * only through the Fly proxy. Without Cloudflare in front, nothing overwrites
   * `cf-connecting-ip`, so a client could send it and pick its own address; with this option it is
   * never read. Behind Cloudflare, leave it off: `fly-client-ip` would then be the Cloudflare
   * edge's address. It replaces `trustForwardedFor` on Fly, whose first entry is client-chosen.
   */
  trustFlyClientIp?: boolean

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
 * Order: with `trustFlyClientIp`, `fly-client-ip` (and `cf-connecting-ip` is not read); otherwise
 * `cf-connecting-ip`. Then, only if `trustForwardedFor` is set, the first `x-forwarded-for` entry;
 * then whatever h3's `getRequestIP` knows without consulting `x-forwarded-for`
 * (`event.context.clientAddress`, then the socket). `undefined` when none of those is present, so a caller can decline to key anything on an address rather than key it on
 * an empty string or a placeholder.
 *
 * h3's own `getRequestIP` never reads the Cloudflare header, and with `xForwardedFor: true` it
 * trusts the first forwarded entry — the combination that let a consuming app's per-IP lockout be
 * defeated by rotating one request header (mybo-at-v2#30 review).
 */
export function getClientIp(event: H3Event, options: ClientIpOptions = {}): string | undefined {
  const edgeHeader = options.trustFlyClientIp ? FLY_CLIENT_IP_HEADER : CF_CONNECTING_IP_HEADER
  const edge = getRequestHeader(event, edgeHeader)?.trim()
  if (edge) return edge
  if (options.trustForwardedFor) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return getRequestIP(event) || undefined
}
