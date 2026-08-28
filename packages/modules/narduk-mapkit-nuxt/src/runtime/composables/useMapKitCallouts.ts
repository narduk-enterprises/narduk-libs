import { inject } from 'vue'

import { appMapKitCalloutInjectionKey } from '../callouts'

import type { AppMapKitCalloutContext } from '../callouts'

/**
 * Read the callout controls of the enclosing `<AppMapKit callouts>`.
 *
 * `<AppMapKitCallout>` covers the common case -- a slot rendered into whatever
 * is open. This is for the rest: a legend row that opens the callout for a
 * station, a "close all" button, a keyboard shortcut. It only works inside the
 * map's own subtree, because that is where the context is provided.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { close, entries, open } = useMapKitCallouts()
 * </script>
 * ```
 */
export function useMapKitCallouts(): AppMapKitCalloutContext {
  const callouts = inject(appMapKitCalloutInjectionKey, null)
  if (!callouts) {
    throw new Error(
      'useMapKitCallouts() must be called from a component inside <AppMapKit callouts>.',
    )
  }
  return callouts
}
