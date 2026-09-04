import { describe, expect, it } from 'vitest'

import { resolveAuthEnvironment } from '../shared/utils/auth-environment'

describe('resolveAuthEnvironment', () => {
  describe('local backend authProviders', () => {
    it('defaults to exactly ["email"] when AUTH_LOCAL_PROVIDERS is unset', () => {
      const resolved = resolveAuthEnvironment({ AUTH_BACKEND: 'local' })
      expect(resolved.authBackend).toBe('local')
      expect(resolved.authProviders).toEqual(['email'])
    })

    it('defaults to exactly ["email"] when AUTH_LOCAL_PROVIDERS is an empty string', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: '',
      })
      expect(resolved.authProviders).toEqual(['email'])
    })

    it('advertises an explicit opt-in provider from the allowlist', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: 'passkey',
      })
      expect(resolved.authProviders).toEqual(['email', 'passkey'])
    })

    it('advertises multiple opt-in providers, trimmed and lowercased', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: ' Passkey , APPLE ',
      })
      expect(resolved.authProviders).toEqual(['email', 'passkey', 'apple'])
    })

    it('dedupes repeated opt-in provider names', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: 'passkey,passkey,apple,apple',
      })
      expect(resolved.authProviders).toEqual(['email', 'passkey', 'apple'])
    })

    it('filters out any name the package does not know as a provider', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: 'passkey,not-a-real-provider,<script>alert(1)</script>',
      })
      expect(resolved.authProviders).toEqual(['email', 'passkey'])
    })

    it('never lets an opt-in value duplicate or displace the always-on email provider', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'local',
        AUTH_LOCAL_PROVIDERS: 'email,passkey',
      })
      expect(resolved.authProviders).toEqual(['email', 'passkey'])
    })

    it('ignores AUTH_LOCAL_PROVIDERS entirely when a supabase backend is forced', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_BACKEND: 'supabase',
        AUTH_AUTHORITY_URL: 'https://example.supabase.co',
        AUTH_ANON_KEY: 'anon-key',
        AUTH_LOCAL_PROVIDERS: 'passkey',
      })
      expect(resolved.authBackend).toBe('supabase')
      expect(resolved.authProviders).toEqual(['apple', 'email'])
    })
  })

  describe('supabase backend authProviders (untouched by this change)', () => {
    it('defaults to apple,email when AUTH_PROVIDERS is unset', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_AUTHORITY_URL: 'https://example.supabase.co',
        AUTH_ANON_KEY: 'anon-key',
      })
      expect(resolved.authBackend).toBe('supabase')
      expect(resolved.authProviders).toEqual(['apple', 'email'])
    })

    it('still honors AUTH_PROVIDERS exactly as before, with no allowlist filtering', () => {
      const resolved = resolveAuthEnvironment({
        AUTH_AUTHORITY_URL: 'https://example.supabase.co',
        AUTH_ANON_KEY: 'anon-key',
        AUTH_PROVIDERS: 'email,anything-goes',
      })
      expect(resolved.authProviders).toEqual(['email', 'anything-goes'])
    })
  })
})
