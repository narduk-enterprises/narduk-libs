import { describe, expect, it } from 'vitest'

import { sanitizeSameOriginPath } from '../shared/utils/same-origin-path'

const FALLBACK = '/dashboard/'

/**
 * Each case below is a point where the four previous copies of this guard
 * disagreed. The consolidated guard takes the strictest behaviour any copy
 * had, so every assertion here is a rejection the loosest copy did not make.
 */
describe('sanitizeSameOriginPath — drift points between the four former copies', () => {
  it('accepts an absolute same-origin path and preserves query and hash', () => {
    expect(sanitizeSameOriginPath('/q/atlas?mode=scan#results', FALLBACK)).toBe(
      '/q/atlas?mode=scan#results',
    )
    expect(sanitizeSameOriginPath('/', FALLBACK)).toBe('/')
  })

  it('rejects an absolute URL to another origin', () => {
    // All four copies agreed here.
    expect(sanitizeSameOriginPath('https://example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('https://example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a protocol-relative authority', () => {
    // Previously only enforced indirectly, via URL origin normalization.
    expect(sanitizeSameOriginPath('//example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('  //example.com/path', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a literal backslash anywhere in the path', () => {
    expect(sanitizeSameOriginPath('/\\example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/safe/\\/example.com', FALLBACK)).toBe(FALLBACK)
  })

  it('DRIFT: rejects a percent-encoded backslash', () => {
    // `app/utils/safeRedirectPath.ts` rejected these; the three server copies
    // returned them verbatim as an accepted path.
    expect(sanitizeSameOriginPath('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/%5C%5Cexample.com', FALLBACK)).toBe(FALLBACK)
  })

  it('DRIFT: rejects a bare value instead of coercing it into a path', () => {
    // `sanitizeNextPath` / `sanitizeReturnPath` / `sanitizeLocalEmailRedirect`
    // resolved `foo` against the base origin and returned `/foo`, silently
    // promoting arbitrary input to a redirect target.
    expect(sanitizeSameOriginPath('example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('%5c%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('foo/bar', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects raw control characters that a parser might strip', () => {
    expect(sanitizeSameOriginPath('/\u0000/example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/\t/example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/\n/example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/\r/example.com', FALLBACK)).toBe(FALLBACK)
  })

  it('DRIFT: rejects malformed percent-encoding', () => {
    // `sanitizeLocalEmailRedirect` rejected these because `decodeURIComponent`
    // threw; the other three copies passed them straight through.
    expect(sanitizeSameOriginPath('/%zz', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/%', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/ok%', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/a%2', FALLBACK)).toBe(FALLBACK)
    // Well-formed encoding still passes.
    expect(sanitizeSameOriginPath('/caf%C3%A9', FALLBACK)).toBe('/caf%C3%A9')
  })

  it('DRIFT: rejects a non-string value instead of throwing or coercing', () => {
    // Only the client copy was typed to accept `unknown`; the server copies
    // took `string | null | undefined` and would have coerced anything else.
    expect(sanitizeSameOriginPath(undefined, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath(null, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath(['/ok'], FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath({ toString: () => '/ok' }, FALLBACK)).toBe(FALLBACK)
  })
})

describe('every former copy now enforces the consolidated semantics', () => {
  it('the client-side name still rejects what it always rejected', async () => {
    const { sanitizeLocalRedirectPath } = await import('../app/utils/safeRedirectPath')

    expect(sanitizeLocalRedirectPath('/q/atlas', FALLBACK)).toBe('/q/atlas')
    expect(sanitizeLocalRedirectPath('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeLocalRedirectPath('example.com', FALLBACK)).toBe(FALLBACK)
  })

  it('the server `next` guard now matches the client guard', async () => {
    const { sanitizeNextPath } = await import('../server/lib/app-auth/helpers')

    expect(sanitizeNextPath('/q/atlas', FALLBACK)).toBe('/q/atlas')
    // Both of these were previously accepted by this copy.
    expect(sanitizeNextPath('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeNextPath('example.com', FALLBACK)).toBe(FALLBACK)
  })

  it('the local-email recovery guard now matches the client guard', async () => {
    const { sanitizeLocalEmailRedirect } = await import('../server/lib/app-auth/local-email-core')

    expect(sanitizeLocalEmailRedirect('/q/atlas', FALLBACK)).toBe('/q/atlas')
    expect(sanitizeLocalEmailRedirect('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeLocalEmailRedirect('example.com', FALLBACK)).toBe(FALLBACK)
  })
})
