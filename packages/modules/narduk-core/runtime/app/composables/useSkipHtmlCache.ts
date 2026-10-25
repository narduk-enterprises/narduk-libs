// Explicit imports (not Nuxt auto-imports): packed package consumers compile this file outside the owning Nuxt source tree, so Vue and Nuxt APIs must be explicit.
import { useRequestEvent } from '#imports'

import { markHtmlCacheSkipped } from '../../shared/html-cache'

/**
 * Mark this server render as not storable by `nardukCore.htmlCache`.
 *
 * ```vue
 * <script setup lang="ts">
 * const { data } = await useFetch('/api/release')
 * if (!data.value) useSkipHtmlCache() // answers 200, but must not be cached
 * </script>
 * ```
 *
 * Call it from a page or component `setup` during SSR; it is a no-op in the browser.
 * The server twin is `skipHtmlCache(event)`.
 */
export function useSkipHtmlCache(): void {
  // `useRequestEvent()` is undefined in the browser, so this is a no-op there.
  markHtmlCacheSkipped(useRequestEvent())
}
