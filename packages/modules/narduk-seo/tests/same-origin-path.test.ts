import { describe, expect, it } from 'vitest'

import { sanitizeSameOriginPath } from '../app/utils/same-origin-path'

const FALLBACK = '/'

describe('sanitizeSameOriginPath', () => {
  it('accepts an absolute same-origin path and preserves query and hash', () => {
    expect(sanitizeSameOriginPath('/q/atlas?mode=scan#results', FALLBACK)).toBe(
      '/q/atlas?mode=scan#results',
    )
    expect(sanitizeSameOriginPath('/', FALLBACK)).toBe('/')
    expect(sanitizeSameOriginPath('/path?q=1', FALLBACK)).toBe('/path?q=1')
  })

  it('rejects an absolute URL to another origin', () => {
    expect(sanitizeSameOriginPath('https://example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('https://example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a protocol-relative authority', () => {
    expect(sanitizeSameOriginPath('//example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('  //example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('//attacker.example', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a literal backslash anywhere in the path', () => {
    expect(sanitizeSameOriginPath('/\\example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/safe/\\/example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('\\attacker.example', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a percent-encoded backslash', () => {
    expect(sanitizeSameOriginPath('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/%5C%5Cexample.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/%5cattacker', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a bare value instead of coercing it into a path', () => {
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

  it('rejects malformed percent-encoding', () => {
    expect(sanitizeSameOriginPath('/%zz', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/%', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/ok%', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/a%2', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('/caf%C3%A9', FALLBACK)).toBe('/caf%C3%A9')
  })

  it('rejects a non-string value instead of throwing or coercing', () => {
    expect(sanitizeSameOriginPath(undefined, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath(null, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath('', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath(['/ok'], FALLBACK)).toBe(FALLBACK)
    expect(sanitizeSameOriginPath({ toString: () => '/ok' }, FALLBACK)).toBe(FALLBACK)
  })
})
