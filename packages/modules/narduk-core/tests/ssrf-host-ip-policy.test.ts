import { describe, expect, it } from 'vitest'

import { isPrivateIPv6, stripIPv6Brackets } from '../runtime/server/utils/ssrfHostIpPolicy'

/**
 * Cases `isPrivateIPv6` must get right. The first block is the orchestrator's
 * confirmed P0 table: `URL` rewrites a dotted-quad tail into hex hextets
 * (`::127.0.0.1` → `::7f00:1`), so both spellings are listed.
 */
const CASES: Array<[address: string, isPrivate: boolean, reason: string]> = [
  // Orchestrator table — IPv4-compatible loopback (was wrongly allowed)
  ['::127.0.0.1', true, 'IPv4-compatible loopback dotted-quad'],
  ['::7f00:1', true, 'IPv4-compatible loopback, URL-normalized hex'],
  ['[::7f00:1]', true, 'bracketed URL hostname for ::127.0.0.1'],

  // Orchestrator table — unspecified (was wrongly allowed)
  ['::', true, 'unspecified'],
  ['::0', true, 'unspecified written as ::0'],
  ['[::]', true, 'bracketed unspecified hostname'],

  // Orchestrator table — NAT64 loopback (was wrongly allowed)
  ['64:ff9b::127.0.0.1', true, 'NAT64 well-known prefix + loopback'],
  ['64:ff9b::7f00:1', true, 'NAT64 loopback, URL-normalized hex'],
  ['[64:ff9b::7f00:1]', true, 'bracketed NAT64 loopback hostname'],

  // Orchestrator table — public IPv4-mapped (was wrongly blocked)
  ['::ffff:93.184.216.34', false, 'IPv4-mapped public dotted-quad'],
  ['::ffff:5db8:d822', false, 'IPv4-mapped public, URL-normalized hex'],
  ['[::ffff:5db8:d822]', false, 'bracketed IPv4-mapped public hostname'],

  // Compressed / uppercase / zone-id forms of the same verdicts
  ['::FFFF:5DB8:D822', false, 'uppercase mapped public'],
  ['::FFFF:93.184.216.34', false, 'uppercase mapped public dotted-quad'],
  ['::FFFF:7F00:1', true, 'uppercase mapped loopback hex'],
  ['FE80::1', true, 'uppercase link-local'],
  ['fe80::1%eth0', true, 'link-local with zone id'],
  ['fe80::1%1', true, 'link-local with numeric zone id'],
  ['FC00::1', true, 'uppercase ULA fc'],
  ['FD12:3456:789A::1', true, 'uppercase ULA fd'],
  ['64:FF9B::7F00:1', true, 'uppercase NAT64 loopback'],

  // Existing correct behavior that must keep working
  ['::1', true, 'loopback'],
  ['0:0:0:0:0:0:0:1', true, 'expanded loopback'],
  ['fe80::1', true, 'link-local'],
  ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true, 'top of fe80::/10'],
  ['fec0::1', true, 'deprecated site-local, outside GUA'],
  ['fc00::1', true, 'ULA fc00::/7'],
  ['fd00::1', true, 'ULA fd00::/8'],
  ['::ffff:127.0.0.1', true, 'IPv4-mapped loopback dotted-quad'],
  ['::ffff:7f00:1', true, 'IPv4-mapped loopback hex'],
  ['::ffff:10.0.0.1', true, 'IPv4-mapped RFC1918'],
  ['::ffff:192.168.1.1', true, 'IPv4-mapped RFC1918 192.168'],
  ['::ffff:169.254.1.1', true, 'IPv4-mapped link-local IPv4'],
  ['::ffff:100.64.0.1', true, 'IPv4-mapped CGNAT'],

  // IPv4-translated (RFC 2765) — same decode rule as mapped
  ['::ffff:0:127.0.0.1', true, 'IPv4-translated loopback'],
  ['::ffff:0:7f00:1', true, 'IPv4-translated loopback hex'],
  ['::ffff:0:93.184.216.34', false, 'IPv4-translated public'],
  ['::ffff:0:5db8:d822', false, 'IPv4-translated public hex'],

  // NAT64 well-known vs local-use
  ['64:ff9b::8.8.8.8', false, 'NAT64 well-known + public IPv4'],
  ['64:ff9b::808:808', false, 'NAT64 well-known + public IPv4 hex'],
  ['64:ff9b:1::1', true, 'local-use NAT64 prefix'],
  ['64:ff9b:1::8.8.8.8', true, 'local-use NAT64 even with public IPv4'],

  // Other non-global-unicast space
  ['100::1', true, 'discard-only 100::/64'],
  ['100:0:0:1::1', true, 'dummy prefix 100:0:0:1::/64'],
  ['2001::1', true, 'Teredo / IETF 2001::/23'],
  ['2001:db8::1', true, 'documentation 2001:db8::/32'],
  ['2001:0DB8::1', true, 'documentation uppercase'],
  ['2002:7f00:1::1', true, '6to4 embedding 127.0.0.1'],
  ['2002:5db8:d822::1', true, '6to4 even with public IPv4'],
  ['3fff::1', true, 'documentation 3fff::/20'],
  ['5f00::1', true, 'SRv6 SIDs 5f00::/16'],
  ['ff02::1', true, 'multicast'],
  ['2620:4f:8000::1', true, 'AS112 direct-delegation'],

  // Genuinely public addresses that must remain allowed
  ['2606:4700:4700::1111', false, 'Cloudflare DNS'],
  ['2606:4700:4700:0:0:0:0:1111', false, 'Cloudflare DNS expanded'],
  ['2001:4860:4860::8888', false, 'Google DNS (outside 2001::/23)'],
  ['2620:fe::fe', false, 'Quad9 DNS'],
  ['2a00:1450:4001::1', false, 'public GUA 2a00::/16'],
  ['::ffff:1.1.1.1', false, 'IPv4-mapped Cloudflare IPv4'],
  ['::8.8.8.8', false, 'IPv4-compatible public (deprecated form)'],
  ['::808:808', false, 'IPv4-compatible public hex'],

  // Fail closed on unparseable input
  ['', true, 'empty'],
  ['not-an-ip', true, 'garbage'],
  [':::1', true, 'triple colon'],
  ['gggg::1', true, 'non-hex hextet'],
  ['1:2:3:4:5:6:7:8:9', true, 'too many hextets'],
]

describe('isPrivateIPv6', () => {
  it.each(CASES)('%s → private=%s (%s)', (address, isPrivate) => {
    expect(isPrivateIPv6(address)).toBe(isPrivate)
  })

  it('agrees with URL hostname normalization for the P0 table', () => {
    const table = [
      ['http://[::127.0.0.1]/', true],
      ['http://[::]/', true],
      ['http://[::0]/', true],
      ['http://[64:ff9b::127.0.0.1]/', true],
      ['http://[::ffff:93.184.216.34]/', false],
    ] as const

    for (const [href, isPrivate] of table) {
      const hostname = stripIPv6Brackets(new URL(href).hostname)
      expect(isPrivateIPv6(hostname), href).toBe(isPrivate)
    }
  })
})
