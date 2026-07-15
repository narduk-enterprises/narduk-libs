import { describe, expect, it } from 'vitest'

const { resolveLocalRedirectRequest, sanitizeLocalRedirectPath, withLocalRedirectQuery } =
  await import('../app/utils/safeRedirectPath')

const FALLBACK = '/dashboard/'

describe('safe auth redirect paths', () => {
  it('accepts local paths and rejects external or backslash paths', () => {
    expect(sanitizeLocalRedirectPath('/q/atlas?mode=scan#results', FALLBACK)).toBe(
      '/q/atlas?mode=scan#results',
    )
    expect(sanitizeLocalRedirectPath('https://example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeLocalRedirectPath('//example.com/path', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeLocalRedirectPath('/\\example.com', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeLocalRedirectPath('/%5cexample.com', FALLBACK)).toBe(FALLBACK)
  })

  it('prefers an explicit component redirect over the route query', () => {
    expect(resolveLocalRedirectRequest('/dashboard/custom', '/q/atlas', FALLBACK)).toEqual({
      path: '/dashboard/custom',
      requested: true,
    })
  })

  it('distinguishes default fallback behavior from an explicit redirect request', () => {
    expect(resolveLocalRedirectRequest(undefined, undefined, FALLBACK)).toEqual({
      path: FALLBACK,
      requested: false,
    })
    expect(resolveLocalRedirectRequest(undefined, 'https://example.com', FALLBACK)).toEqual({
      path: FALLBACK,
      requested: true,
    })
  })

  it('preserves the safe next path across auth links without adding default query noise', () => {
    const defaultRedirect = resolveLocalRedirectRequest(undefined, undefined, FALLBACK)
    const requestedRedirect = resolveLocalRedirectRequest(undefined, '/q/atlas', FALLBACK)

    expect(withLocalRedirectQuery('/register', defaultRedirect)).toBe('/register')
    expect(withLocalRedirectQuery('/register', requestedRedirect)).toEqual({
      path: '/register',
      query: { next: '/q/atlas' },
    })
    expect(
      withLocalRedirectQuery('/login', requestedRedirect, {
        checkEmail: '1',
        email: 'user@example.com',
      }),
    ).toEqual({
      path: '/login',
      query: {
        checkEmail: '1',
        email: 'user@example.com',
        next: '/q/atlas',
      },
    })
  })
})
