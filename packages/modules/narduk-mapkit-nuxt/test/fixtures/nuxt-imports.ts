/**
 * Stand-in for Nuxt's `#imports` auto-import alias, aliased in
 * `vitest.config.ts`. `useMapKit.ts` imports `useRuntimeConfig` from
 * `#imports`, which has no real module outside a Nuxt build; this gives it
 * one so the composable's own source can load unmodified in tests instead of
 * being mocked away (narduk-libs#269 SSR proof in `ssr.test.ts`).
 *
 * `useMapKit()` only calls `useRuntimeConfig()` inside its
 * `import.meta.client` branch, which is falsy in this plain Vite/vitest
 * compile (no Nuxt build macro replaces it) — the same as real SSR — so this
 * fixture's return value is never read there. It still has to be a real,
 * shaped value in case a future caller reads it outside that branch.
 */
export function useRuntimeConfig() {
  return {
    public: {
      mapkitToken: '',
      mapkitTokenEndpoint: '/api/mapkit-token',
    },
  }
}
