<script setup lang="ts">
import type { TooltipItem } from '../types'

defineProps<{
  items: TooltipItem[]
  title: string
}>()
</script>

<template>
  <div>
    <div v-if="title" class="narduk-tooltip__title">
      {{ title }}
    </div>
    <div v-for="item in items" :key="item.label" class="narduk-tooltip__item">
      <span class="narduk-tooltip__dot" :style="{ backgroundColor: item.color }" />
      <span class="narduk-tooltip__label">{{ item.label }}</span>
      <span class="narduk-tooltip__value">{{ item.value }}</span>
    </div>
  </div>
</template>
