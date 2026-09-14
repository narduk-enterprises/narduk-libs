import { describe, expect, it } from 'vitest'

import { isOriginAllowed, parseUpgradeOrigin, sameOriginFor } from '../src/worker/upgrade-origin.js'

describe('parseUpgradeOrigin', () => {
  it.each([
    ['https://app.test', 'https://app.test'],
    ['HTTPS://App.Test', 'https://app.test'],
    ['https://app.test/', 'https://app.test'],
    ['  https://app.test  ', 'https://app.test'],
    ['https://app.test:8443', 'https://app.test:8443'],
    ['http://localhost:8787', 'http://localhost:8787'],
    // The default https port is not part of an origin's serialisation.
    ['https://app.test:443', 'https://app.test'],
  ])('normalises %s to %s', (value, origin) => {
    expect(parseUpgradeOrigin(value)).toEqual({ ok: true, origin })
  })

  it.each([
    ['a wildcard', '*', /wildcard/u],
    ['a wildcard subdomain', 'https://*.app.test', /wildcard/u],
    ['an empty value', '   ', /is empty/u],
    ['a bare host', 'app.test', /not an absolute origin/u],
    // `Origin: null` is what a sandboxed frame or a `file://` page sends.
    ['an opaque origin', 'null', /not an absolute origin/u],
    ['a websocket scheme', 'wss://app.test', /must be http or https/u],
    ['credentials', 'https://user:pass@app.test', /carries credentials/u],
    ['a path', 'https://app.test/live', /scheme and host only/u],
    ['a query', 'https://app.test/?x=1', /scheme and host only/u],
    ['a fragment', 'https://app.test/#x', /scheme and host only/u],
  ])('rejects %s', (_case, value, reason) => {
    const parsed = parseUpgradeOrigin(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.reason).toMatch(reason)
  })
})

describe('sameOriginFor', () => {
  it.each([
    ['app.test', 'https://app.test'],
    ['App.Test:8443', 'https://app.test:8443'],
  ])('reads %s as %s', (host, origin) => {
    expect(sameOriginFor(host)).toBe(origin)
  })
})

describe('isOriginAllowed', () => {
  // With no list, the policy is the request's own host over https: a deployed
  // Worker is always https, and accepting http would accept a stripped hop.
  it.each([
    ['https://app.test', true],
    ['HTTPS://APP.TEST', true],
    ['http://app.test', false],
    ['https://evil.test', false],
    ['https://sub.app.test', false],
    ['null', false],
    ['*', false],
  ])('same-origin default reads %s as %s', (origin, expected) => {
    expect(isOriginAllowed(origin, undefined, 'app.test')).toBe(expected)
  })

  it('uses the list instead of the default when one is given', () => {
    const allowed = new Set(['https://console.narduk.test'])

    expect(isOriginAllowed('https://console.narduk.test', allowed, 'app.test')).toBe(true)
    // The list replaces the default, which is why the README says to name your
    // own origin too when you add another.
    expect(isOriginAllowed('https://app.test', allowed, 'app.test')).toBe(false)
  })
})
