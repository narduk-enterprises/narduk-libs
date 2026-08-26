import { describe, expect, it } from 'vitest'

import { resolveLoginSubtitle } from '../app/utils/loginCopy'

describe('login copy', () => {
  it('describes email-only authentication without mentioning Apple', () => {
    expect(resolveLoginSubtitle(false)).toBe('Sign in with your email and password.')
  })

  it('describes Apple when that provider is available', () => {
    expect(resolveLoginSubtitle(true)).toBe('Sign in with Apple first, or use email if you prefer.')
  })

  it('preserves an app-provided subtitle', () => {
    expect(resolveLoginSubtitle(false, 'Use your family account.')).toBe('Use your family account.')
  })
})
