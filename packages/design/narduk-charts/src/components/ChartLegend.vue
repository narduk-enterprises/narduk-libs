<script setup lang="ts">
import { useId } from 'vue'
import type { LegendItem } from '../types'

const props = withDefaults(defineProps<{
  items: LegendItem[]
  /** Visible legend title; also used as the fieldset legend for assistive tech. */
  groupLabel?: string
}>(), {
  groupLabel: 'Data series',
})

const emit = defineEmits<{
  toggle: [name: string]
}>()

defineSlots<{
  item?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()

const labelledBy = `narduk-legend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
</script>

<template>
  <fieldset
    class="narduk-legend narduk-legend__fieldset"
    :aria-labelledby="labelledBy"
  >
    <legend
      :id="labelledBy"
      class="narduk-legend__legend narduk-sr-only"
    >
      {{ groupLabel }}
    </legend>
    <template
      v-for="item in items"
      :key="item.name"
    >
      <slot
        name="item"
        :item="item"
        :toggle="() => emit('toggle', item.name)"
      >
        <button
          type="button"
          class="narduk-legend__item"
          :class="{ 'narduk-legend__item--hidden': item.hidden }"
          :aria-pressed="!item.hidden"
          :aria-label="`${item.hidden ? 'Show' : 'Hide'} series ${item.name}`"
          @click="emit('toggle', item.name)"
        >
          <span
            class="narduk-legend__dot"
            aria-hidden="true"
            :style="{ backgroundColor: item.hidden ? 'transparent' : item.color, borderColor: item.color }"
          />
          <span class="narduk-legend__label">{{ item.name }}</span>
        </button>
      </slot>
    </template>
  </fieldset>
</template>
