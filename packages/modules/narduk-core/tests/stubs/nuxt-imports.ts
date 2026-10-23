import { ref } from 'vue'

import type { Ref } from 'vue'

/**
 * Type stub for `#imports` so `usePreferences.ts` can live in the
 * layer-tooling project. Runtime tests mock this module with `vi.mock`.
 */
export function useCookie<T>(_name: string, _options?: object): Ref<T | null> {
  return ref(null)
}

export function useRequestEvent(): { context: Record<string, unknown> } | undefined {
  return undefined
}

export function useRequestHeaders(_keys: string[]): Record<string, string | undefined> {
  return {}
}

export function useState<T>(_key: string, init?: () => T): Ref<T> {
  return ref(init ? init() : (undefined as T)) as Ref<T>
}

export interface StubNuxtApp {
  payload: Record<string, unknown>
}

/** The plugin shapes the layer's plugins use; Nuxt supplies the real one. */
export function defineNuxtPlugin(plugin: {
  dependsOn?: string[]
  name?: string
  setup: (nuxtApp: StubNuxtApp) => unknown
}): typeof plugin
export function defineNuxtPlugin<T>(setup: (nuxtApp: StubNuxtApp) => T): (nuxtApp: StubNuxtApp) => T
export function defineNuxtPlugin(plugin: unknown) {
  return plugin
}

export function useNuxtApp(): Record<string, unknown> {
  return {}
}

export function useRequestFetch(): typeof $fetch {
  return $fetch
}

export function useRuntimeConfig(): { public: Record<string, unknown> } {
  return { public: {} }
}
