<script setup lang="ts">
import { useId } from 'vue'

import type { LegendItem } from '../types'

withDefaults(
  defineProps<{
    /** Visible legend title; also used as the fieldset legend for assistive tech. */
    groupLabel?: string
    items: LegendItem[]
  }>(),
  {
    groupLabel: 'Data series',
  },
)

const emit = defineEmits<{
  toggle: [name: string]
}>()

defineSlots<{
  item?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()

const labelledBy = `narduk-legend-${useId().replace(/[^\w-]/g, '')}`
</script>

<template>
  <fieldset class="narduk-legend narduk-legend__fieldset" :aria-labelledby="labelledBy">
    <legend :id="labelledBy" class="narduk-legend__legend narduk-sr-only">
      {{ groupLabel }}
    </legend>
    <template v-for="item in items" :key="item.name">
      <slot name="item" :item="item" :toggle="() => emit('toggle', item.name)">
        <button
          type="button"
          class="narduk-legend__item"
          :class="{
            'narduk-legend__item--hidden': item.hidden,
            'narduk-legend__item--context': item.context,
            'narduk-legend__item--dashed': item.dashed,
            'narduk-legend__item--band': item.band,
          }"
          :aria-pressed="!item.hidden"
          :aria-label="`${item.hidden ? 'Show' : 'Hide'} series ${item.name}`"
          @click="emit('toggle', item.name)"
        >
          <span
            class="narduk-legend__dot"
            aria-hidden="true"
            :style="{
              backgroundColor: item.hidden ? 'transparent' : item.color,
              borderColor: item.context
                ? `color-mix(in oklab, ${item.color} 45%, var(--nc-studio-surface))`
                : item.color,
            }"
          />
          <span class="narduk-legend__label">{{ item.name }}</span>
        </button>
      </slot>
    </template>
  </fieldset>
</template>
