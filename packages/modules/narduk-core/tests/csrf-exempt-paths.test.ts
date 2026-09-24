import { describe, expect, it } from 'vitest'

import {
  csrfExemptPathError,
  isCsrfExemptPath,
  resolveCsrfExemptPaths,
} from '../runtime/shared/csrf-exempt-paths'

const CLAIM_START = '/api/edge/v1/claim/start'

/**
 * narduk-libs#239: an app declares its device-facing, credential-free POST
 * routes as CSRF-exempt through module options instead of a filename-ordered
 * middleware that fakes `X-Requested-With`.
 */
describe('csrfExemptPathError', () => {
  it.each([CLAIM_START, '/api/edge/v1/claim/handoff', '/api/devices/*', '/device-report'])(
    'accepts %s',
    (entry) => {
      expect(csrfExemptPathError(entry)).toBeNull()
    },
  )

  it.each([
    ['', 'empty'],
    ['api/edge', 'relative'],
    ['/', 'the whole site'],
    ['/*', 'the whole site by prefix'],
    ['/api', 'the whole API'],
    ['/api/', 'the whole API with a slash'],
    ['/api/*', 'the whole API by prefix'],
    ['/edge/*', 'a one-segment prefix'],
    ['/api/edge*', 'a wildcard not on a segment boundary'],
    ['/api/*/claim', 'a wildcard mid-path'],
    ['/api/edge?x=1', 'a query string'],
    ['/api/edge#frag', 'a fragment'],
    ['/api/ed%67e', 'a percent escape'],
    ['/api//edge', 'an empty segment'],
    ['/api/../edge', 'a dot segment'],
    ['/api/./edge', 'a single-dot segment'],
    ['/api/edge claim', 'whitespace'],
  ])('rejects %j (%s)', (entry) => {
    expect(csrfExemptPathError(entry)).toEqual(expect.any(String))
  })

  it('rejects a non-string entry', () => {
    expect(csrfExemptPathError(42 as unknown as string)).toEqual(expect.any(String))
  })
})

describe('resolveCsrfExemptPaths', () => {
  it('keeps only valid entries so a runtime override cannot widen the exemption', () => {
    expect(resolveCsrfExemptPaths([CLAIM_START, '/', '/api/*', 7])).toEqual([CLAIM_START])
  })

  it('treats anything that is not an array as no exemptions', () => {
    expect(resolveCsrfExemptPaths(undefined)).toEqual([])
    expect(resolveCsrfExemptPaths(CLAIM_START)).toEqual([])
  })
})

describe('isCsrfExemptPath', () => {
  const entries = [CLAIM_START, '/api/edge/v1/claim/handoff', '/api/devices/*']

  it.each([
    CLAIM_START,
    `${CLAIM_START}/`,
    `${CLAIM_START}?attempt=2`,
    '/api/edge/v1/claim/handoff',
    '/api/devices/abc/telemetry',
  ])('exempts %s', (path) => {
    expect(isCsrfExemptPath(path, entries)).toBe(true)
  })

  it.each([
    // The browser leg rides the user's session and must stay protected.
    '/api/edge/v1/claim/complete',
    '/api/edge/v1/claim/start-over',
    '/api/edge/v1/claim',
    '/api/devices',
    '/api/devicesx/abc',
    // Ambiguous spellings never earn an exemption; the router may resolve them elsewhere.
    '/api/edge/v1/claim/start/../complete',
    '/api/edge/v1/claim/%73tart',
    '/api/devices/..%2f..%2fsettings',
    '/api//devices/abc',
  ])('does not exempt %s', (path) => {
    expect(isCsrfExemptPath(path, entries)).toBe(false)
  })

  it('matches an exact entry declared with a trailing slash', () => {
    expect(isCsrfExemptPath(CLAIM_START, [`${CLAIM_START}/`])).toBe(true)
  })

  it('exempts nothing with no entries', () => {
    expect(isCsrfExemptPath(CLAIM_START, [])).toBe(false)
  })
})
