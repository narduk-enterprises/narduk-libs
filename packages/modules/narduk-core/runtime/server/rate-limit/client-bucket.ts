/**
 * The client identity a rate-limit counter is keyed on.
 *
 * An IPv6 host is normally handed a whole /64, and privacy extensions (RFC
 * 8981) rotate the low 64 bits on their own — so keying on the full address
 * gives one caller a fresh window per address (narduk-libs#430). The limiter
 * therefore counts an IPv6 caller by its /64. IPv4 is left exactly as it was:
 * shared-CGNAT unfairness on v4 is an accepted trade-off, not this bug.
 *
 * Only the limiter bucket collapses. `getClientIp` still returns the full
 * address, because audit rows and approximate location need it.
 */

import { parseIPv6Hextets } from '../utils/ssrfHostIpPolicy'

const IPV6_PREFIX_HEXTETS = 4

export function rateLimitClientBucket(address: string): string {
  const trimmed = address.trim()
  if (!trimmed.includes(':')) return trimmed

  const hextets = parseIPv6Hextets(trimmed)
  // An unparseable value is passed through: it is still a stable key for the
  // same caller, and inventing a shared bucket for garbage would be a new bug.
  if (!hextets) return trimmed.toLowerCase()

  // `::ffff:a.b.c.d` is an IPv4 client seen through a dual-stack socket; count
  // it with the IPv4 spelling of the same caller.
  if (hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff) {
    const high = hextets[6] ?? 0
    const low = hextets[7] ?? 0
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
  }

  const prefix = hextets
    .slice(0, IPV6_PREFIX_HEXTETS)
    .map((hextet) => hextet.toString(16))
    .join(':')
  return `${prefix}::/64`
}
