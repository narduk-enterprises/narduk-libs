import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'

import * as viewGate from '../runtime/app/composables/useAppViewGate'

describe('app view gate', () => {
  it.each([
    [
      'error',
      {
        accessResolved: true,
        allowed: true,
        error: true,
        loaded: true,
        loading: false,
        signedIn: true,
      },
      'error',
    ],
    [
      'checking before error',
      {
        accessResolved: false,
        allowed: false,
        error: true,
        loaded: false,
        loading: false,
        signedIn: false,
      },
      'checking',
    ],
    [
      'signed out before error',
      {
        accessResolved: true,
        allowed: false,
        error: true,
        loaded: false,
        loading: false,
        signedIn: false,
      },
      'signed-out',
    ],
    [
      'forbidden before error',
      {
        accessResolved: true,
        allowed: false,
        error: true,
        loaded: false,
        loading: false,
        signedIn: true,
      },
      'forbidden',
    ],
    [
      'checking',
      {
        accessResolved: false,
        allowed: false,
        loaded: false,
        loading: false,
        signedIn: false,
      },
      'checking',
    ],
    [
      'signed out',
      {
        accessResolved: true,
        allowed: false,
        loaded: false,
        loading: false,
        signedIn: false,
      },
      'signed-out',
    ],
    [
      'forbidden',
      {
        accessResolved: true,
        allowed: false,
        loaded: false,
        loading: false,
        signedIn: true,
      },
      'forbidden',
    ],
    [
      'loading',
      {
        accessResolved: true,
        allowed: true,
        loaded: false,
        loading: true,
        signedIn: true,
      },
      'loading',
    ],
    [
      'refreshing',
      {
        accessResolved: true,
        allowed: true,
        loaded: true,
        loading: true,
        signedIn: true,
      },
      'refreshing',
    ],
    [
      'empty',
      {
        accessResolved: true,
        allowed: true,
        empty: true,
        loaded: true,
        loading: false,
        signedIn: true,
      },
      'empty',
    ],
    [
      'ready',
      {
        accessResolved: true,
        allowed: true,
        loaded: true,
        loading: false,
        signedIn: true,
      },
      'ready',
    ],
  ] as const)('resolves %s state', (_label, input, expected) => {
    expect(viewGate.resolveAppViewGateState(input)).toBe(expected)
  })

  it('accepts refs for Nuxt page state', () => {
    const accessResolved = Vue.ref(false)
    const signedIn = Vue.ref(false)
    const allowed = Vue.ref(false)
    const loading = Vue.ref(false)
    const loaded = Vue.ref(false)

    const state = viewGate.useAppViewGate({
      accessResolved,
      allowed,
      loaded,
      loading,
      signedIn,
    })

    expect(state.value).toBe('checking')

    accessResolved.value = true
    signedIn.value = true
    allowed.value = true
    loading.value = true
    expect(state.value).toBe('loading')

    loaded.value = true
    expect(state.value).toBe('refreshing')

    loading.value = false
    expect(state.value).toBe('ready')
  })

  it('accepts getters for Nuxt page state', () => {
    const state = viewGate.useAppViewGate({
      accessResolved: () => true,
      allowed: () => true,
      loaded: () => true,
      loading: () => true,
      refreshing: () => false,
      signedIn: () => true,
    })

    expect(state.value).toBe('loading')
  })

  it('lets explicit refreshing override loaded loading refresh inference', () => {
    expect(
      viewGate.resolveAppViewGateState({
        accessResolved: true,
        allowed: true,
        loaded: true,
        loading: true,
        refreshing: false,
        signedIn: true,
      }),
    ).toBe('loading')
  })

  it('marks ready, refreshing, and empty views as interactive', () => {
    expect(viewGate.isAppViewGateInteractive('ready')).toBe(true)
    expect(viewGate.isAppViewGateInteractive('refreshing')).toBe(true)
    expect(viewGate.isAppViewGateInteractive('empty')).toBe(true)
    expect(viewGate.isAppViewGateInteractive('loading')).toBe(false)
    expect(viewGate.isAppViewGateInteractive('signed-out')).toBe(false)
  })
})
