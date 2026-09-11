/**
 * Whether this code is running on the client.
 *
 * A thin seam around Nuxt's `import.meta.client` build macro. This package's
 * `vitest.config.ts` is a plain `@vitejs/plugin-vue` config with no
 * macro-replacement plugin, so outside a real Nuxt/Vite build the macro is
 * never defined and evaluates falsy -- which happens to be exactly what a
 * real SSR render sees too. `AppMapKit.vue`'s other `import.meta.client`
 * guards (`initMap`, `buildClusterElement`, `syncColorScheme`) rely on that
 * coincidence to keep their SSR-safe branches exercised by
 * `app-map-kit-ssr.test.ts`, so they keep reading the macro directly.
 *
 * `ensureCalloutController()` is different: nothing exercises its
 * client-only branch anywhere except a real Nuxt client build, so before
 * this seam existed the callout wiring inside `AppMapKit.vue` itself
 * (`selectedId` open/close, `calloutMode`/`calloutPlacement` forwarding,
 * Escape-dismiss syncing back to `selectedId`) had no mount coverage at all
 * (narduk-libs#269). Routing that one guard through an ordinary function
 * import instead lets a mount test force it true with `vi.mock(...)`, the
 * same seam `useMapKit` already uses for the MapKit JS loader.
 */
export function isClientEnvironment(): boolean {
  return import.meta.client
}
