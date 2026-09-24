import { describe, expect, it } from 'vitest'

import {
  RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS,
  rateLimitNamespaceId,
  rateLimitNamespacePrefix,
} from '../runtime/shared/rate-limit-namespace'

/**
 * narduk-libs#433 B: Cloudflare `ratelimits[].namespace_id` is unique per
 * account, not per Worker, so a pasted example id shares counters with every
 * other Worker that pasted it.
 */
describe('rateLimitNamespacePrefix', () => {
  it('is a stable five-digit decimal in 10000-49999', () => {
    for (const name of ['buoys', 'riverstatus', 'float-forecast', 'ogpreview-app', 'a']) {
      const prefix = rateLimitNamespacePrefix(name)
      expect(prefix).toMatch(/^\d{5}$/)
      expect(Number(prefix)).toBeGreaterThanOrEqual(10000)
      expect(Number(prefix)).toBeLessThanOrEqual(49999)
      expect(rateLimitNamespacePrefix(name)).toBe(prefix)
    }
  })

  it('gives different Worker names different prefixes', () => {
    expect(rateLimitNamespacePrefix('riverstatus')).not.toBe(rateLimitNamespacePrefix('buoys'))
  })

  it('is FNV-1a 32-bit of the UTF-8 name, reduced into the band', () => {
    // FNV-1a("a") = 0xe40c292c = 3826002220; 3826002220 % 40000 = 2220.
    expect(rateLimitNamespacePrefix('a')).toBe('12220')
  })

  it('refuses an empty Worker name', () => {
    expect(() => rateLimitNamespacePrefix('')).toThrow(TypeError)
  })
})

describe('rateLimitNamespaceId', () => {
  it('appends the per-minute limit, padded to three digits', () => {
    const prefix = rateLimitNamespacePrefix('riverstatus')
    expect(rateLimitNamespaceId('riverstatus', 120)).toBe(`${prefix}120`)
    expect(rateLimitNamespaceId('riverstatus', 60)).toBe(`${prefix}060`)
    expect(rateLimitNamespaceId('riverstatus', 600)).toBe(`${prefix}600`)
    expect(rateLimitNamespaceId('riverstatus', 60)).not.toBe(
      rateLimitNamespaceId('riverstatus', 600),
    )
  })

  it('never produces a known scaffold default', () => {
    for (const name of ['buoys', 'riverstatus', 'float-forecast', 'ogpreview-app']) {
      for (const limit of [10, 60, 110, 120, 121, 300]) {
        expect(RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS).not.toContain(rateLimitNamespaceId(name, limit))
      }
    }
  })

  it('refuses a limit that is not a positive integer', () => {
    expect(() => rateLimitNamespaceId('riverstatus', 0)).toThrow(TypeError)
    expect(() => rateLimitNamespaceId('riverstatus', 1.5)).toThrow(TypeError)
  })
})
