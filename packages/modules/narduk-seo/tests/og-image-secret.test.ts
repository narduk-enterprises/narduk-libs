import { describe, expect, it } from 'vitest'

import {
  assertOgImageSigningSecretForBuild,
  isOgImageSigningSecretConfigured,
  MISSING_OG_IMAGE_SECRET_MESSAGE,
  resolveOgImageSigningSecret,
} from '../shared/ogImageSecret'

describe('OG image signing secret', () => {
  it('treats empty, whitespace, and non-strings as unconfigured', () => {
    expect(resolveOgImageSigningSecret('')).toBe('')
    expect(resolveOgImageSigningSecret('   ')).toBe('')
    expect(resolveOgImageSigningSecret(undefined)).toBe('')
    expect(resolveOgImageSigningSecret(false)).toBe('')
    expect(isOgImageSigningSecretConfigured('')).toBe(false)
    expect(isOgImageSigningSecretConfigured('   ')).toBe(false)
    expect(isOgImageSigningSecretConfigured(undefined)).toBe(false)
  })

  it('trims a configured secret', () => {
    expect(resolveOgImageSigningSecret('  production-og-secret  ')).toBe('production-og-secret')
    expect(isOgImageSigningSecretConfigured('production-og-secret')).toBe(true)
  })

  it('fails a non-dev build when runtime OG is enabled without a secret', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).toThrow(MISSING_OG_IMAGE_SECRET_MESSAGE)
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: '   ',
      }),
    ).toThrow(/NUXT_OG_IMAGE_SECRET/u)
  })

  it('stays permissive in dev, prepare, and when runtime generation is off', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: true,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).not.toThrow()
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        isPrepare: true,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).not.toThrow()
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: false,
        secret: '',
      }),
    ).not.toThrow()
  })

  it('accepts a non-dev build when a secret is configured', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: 'production-og-secret',
      }),
    ).not.toThrow()
  })
})
