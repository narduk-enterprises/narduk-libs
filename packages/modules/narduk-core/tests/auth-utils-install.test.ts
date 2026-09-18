import { describe, expect, it } from 'vitest'

import {
  isAuthLoadStrategy,
  moduleDeclaresAuth,
  resolveNuxtAuthUtilsInstallOptions,
  sessionPasswordConfigured,
} from '../src/auth-utils-install'

describe('resolveNuxtAuthUtilsInstallOptions (narduk-libs#540)', () => {
  it('disables the session plugin when the app has not configured auth', () => {
    expect(resolveNuxtAuthUtilsInstallOptions({ env: {}, modules: [], runtimeConfig: {} })).toEqual(
      {
        loadStrategy: 'none',
      },
    )
  })

  it('treats a blank session password as unset', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: { NUXT_SESSION_PASSWORD: '   ', SESSION_PASSWORD: '' },
        runtimeConfig: { session: { password: ' ' } },
      }),
    ).toEqual({ loadStrategy: 'none' })
  })

  it('keeps the default strategy when NUXT_SESSION_PASSWORD is set', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: { NUXT_SESSION_PASSWORD: 'test-session-password-must-be-at-least-32-chars' },
      }),
    ).toEqual({})
  })

  it('keeps the default strategy when SESSION_PASSWORD is set', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: { SESSION_PASSWORD: 'test-session-password-must-be-at-least-32-chars' },
      }),
    ).toEqual({})
  })

  it('keeps the default strategy when runtimeConfig.session.password is set', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: {},
        runtimeConfig: { session: { password: 'from-nuxt-config' } },
      }),
    ).toEqual({})
  })

  it('keeps the default strategy when the app lists narduk-auth', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: {},
        modules: ['@narduk-enterprises/narduk-core', '@narduk-enterprises/narduk-auth'],
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: {},
        modules: [['@narduk-enterprises/narduk-auth/nuxt', {}]],
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        env: {},
        modules: ['../narduk-auth/src/module'],
      }),
    ).toEqual({})
  })

  it('leaves an app-owned loadStrategy untouched', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: 'server-first',
        env: {},
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: 'client-only',
        env: {},
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: 'none',
        env: { NUXT_SESSION_PASSWORD: 'set' },
      }),
    ).toEqual({})
  })
})

describe('auth-utils install signals', () => {
  it('recognises the three nuxt-auth-utils load strategies', () => {
    expect(isAuthLoadStrategy('none')).toBe(true)
    expect(isAuthLoadStrategy('client-only')).toBe(true)
    expect(isAuthLoadStrategy('server-first')).toBe(true)
    expect(isAuthLoadStrategy('eager')).toBe(false)
    expect(isAuthLoadStrategy(undefined)).toBe(false)
  })

  it('does not treat narduk-core as an auth module', () => {
    expect(moduleDeclaresAuth(['@narduk-enterprises/narduk-core'])).toBe(false)
    expect(moduleDeclaresAuth(['nuxt-auth-utils'])).toBe(true)
  })

  it('reads the session password from env or runtimeConfig', () => {
    expect(sessionPasswordConfigured({ NUXT_SESSION_PASSWORD: 'x' }, {})).toBe(true)
    expect(sessionPasswordConfigured({}, { session: { password: 'x' } })).toBe(true)
    expect(sessionPasswordConfigured({ NUXT_SESSION_PASSWORD: '' }, {})).toBe(false)
  })
})
