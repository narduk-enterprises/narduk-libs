import { createFormatters } from '../../shared/utils/units'

import { usePreferences } from './usePreferences'

import type { NeBoundFormatters } from '../../shared/utils/units'

/**
 * The formatter suite bound to the reader's preferences (narduk-libs#386).
 *
 * ```vue
 * <script setup lang="ts">
 * const format = useFormatters()
 * </script>
 *
 * <template>
 *   <dd>{{ format.height(buoy.waveHeightMetres) }}</dd>
 *   <dd>{{ format.speed(buoy.windSpeedMetresPerSecond) }}</dd>
 *   <dd>{{ format.dateTime(buoy.observedAt) }}</dd>
 * </template>
 * ```
 *
 * A plain object, not a `ComputedRef`: {@link createFormatters} is given a
 * *getter* over the preferences, so each call reads the current value and a
 * template that calls a formatter re-renders when the reader switches units.
 * The call site keeps its `format.height(x)` shape instead of
 * `format.value.height(x)`.
 *
 * Adoption is per value. Nothing here rewrites an app's existing display code,
 * and a single call site can override the reader's units with the same options
 * bag the pure formatters take.
 */
export function useFormatters(): NeBoundFormatters {
  const { preferences } = usePreferences()
  return createFormatters(() => preferences.value)
}
