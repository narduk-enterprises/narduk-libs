/**
 * Ambient declarations for the Nuxt virtual module the shell's runtime imports
 * (components backlog item 18, narduk-libs#265). Same shape and reasoning as
 * narduk-mapkit's `src/nuxt/runtime/nuxt-shims.d.ts`.
 *
 * This package type-checks with plain `vue-tsc` and no Nuxt build of its own,
 * so `#imports` has no resolution at compile time here. It does at the
 * consumer's: the module transpiles the package, and the app's own Nuxt build
 * resolves the alias. Under vitest, `@nuxt/ui/vite` (vitest.config.ts)
 * resolves it to Nuxt UI's Vue-mode stubs, which export all four.
 *
 * Only the members the runtime actually calls are declared. Widening this file
 * is how a compile-time-invisible dependency on Nuxt internals would creep in.
 */
declare module '#imports' {
  import type { Ref } from 'vue'

  export function useState<T>(key: string, init: () => T): Ref<T>
  export function useAppConfig(): Record<string, unknown>
  export function useHead(input: Record<string, unknown>): unknown
  export function defineNuxtPlugin(plugin: () => void): unknown
}
