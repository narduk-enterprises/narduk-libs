<script setup lang="ts">
/**
 * NeShowMore — "Show all N" under a list that `useRowLimit()` capped: the same
 * control `NeCollectionTable` draws under a limited table, for the lists that
 * are rows rather than columns.
 *
 * Wraps `UButton` (outline, neutral). It holds a 2.75rem tap floor and sits at
 * the list's left edge instead of stretching across it, and it emits `expand`
 * and nothing else: the caller owns the state, as it does for `NePager`.
 *
 * The count is the whole list's, formatted through `./format`'s `formatNumber`
 * so the server and the browser print the same digits on the first paint.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed } from 'vue'

import { formatNumber } from '../../format'

import { showMoreLabel } from './ne-show-more-types'

import type { NeShowMoreProps } from './ne-show-more-types'

const props = withDefaults(defineProps<NeShowMoreProps>(), {
  controls: undefined,
  hidden: undefined,
  label: undefined,
  noun: undefined,
})

defineEmits<{ expand: [] }>()

const shown = computed(() => props.hidden === undefined || props.hidden > 0)
const text = computed(() => props.label ?? showMoreLabel(formatNumber(props.total), props.noun))
</script>

<template>
  <UButton
    v-if="shown"
    class="ne-show-more"
    type="button"
    color="neutral"
    variant="outline"
    data-ne-show-more
    :label="text"
    :aria-controls="controls"
    @click="$emit('expand')"
  />
</template>

<style scoped>
.ne-show-more {
  align-self: flex-start;
  justify-content: center;
  width: fit-content;
  min-height: 2.75rem;
  margin-top: 0.75rem;
}
</style>
