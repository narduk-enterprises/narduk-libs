import { describe, expect, it, vi } from 'vitest'

import {
  isAuthLoadStrategy,
  maybeInstallNuxtAuthUtils,
  moduleDeclaresAuth,
  resolveNuxtAuthUtilsInstallOptions,
  sessionPasswordConfigured,
  sessionRuntimeConfigSeed,
  shouldInstallNuxtAuthUtils,
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

  // The README promises the value is "Unchanged when the app already set
  // `auth.loadStrategy`" without qualifying it to the three strategies this
  // package happens to know. A typo, a value from a newer `nuxt-auth-utils`,
  // or anything else the app wrote is the app's to own: overriding it here
  // would silently disable the session plugin rather than let the module that
  // defines the option reject a value it does not accept (narduk-libs#542).
  it('leaves a loadStrategy it does not recognise untouched', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: 'eager',
        env: {},
        modules: [],
        runtimeConfig: {},
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: 'server_first',
        env: {},
        modules: [],
        runtimeConfig: {},
      }),
    ).toEqual({})
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: null,
        env: {},
        modules: [],
        runtimeConfig: {},
      }),
    ).toEqual({})
  })

  // The other half of the same boundary: not writing the key at all is still
  // "the app has not configured auth", so the no-auth default must survive.
  it('still disables the session plugin when loadStrategy is absent', () => {
    expect(
      resolveNuxtAuthUtilsInstallOptions({
        configuredLoadStrategy: undefined,
        env: {},
        modules: [],
        runtimeConfig: {},
      }),
    ).toEqual({ loadStrategy: 'none' })
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

describe('nardukCore.auth install gate (narduk-libs#169)', () => {
  it('treats omitted and true as install, and only false as opt-out', () => {
    expect(shouldInstallNuxtAuthUtils(undefined)).toBe(true)
    expect(shouldInstallNuxtAuthUtils(true)).toBe(true)
    expect(shouldInstallNuxtAuthUtils(false)).toBe(false)
  })

  it('seeds an empty session password only when auth stays on', () => {
    expect(sessionRuntimeConfigSeed(undefined, {})).toEqual({ session: { password: '' } })
    expect(sessionRuntimeConfigSeed(true, { NUXT_SESSION_PASSWORD: 'secret' })).toEqual({
      session: { password: 'secret' },
    })
    expect(sessionRuntimeConfigSeed(false, { NUXT_SESSION_PASSWORD: 'secret' })).toEqual({})
  })

  it('skips installModule when auth is false', async () => {
    const install = vi.fn()
    await maybeInstallNuxtAuthUtils(false, install, { env: {}, modules: [] })
    expect(install).not.toHaveBeenCalled()

    await maybeInstallNuxtAuthUtils(undefined, install, { env: {}, modules: [] })
    expect(install).toHaveBeenCalledWith('nuxt-auth-utils', { loadStrategy: 'none' })
  })
})
