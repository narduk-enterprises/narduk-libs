<script setup lang="ts">
import type { AdminAnalyticsTab } from '../../composables/useAdminAnalytics'

/** The page's section tabs, with the arrow-key, Home and End movement a tablist promises. */
const model = defineModel<AdminAnalyticsTab>({ required: true })

const TABS: Array<{ id: AdminAnalyticsTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'search', label: 'Search' },
]

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

function target(key: string, index: number): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return TABS.length - 1
  const step = STEP[key]
  return step === undefined ? null : (index + step + TABS.length) % TABS.length
}

function onKeydown(event: KeyboardEvent, index: number) {
  const next = target(event.key, index)
  const tab = next === null ? undefined : TABS[next]
  if (!tab) return
  event.preventDefault()
  model.value = tab.id
  const list = (event.currentTarget as HTMLElement).parentElement
  list?.querySelector<HTMLElement>(`#ne-an-tab-${tab.id}`)?.focus()
}
</script>

<template>
  <div class="ne-an-tabs" role="tablist" aria-label="Analytics sections">
    <UButton
      v-for="(item, index) in TABS"
      :id="`ne-an-tab-${item.id}`"
      :key="item.id"
      role="tab"
      class="ne-an-tab"
      color="neutral"
      variant="ghost"
      :label="item.label"
      :aria-selected="model === item.id"
      :aria-controls="`ne-an-panel-${item.id}`"
      :tabindex="model === item.id ? 0 : -1"
      @click="model = item.id"
      @keydown="onKeydown($event, index)"
    />
  </div>
</template>
