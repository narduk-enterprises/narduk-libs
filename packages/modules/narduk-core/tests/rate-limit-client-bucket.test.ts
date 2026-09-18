import { describe, expect, it } from 'vitest'

import { rateLimitClientBucket } from '../runtime/server/rate-limit/client-bucket'
import { rateLimitCounterKey, resolveRoutePolicy } from '../runtime/server/rate-limit/policy'

/**
 * narduk-libs#430: an IPv6 client that rotates addresses inside one /64
 * (privacy extensions, or a prefix it controls) must not get a fresh window
 * per address. IPv4 is left exactly as it was.
 */
describe('rateLimitClientBucket', () => {
  it.each([
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::2', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::abcd', '2001:db8:1:2::/64'],
    ['[2001:db8:1:2::9]', '2001:db8:1:2::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
  ])('collapses %s to its /64', (address, bucket) => {
    expect(rateLimitClientBucket(address)).toBe(bucket)
  })

  it('keeps a different /64 in a different bucket', () => {
    expect(rateLimitClientBucket('2001:db8:1:3::1')).not.toBe(
      rateLimitClientBucket('2001:db8:1:2::1'),
    )
  })

  it('leaves IPv4 untouched', () => {
    expect(rateLimitClientBucket('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitClientBucket(' 198.51.100.7 ')).toBe('198.51.100.7')
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 address it carries', () => {
    expect(rateLimitClientBucket('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitClientBucket('::ffff:cb00:7109')).toBe('203.0.113.9')
  })

  it('passes an unparseable value through rather than inventing a bucket', () => {
    expect(rateLimitClientBucket('not-an-ip')).toBe('not-an-ip')
    expect(rateLimitClientBucket('1:2:3')).toBe('1:2:3')
  })
})

describe('rateLimitCounterKey — IPv6 aggregation', () => {
  const ip = resolveRoutePolicy({ key: 'k' }, undefined)
  const ipPath = resolveRoutePolicy({ key: 'k', scope: 'ip-path' }, undefined)

  it('shares one ip-scope counter across a /64', () => {
    expect(rateLimitCounterKey(ip, '2001:db8:1:2::1', '/a')).toBe(
      rateLimitCounterKey(ip, '2001:db8:1:2::2', '/a'),
    )
    expect(rateLimitCounterKey(ip, '2001:db8:1:2::1', '/a')).toBe('k:2001:db8:1:2::/64')
  })

  it('shares one ip-path counter across a /64 on the same path', () => {
    expect(rateLimitCounterKey(ipPath, '2001:db8:1:2::1', '/a')).toBe(
      rateLimitCounterKey(ipPath, '2001:db8:1:2::ff', '/a'),
    )
  })

  it('keeps the IPv4 key byte-for-byte what it was', () => {
    expect(rateLimitCounterKey(ip, '203.0.113.9', '/a')).toBe('k:203.0.113.9')
  })
})

/**
 * narduk-libs#433: a route matched by the router cannot escape its ip-path
 * bucket through a trailing slash, a query string, or a percent-encoded
 * spelling of the same path.
 */
describe('rateLimitCounterKey — ip-path path normalization', () => {
  const ipPath = resolveRoutePolicy({ key: 'k', scope: 'ip-path' }, undefined)
  const base = rateLimitCounterKey(ipPath, '203.0.113.9', '/api/mapkit-token')

  it.each([
    '/api/mapkit-token/',
    '/api/mapkit-token?x=1',
    '/api/mapkit-token/?x=1',
    '/api/mapkit-%74oken',
  ])('%s shares the bucket of the bare path', (variant) => {
    expect(rateLimitCounterKey(ipPath, '203.0.113.9', variant)).toBe(base)
  })

  it('keeps a genuinely different path in its own bucket', () => {
    expect(rateLimitCounterKey(ipPath, '203.0.113.9', '/api/other')).not.toBe(base)
  })

  it('does not throw on a malformed percent escape', () => {
    expect(() => rateLimitCounterKey(ipPath, '203.0.113.9', '/api/%E0%A4%A')).not.toThrow()
  })
})
