<script setup lang="ts">
/* eslint-disable narduk/no-attrs-on-fragment -- narduk-libs#131, not fixed in this fold-move PR: two root nodes forward fallthrough attrs ambiguously */
import type { TooltipItem } from '../types'

defineProps<{
  items: TooltipItem[]
  title: string
}>()
</script>

<template>
  <div v-if="title" class="narduk-tooltip__title">
    {{ title }}
  </div>
  <div v-for="item in items" :key="item.label" class="narduk-tooltip__item">
    <span class="narduk-tooltip__dot" :style="{ backgroundColor: item.color }" />
    <span class="narduk-tooltip__label">{{ item.label }}</span>
    <span class="narduk-tooltip__value">{{ item.value }}</span>
  </div>
</template>
