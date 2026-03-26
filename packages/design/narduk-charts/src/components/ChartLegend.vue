<script setup lang="ts">
import type { LegendItem } from '../types'

defineProps<{
  items: LegendItem[]
}>()

const emit = defineEmits<{
  toggle: [name: string]
}>()

defineSlots<{
  item?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()
</script>

<template>
  <div class="narduk-legend">
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
          @click="emit('toggle', item.name)"
        >
          <span
            class="narduk-legend__dot"
            :style="{ backgroundColor: item.hidden ? 'transparent' : item.color, borderColor: item.color }"
          />
          <span class="narduk-legend__label">{{ item.name }}</span>
        </button>
      </slot>
    </template>
  </div>
</template>
