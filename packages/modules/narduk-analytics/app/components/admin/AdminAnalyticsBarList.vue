<script setup lang="ts">
import { computed } from 'vue'

import { adminFormatCount } from '../../utils/analyticsAdminRange'

export interface AdminBarItem {
  group?: string
  label: string
  /** A "N more" row folded from the tail; shown, never hidden. */
  other?: boolean
  /** A row that says "we do not know", drawn apart. */
  unknown?: boolean
  value: number
}

const props = defineProps<{
  items: AdminBarItem[]
  /** Show each row's share of the listed total. */
  share?: boolean
  /** Accessible name of the list. */
  title: string
}>()

const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)))
const total = computed(() => props.items.reduce((sum, item) => sum + item.value, 0))
const percent = (value: number) =>
  total.value ? `${Math.round((value / total.value) * 100)}%` : ''
const groups = computed(() => {
  const out: Array<{ items: AdminBarItem[]; name: string }> = []
  for (const item of props.items) {
    const name = item.group ?? ''
    const last = out.at(-1)
    if (last && last.name === name) last.items.push(item)
    else out.push({ name, items: [item] })
  }
  return out
})
</script>

<template>
  <div>
    <template v-for="group in groups" :key="group.name">
      <p v-if="group.name" class="ne-an-group">{{ group.name }}</p>
      <ul class="ne-an-list" :aria-label="group.name ? `${title}: ${group.name}` : title">
        <li
          v-for="item in group.items"
          :key="item.label"
          class="ne-an-row"
          :data-unknown="item.unknown"
          :data-other="item.other"
          :style="share ? { gridTemplateColumns: 'minmax(0, 1fr) auto 3.2em' } : undefined"
        >
          <span class="ne-an-row-fill" :style="{ width: `${(item.value / max) * 100}%` }" />
          <span class="ne-an-row-label" :title="item.label">{{ item.label }}</span>
          <span class="ne-an-row-value">{{ adminFormatCount(item.value) }}</span>
          <span v-if="share" class="ne-an-row-share">{{ percent(item.value) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
