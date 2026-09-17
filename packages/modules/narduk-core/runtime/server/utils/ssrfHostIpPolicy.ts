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

const HEXTETS_PER_ADDRESS = 8
const BITS_PER_HEXTET = 16

/**
 * Expand an IPv6 literal to eight 16-bit hextets.
 *
 * `URL` rewrites a dotted-quad tail (`::127.0.0.1`) into hex (`::7f00:1`)
 * before this checker runs, so every later range test must be numeric — string
 * prefix matching cannot see the embedded IPv4. Invalid input, including more
 * than one `::`, a non-final IPv4 tail, or a hextet wider than 16 bits,
 * returns `null` so the caller can fail closed.
 */
function parseIPv6Hextets(address: string): number[] | null {
  let input = stripIPv6Brackets(address.trim())
  const zone = input.indexOf('%')
  if (zone !== -1) {
    input = input.slice(0, zone)
  }
  input = input.toLowerCase()
  if (!input || input.includes(':::')) return null

  const halves = input.split('::')
  if (halves.length > 2) return null

  const parseHalf = (half: string): number[] | null => {
    if (half === '') return []
    const groups = half.split(':')
    const hextets: number[] = []
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      if (!group) return null
      if (group.includes('.')) {
        if (i !== groups.length - 1) return null
        const embedded = parseIPv4Tail(group)
        if (!embedded) return null
        hextets.push(embedded[0], embedded[1])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null
      hextets.push(Number.parseInt(group, 16))
    }
    return hextets
  }

  if (halves.length === 1) {
    const hextets = parseHalf(halves[0] ?? '')
    return hextets?.length === HEXTETS_PER_ADDRESS ? hextets : null
  }

  const head = parseHalf(halves[0] ?? '')
  const tail = parseHalf(halves[1] ?? '')
  if (!head || !tail) return null
  const missing = HEXTETS_PER_ADDRESS - head.length - tail.length
  // `::` stands for one or more zero hextets (RFC 4291).
  if (missing < 1) return null
  return [...head, ...Array<number>(missing).fill(0), ...tail]
}

/**
 * Parse a dotted-quad IPv4 tail into two hextets. Leading zeros are accepted
 * the same way `Number` parses them so a URL-normalized or verbose tail still
 * decodes; the resulting integer pair is always in 0..255 per octet.
 */
function parseIPv4Tail(address: string): [number, number] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return null
    octets.push(value)
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets
  return [(a << 8) | b, (c << 8) | d]
}

function hextetsToIPv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

function matchesPrefix(
  hextets: readonly number[],
  prefixBits: number,
  prefix: readonly number[],
): boolean {
  let remaining = prefixBits
  let index = 0
  while (remaining > 0) {
    const width = Math.min(BITS_PER_HEXTET, remaining)
    const mask = (0xffff << (BITS_PER_HEXTET - width)) & 0xffff
    const expected = (prefix[index] ?? 0) & mask
    const actual = (hextets[index] ?? 0) & mask
    if (actual !== expected) return false
    remaining -= width
    index += 1
  }
  return true
}

function lastHextetPair(hextets: readonly number[]): [number, number] {
  return [hextets[6] ?? 0, hextets[7] ?? 0]
}

function isPrivateEmbeddedIPv4(hextets: readonly number[]): boolean {
  const [hi, lo] = lastHextetPair(hextets)
  return isPrivateIPv4(hextetsToIPv4(hi, lo))
}

/**
 * IANA special-use / non-global-unicast prefixes rejected outright. Embedded-
 * IPv4 prefixes (`::/96`, `::ffff:0:0/96`, `::ffff:0:0:0/96`, `64:ff9b::/96`)
 * are handled separately so a public IPv4 payload can still pass.
 *
 * 2001::/23 covers Teredo, benchmarking, ORCHID(v2), AMT, and the other IETF
 * protocol assignments; 6to4 is rejected as a whole /16 because the relay
 * protocol is itself an SSRF primitive.
 */
const REJECT_PREFIXES: ReadonlyArray<{ bits: number; prefix: readonly number[] }> = [
  { bits: 48, prefix: [0x0064, 0xff9b, 0x0001] }, // 64:ff9b:1::/48 — local-use NAT64
  { bits: 64, prefix: [0x0100, 0x0000, 0x0000, 0x0000] }, // 100::/64 — discard-only
  { bits: 64, prefix: [0x0100, 0x0000, 0x0000, 0x0001] }, // 100:0:0:1::/64 — dummy
  { bits: 23, prefix: [0x2001] }, // 2001::/23 — IETF protocol assignments
  { bits: 32, prefix: [0x2001, 0x0db8] }, // 2001:db8::/32 — documentation
  { bits: 16, prefix: [0x2002] }, // 2002::/16 — 6to4
  { bits: 48, prefix: [0x2620, 0x004f, 0x8000] }, // 2620:4f:8000::/48 — AS112
  { bits: 20, prefix: [0x3fff] }, // 3fff::/20 — documentation (RFC 9637)
  { bits: 16, prefix: [0x5f00] }, // 5f00::/16 — SRv6 SIDs
  { bits: 7, prefix: [0xfc00] }, // fc00::/7 — unique-local
  { bits: 10, prefix: [0xfe80] }, // fe80::/10 — link-local
  { bits: 8, prefix: [0xff00] }, // ff00::/8 — multicast
]

/**
 * Check whether an IPv6 address is not global unicast.
 *
 * Fail closed: unparseable input is treated as private. Embedded IPv4 (IPv4-
 * compatible `::a.b.c.d`, IPv4-mapped `::ffff:a.b.c.d`, IPv4-translated
 * `::ffff:0:a.b.c.d`, and well-known NAT64 `64:ff9b::/96`) is decoded from the
 * low 32 bits — including the hex form `URL` emits (`::7f00:1`,
 * `::ffff:5db8:d822`) — and delegated to `isPrivateIPv4`. That both blocks
 * loopback/unspecified smuggled through those prefixes and unblocks a genuine
 * public IPv4-mapped host, which the previous `::ffff:` string strip wrongly
 * handed to `isPrivateIPv4` as hex.
 */
export function isPrivateIPv6(address: string): boolean {
  const hextets = parseIPv6Hextets(address)
  if (!hextets) return true

  // IPv4-mapped ::ffff:0:0/96
  if (matchesPrefix(hextets, 96, [0, 0, 0, 0, 0, 0xffff])) {
    return isPrivateEmbeddedIPv4(hextets)
  }
  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765)
  if (matchesPrefix(hextets, 96, [0, 0, 0, 0, 0xffff, 0])) {
    return isPrivateEmbeddedIPv4(hextets)
  }
  // Well-known NAT64 64:ff9b::/96
  if (matchesPrefix(hextets, 96, [0x0064, 0xff9b, 0, 0, 0, 0])) {
    return isPrivateEmbeddedIPv4(hextets)
  }
  // IPv4-compatible ::/96 (covers ::, ::1, and ::a.b.c.d / ::7f00:1)
  if (matchesPrefix(hextets, 96, [0, 0, 0, 0, 0, 0])) {
    return isPrivateEmbeddedIPv4(hextets)
  }

  if (REJECT_PREFIXES.some(({ bits, prefix }) => matchesPrefix(hextets, bits, prefix))) {
    return true
  }

  // Global unicast is 2000::/3. Everything else is reserved, including
  // deprecated site-local fec0::/10.
  if (!matchesPrefix(hextets, 3, [0x2000])) return true

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
