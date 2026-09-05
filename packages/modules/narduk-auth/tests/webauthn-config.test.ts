import { describe, expect, it } from 'vitest'

import {
  isOriginBoundToRpId,
  resolveWebauthnConfig,
  WEBAUTHN_CHALLENGE_TTL_DEFAULT_SECONDS,
  WEBAUTHN_CHALLENGE_TTL_MAX_SECONDS,
  WEBAUTHN_CHALLENGE_TTL_MIN_SECONDS,
} from '../shared/utils/webauthn-config'

const enabledInput = {
  authBackend: 'local',
  authProviders: ['email', 'passkey'],
  env: {
    AUTH_WEBAUTHN_RP_ID: 'ops.nardukenterprises.com',
    AUTH_WEBAUTHN_ORIGIN: 'https://ops.nardukenterprises.com',
  } as Record<string, string | undefined>,
}

function resolveWith(env: Record<string, string | undefined>) {
  return resolveWebauthnConfig({ ...enabledInput, env: { ...enabledInput.env, ...env } })
}

describe('resolveWebauthnConfig gating', () => {
  it('resolves a complete configuration', () => {
    const config = resolveWebauthnConfig(enabledInput)
    expect(config).toMatchObject({
      enabled: true,
      rpId: 'ops.nardukenterprises.com',
      origins: ['https://ops.nardukenterprises.com'],
      challengeTtlSeconds: WEBAUTHN_CHALLENGE_TTL_DEFAULT_SECONDS,
    })
  })

  it('is disabled on the Supabase backend', () => {
    expect(resolveWebauthnConfig({ ...enabledInput, authBackend: 'supabase' })).toEqual({
      enabled: false,
      reason: 'backend-not-local',
    })
  })

  it('is disabled until `passkey` is opted into via AUTH_LOCAL_PROVIDERS', () => {
    expect(resolveWebauthnConfig({ ...enabledInput, authProviders: ['email'] })).toEqual({
      enabled: false,
      reason: 'provider-not-enabled',
    })
  })

  it('fails closed when the Relying Party ID or origin is missing', () => {
    expect(resolveWith({ AUTH_WEBAUTHN_RP_ID: undefined })).toEqual({
      enabled: false,
      reason: 'missing-rp-id',
    })
    expect(resolveWith({ AUTH_WEBAUTHN_ORIGIN: undefined })).toEqual({
      enabled: false,
      reason: 'missing-origin',
    })
    expect(resolveWith({ AUTH_WEBAUTHN_ORIGIN: '   ' })).toEqual({
      enabled: false,
      reason: 'missing-origin',
    })
  })

  it('refuses an RP ID that is not a registrable domain', () => {
    for (const rpId of [
      'https://ops.nardukenterprises.com',
      'ops.nardukenterprises.com:8443',
      'com',
      '192.168.1.10',
      '*.nardukenterprises.com',
      'ops.nardukenterprises.com.',
      'ops.nardukenterprises.com/path',
    ]) {
      expect(resolveWith({ AUTH_WEBAUTHN_RP_ID: rpId })).toEqual({
        enabled: false,
        reason: 'invalid-rp-id',
      })
    }
  })

  it('refuses an origin that is not bound to the RP ID', () => {
    // The classic phishing shape: an attacker-controlled host that merely
    // *contains* the RP ID rather than being a subdomain of it.
    for (const origin of [
      'https://ops.nardukenterprises.com.evil.test',
      'https://evil.test',
      'https://nardukenterprises.com',
      'https://xops.nardukenterprises.com',
    ]) {
      expect(resolveWith({ AUTH_WEBAUTHN_ORIGIN: origin })).toEqual({
        enabled: false,
        reason: 'origin-not-bound-to-rp-id',
      })
    }
  })

  it('refuses a plaintext origin except on localhost', () => {
    expect(resolveWith({ AUTH_WEBAUTHN_ORIGIN: 'http://ops.nardukenterprises.com' })).toEqual({
      enabled: false,
      reason: 'origin-not-bound-to-rp-id',
    })
    expect(
      resolveWebauthnConfig({
        ...enabledInput,
        env: {
          AUTH_WEBAUTHN_RP_ID: 'localhost',
          AUTH_WEBAUTHN_ORIGIN: 'http://localhost:3000',
        },
      }),
    ).toMatchObject({ enabled: true, rpId: 'localhost' })
  })

  it('accepts multiple origins and a subdomain of the RP ID', () => {
    const config = resolveWebauthnConfig({
      ...enabledInput,
      env: {
        AUTH_WEBAUTHN_RP_ID: 'nardukenterprises.com',
        AUTH_WEBAUTHN_ORIGIN:
          'https://ops.nardukenterprises.com, https://staging.ops.nardukenterprises.com',
      },
    })
    expect(config).toMatchObject({
      enabled: true,
      origins: ['https://ops.nardukenterprises.com', 'https://staging.ops.nardukenterprises.com'],
    })
  })

  it('rejects an origin carrying a path, query or fragment', () => {
    for (const origin of [
      'https://ops.nardukenterprises.com/login',
      'https://ops.nardukenterprises.com?a=1',
      'https://ops.nardukenterprises.com#x',
      'not-a-url',
    ]) {
      expect(resolveWith({ AUTH_WEBAUTHN_ORIGIN: origin })).toEqual({
        enabled: false,
        reason: 'invalid-origin',
      })
    }
  })

  it('clamps the challenge TTL into its bounded range', () => {
    expect(resolveWith({ AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS: '1' })).toMatchObject({
      challengeTtlSeconds: WEBAUTHN_CHALLENGE_TTL_MIN_SECONDS,
    })
    expect(resolveWith({ AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS: '99999' })).toMatchObject({
      challengeTtlSeconds: WEBAUTHN_CHALLENGE_TTL_MAX_SECONDS,
    })
    expect(resolveWith({ AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS: 'banana' })).toMatchObject({
      challengeTtlSeconds: WEBAUTHN_CHALLENGE_TTL_DEFAULT_SECONDS,
    })
    expect(resolveWith({ AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS: '120' })).toMatchObject({
      challengeTtlSeconds: 120,
    })
  })
})

describe('isOriginBoundToRpId', () => {
  it('accepts the RP ID host and its subdomains only', () => {
    expect(isOriginBoundToRpId('https://a.example.com', 'a.example.com')).toBe(true)
    expect(isOriginBoundToRpId('https://b.a.example.com', 'a.example.com')).toBe(true)
    expect(isOriginBoundToRpId('https://example.com', 'a.example.com')).toBe(false)
    // Suffix-only match — the bug a naive `endsWith` would ship.
    expect(isOriginBoundToRpId('https://evila.example.com', 'a.example.com')).toBe(false)
  })
})
