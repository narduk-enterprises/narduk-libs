/**
 * `onServerPrefetch` that keeps `useId` stable across hydration.
 *
 * Vue's `useId` treats a component with a server-prefetch hook as an async
 * boundary and adds a level to the ids of everything under it. A hook
 * registered on the server alone (`if (import.meta.server) onServerPrefetch(...)`)
 * gives the server one more level than the client, so every generated id below
 * it mismatches on hydration (`v-0-0-0-0` against `v-0-0-0`; stonx#1356).
 *
 * `onHydrationSafeServerPrefetch(work)` registers the hook on both sides and
 * runs `work` only on the server. Vue never calls the client's hook; it exists
 * so the two trees count the same levels.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/server-prefetch`.
 * It is not under `app/composables` or `app/utils`, so it adds no auto-imported
 * names to consuming apps.
 *
 * @example
 * ```ts
 * const releases = useReleasesStore()
 * onHydrationSafeServerPrefetch(() => releases.ensure())
 * ```
 */
import { onServerPrefetch } from 'vue'

/** The registration, with the side passed in; `onHydrationSafeServerPrefetch` passes the build's. */
export function registerServerPrefetch(work: () => unknown, isServer: boolean): void {
  onServerPrefetch(isServer ? work : () => {})
}

export function onHydrationSafeServerPrefetch(work: () => unknown): void {
  registerServerPrefetch(work, Boolean(import.meta.server))
}
