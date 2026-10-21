<script setup lang="ts">
import { useReducedMotion } from '../composables/use-reduced-motion'

import type { NeSettleProps } from './ne-hall-of-fame-types'

withDefaults(defineProps<NeSettleProps>(), { disabled: false, motionKey: 0 })
defineSlots<{ default(): unknown }>()
const reduced = useReducedMotion()
</script>

<template>
  <!-- No appear: the first paint is already at rest, including SSR. -->
  <Transition name="ne-settle" :css="!disabled && !reduced">
    <div :key="motionKey" data-ne-settle><slot /></div>
  </Transition>
</template>

<!-- Transition classes land on the projected root; names are package-prefixed. -->
<style>
@media (prefers-reduced-motion: no-preference) {
  .ne-settle-enter-active {
    transition:
      transform var(--ne-settle-duration) var(--ne-ease-settle),
      opacity var(--ne-settle-duration) var(--ne-ease-settle);
  }
  .ne-settle-enter-from {
    transform: translateY(-3px);
    opacity: 0.6;
  }
}
</style>
