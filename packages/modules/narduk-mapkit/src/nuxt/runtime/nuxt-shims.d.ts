/**
 * Ambient declarations for the Nuxt virtual modules this runtime imports.
 *
 * `@narduk-enterprises/narduk-mapkit` is built by plain `tsc`, not by
 * `nuxt-module-build`, because everything else it publishes is framework-free
 * and its `dist/` is committed. So `#imports` has no resolution at compile time
 * here. It does at the consumer's: the module pushes `runtime/` onto
 * `nuxt.options.build.transpile`, so Vite resolves the alias in the app that
 * installs this package -- the same contract every published Nuxt module runs
 * on.
 *
 * Only the members this runtime actually calls are declared. Widening this file
 * is how a compile-time-invisible dependency on Nuxt internals would creep in.
 */
declare module '#imports' {
  export function useHead(input: Record<string, unknown>): void
  export function useRuntimeConfig(event?: unknown): {
    [key: string]: unknown
    public: { [key: string]: unknown }
  }
}
