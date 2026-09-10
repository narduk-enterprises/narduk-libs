import { describe, expect, it } from 'vitest'

import {
  NARDUK_ROUTER_HEADER_PREFIX,
  PRINCIPAL_HEADER,
  principalFromRequest,
} from '../src/worker/principal.js'

function withHeader(value: string | null, header = PRINCIPAL_HEADER) {
  return { headers: { get: (name: string) => (name === header ? value : null) } }
}

describe('principalFromRequest', () => {
  it('parses the principal the router attached', () => {
    expect(
      principalFromRequest<{ role: string }>(
        withHeader(JSON.stringify({ role: 'viewer', vesselId: 'v-1' })),
      ),
    ).toEqual({ role: 'viewer', vesselId: 'v-1' })
  })

  // A Durable Object reached by any other path must see no principal rather
  // than an exception -- refusing is the object's decision, not a crash.
  it.each([
    ['an absent header', null],
    ['an empty header', ''],
    ['a non-JSON header', 'not json'],
  ])('returns undefined for %s', (_case, value) => {
    expect(principalFromRequest(withHeader(value))).toBeUndefined()
  })

  it('reads a custom header name', () => {
    expect(
      principalFromRequest(withHeader('{"a":1}', 'x-narduk-session'), 'x-narduk-session'),
    ).toEqual({
      a: 1,
    })
  })

  it('keeps the default header inside the prefix the router strips', () => {
    expect(PRINCIPAL_HEADER.startsWith(NARDUK_ROUTER_HEADER_PREFIX)).toBe(true)
  })
})
