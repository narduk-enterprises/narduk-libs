// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- Packed package consumers compile this file outside the owning Nuxt source tree, so Vue APIs must be explicit.
import { computed, onMounted, ref } from 'vue'

import { useColorMode } from '#imports'

/**
 * Hydration-safe color mode toggle state.
 *
 * Color mode preference may come from client-only persistence. Using a stable
 * neutral icon until mount keeps SSR and hydration markup deterministic.
 */
export function useColorModeToggle() {
  const colorMode = useColorMode()
  const isMounted = ref(false)

  onMounted(() => {
    isMounted.value = true
  })

  const colorModeIcon = computed(() => {
    if (!isMounted.value) {
      return 'i-lucide-monitor'
    }

    if (colorMode.preference === 'system') {
      return 'i-lucide-monitor'
    }

    return colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'
  })

  function cycleColorMode() {
    const modes = ['system', 'light', 'dark'] as const
    const idx = modes.indexOf(colorMode.preference as (typeof modes)[number])
    colorMode.preference = modes[(idx + 1) % modes.length]!
  }

  return {
    colorMode,
    colorModeIcon,
    cycleColorMode,
  }
}
