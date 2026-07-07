import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

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
  return computed(() =>
    resolveAppViewGateState({
      accessResolved: toValue(input.accessResolved),
      allowed: toValue(input.allowed),
      empty: toValue(input.empty),
      error: toValue(input.error),
      loaded: toValue(input.loaded),
      loading: toValue(input.loading),
      refreshing: toValue(input.refreshing),
      signedIn: toValue(input.signedIn),
    }),
  )
}

export function isAppViewGateInteractive(state: AppViewGateState): boolean {
  return state === 'ready' || state === 'refreshing' || state === 'empty'
}
