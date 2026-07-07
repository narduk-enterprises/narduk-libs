import * as Vue from 'vue'

import type { ComputedRef, MaybeRefOrGetter } from 'vue'

export type AppViewGateState =
  'checking' | 'signed-out' | 'forbidden' | 'loading' | 'ready' | 'refreshing' | 'empty' | 'error'

export interface ResolveAppViewGateInput {
  accessResolved: boolean
  allowed: boolean
  empty?: boolean
  error?: boolean
  loaded: boolean
  loading: boolean
  refreshing?: boolean
  signedIn: boolean
}

export type UseAppViewGateInput = {
  [Key in keyof ResolveAppViewGateInput]: MaybeRefOrGetter<ResolveAppViewGateInput[Key]>
}

export function resolveAppViewGateState(input: ResolveAppViewGateInput): AppViewGateState {
  if (!input.accessResolved) {
    return 'checking'
  }

  if (!input.signedIn) {
    return 'signed-out'
  }

  if (!input.allowed) {
    return 'forbidden'
  }

  if (input.error) {
    return 'error'
  }

  const refreshing = input.refreshing ?? (input.loading && input.loaded)
  if (refreshing && input.loaded) {
    return 'refreshing'
  }

  if (!input.loaded || input.loading) {
    return 'loading'
  }

  if (input.empty) {
    return 'empty'
  }

  return 'ready'
}

export function useAppViewGate(input: UseAppViewGateInput): ComputedRef<AppViewGateState> {
  return Vue.computed(() =>
    resolveAppViewGateState({
      accessResolved: Vue.toValue(input.accessResolved),
      allowed: Vue.toValue(input.allowed),
      empty: Vue.toValue(input.empty),
      error: Vue.toValue(input.error),
      loaded: Vue.toValue(input.loaded),
      loading: Vue.toValue(input.loading),
      refreshing: Vue.toValue(input.refreshing),
      signedIn: Vue.toValue(input.signedIn),
    }),
  )
}

export function isAppViewGateInteractive(state: AppViewGateState): boolean {
  return state === 'ready' || state === 'refreshing' || state === 'empty'
}
