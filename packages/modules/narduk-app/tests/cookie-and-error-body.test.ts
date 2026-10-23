import { describe, expect, it } from 'vitest'

import { apiErrorMessage, describeApiError } from '../src/client/api-error'
import { readAppCookie } from '../src/server/http'

const ev = (cookie: string) => ({ node: { req: { headers: { cookie } } } }) as never

describe('ponytail5 s2 #12 non-string message', () => {
  it('apiErrorMessage falls back', () => {
    expect(
      apiErrorMessage({ data: { message: ['name is required'], statusCode: 400 } }, 'Try again.'),
    ).toBe('Try again.')
  })
  it('describeApiError does not throw', () => {
    expect(() => describeApiError({ data: { message: ['x'], statusCode: 400 } }, 'p')).not.toThrow()
  })
})

describe('ponytail5 s2 #13 cookies', () => {
  it('first duplicate wins', () => {
    expect(readAppCookie(ev('a=first; a=second'), 'a')).toBe('first')
  })
  it('no prototype leak', () => {
    expect(readAppCookie(ev('a=1'), 'toString')).toBeUndefined()
  })
  it('strips quotes', () => {
    expect(readAppCookie(ev('s="abc"'), 's')).toBe('abc')
  })
})
