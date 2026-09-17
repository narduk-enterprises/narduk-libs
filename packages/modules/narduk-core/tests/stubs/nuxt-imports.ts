import { ref } from 'vue'

import type { Ref } from 'vue'

/**
 * Type stub for `#imports` so `usePreferences.ts` can live in the
 * layer-tooling project. Runtime tests mock this module with `vi.mock`.
 */
export function useCookie<T>(_name: string, _options?: object): Ref<T | null> {
  return ref(null)
}

export function useRequestEvent(): undefined {
  return
}

export function useRequestHeaders(_keys: string[]): Record<string, string | undefined> {
  return {}
}

export function useState<T>(_key: string, init?: () => T): Ref<T> {
  return ref(init ? init() : (undefined as T)) as Ref<T>
}
