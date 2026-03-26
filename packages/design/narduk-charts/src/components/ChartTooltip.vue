<script setup lang="ts">
import { computed } from 'vue'
import ChartTooltipDefaultBody from './ChartTooltipDefaultBody.vue'
import type { TooltipItem } from '../types'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  title: string
  items: TooltipItem[]
  chartWidth: number
}>()

defineSlots<{
  content?: (props: {
    title: string
    items: TooltipItem[]
    visible: boolean
  }) => unknown
}>()

const positionStyle = computed(() => {
  const flip = props.x > props.chartWidth * 0.65
  return {
    left: `${props.x}px`,
    top: `${props.y}px`,
    transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
    opacity: props.visible ? 1 : 0,
  }
})
</script>

<template>
  <div class="narduk-tooltip" :style="positionStyle">
    <slot
      name="content"
      :title="title"
      :items="items"
      :visible="visible"
    >
      <ChartTooltipDefaultBody :title="title" :items="items" />
    </slot>
  </div>
</template>
