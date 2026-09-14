/**
 * Low-level IPv4/IPv6 special-use and private range checks for SSRF prevention.
 * Extracted for unit tests and a smaller `urlValidator` entrypoint.
 */

/**
 * Check whether an IPv4 address is non-global-unicast.
 *
 * For SSRF protection we reject every IANA-reserved / special-use IPv4 block,
 * not just RFC1918. That includes shared CGNAT space (100.64.0.0/10),
 * benchmarking (198.18.0.0/15), documentation/test networks, multicast, and
 * the reserved 240.0.0.0/4 range. Allowing any of these would let attackers
 * target non-routable internal address space through the fetcher.
 */
export function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // treat invalid as private to be conservative
  }

  const [a = 0, b = 0, c = 0, d = 0] = octets
  // Encode the address as a single 32-bit unsigned integer so range checks
  // become simple numeric comparisons rather than nested octet tests.
  const ipv4 = (((a * 256 + b) * 256 + c) * 256 + d) >>> 0
  const inRange = (start: number, end: number) => ipv4 >= start && ipv4 <= end

  if (ipv4 === 0xc0000009 || ipv4 === 0xc000000a) return false

  if (inRange(0x00000000, 0x00ffffff)) return true // 0.0.0.0/8 — "this network"
  if (inRange(0x0a000000, 0x0affffff)) return true // 10.0.0.0/8 — RFC1918
  if (inRange(0x64400000, 0x647fffff)) return true // 100.64.0.0/10 — CGNAT (RFC6598)
  if (inRange(0x7f000000, 0x7fffffff)) return true // 127.0.0.0/8 — loopback
  if (inRange(0xa9fe0000, 0xa9feffff)) return true // 169.254.0.0/16 — link-local
  if (inRange(0xac100000, 0xac1fffff)) return true // 172.16.0.0/12 — RFC1918
  if (inRange(0xc0000000, 0xc00000ff)) return true // 192.0.0.0/24 — IETF protocol
  if (inRange(0xc0000200, 0xc00002ff)) return true // 192.0.2.0/24 — TEST-NET-1
  if (inRange(0xc0586300, 0xc05863ff)) return true // 192.88.99.0/24 — 6to4 anycast (deprecated)
  if (inRange(0xc0a80000, 0xc0a8ffff)) return true // 192.168.0.0/16 — RFC1918
  if (inRange(0xc6120000, 0xc613ffff)) return true // 198.18.0.0/15 — benchmarking
  if (inRange(0xc6336400, 0xc63364ff)) return true // 198.51.100.0/24 — TEST-NET-2
  if (inRange(0xcb007100, 0xcb0071ff)) return true // 203.0.113.0/24 — TEST-NET-3
  if (inRange(0xe0000000, 0xefffffff)) return true // 224.0.0.0/4 — multicast
  if (inRange(0xf0000000, 0xffffffff)) return true // 240.0.0.0/4 — reserved + broadcast

  return false
}

/** @internal Exported for focused SSRF range tests; production callers use `isPrivateIPv6`. */
export function isLinkLocalIPv6Hextet(normalized: string): boolean {
  const firstGroup = normalized.split(':', 1)[0]
  if (!firstGroup) return false
  const value = Number.parseInt(firstGroup, 16)
  if (!Number.isFinite(value)) return false
  return value >= 0xfe80 && value <= 0xfebf
}

/**
 * Check whether an IPv6 address is private/link-local/ULA/loopback.
 */
export function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (isLinkLocalIPv6Hextet(normalized)) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // ULA
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.replace('::ffff:', '')
    return isPrivateIPv4(mapped)
  }
  return false
}

/**
 * Strip the `[...]` wrapper from bracketed IPv6 URL hostnames.
 */
export function stripIPv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}
