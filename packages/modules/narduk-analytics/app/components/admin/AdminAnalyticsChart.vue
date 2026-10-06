<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  adminShownValue,
  adminSlotInProgress,
  adminSlotLabel,
} from '../../utils/analyticsAdminChart'

import type { AdminChartBucket } from '../../utils/analyticsAdminChart'

export interface AdminChartMetric {
  /** Why the metric cannot be drawn on this range (Google is daily only). */
  disabledReason?: string
  id: string
  label: string
  /** A caveat shown under the chart for this metric. */
  note?: string
  /** Per-slot values; `null` is "not measured", never zero. */
  values: Array<number | null>
}

const props = defineProps<{
  bucket: AdminChartBucket
  empty: string
  loading: boolean
  metrics: AdminChartMetric[]
  nowMs: number
  slots: Array<{ endMs: number; key: string; startMs: number }>
  tz: string
}>()

const VIEWS = [
  { id: 'bars', label: 'Bars' },
  { id: 'trend', label: 'Trend' },
  { id: 'table', label: 'Table' },
] as const

const metricId = ref('')
const view = ref<'bars' | 'table' | 'trend'>('bars')
const active = ref(-1)

const enabled = computed(() => props.metrics.filter((item) => !item.disabledReason))
const metric = computed(
  () =>
    enabled.value.find((item) => item.id === metricId.value) ??
    enabled.value[0] ??
    props.metrics[0],
)
watch(
  () => props.metrics.map((item) => `${item.id}:${item.disabledReason ?? ''}`).join('|'),
  () => {
    if (metric.value && metric.value.id !== metricId.value) metricId.value = metric.value.id
  },
  { immediate: true },
)
// A new range is a new set of slots: drop the old selection.
watch(
  () => props.slots.length + (props.slots[0]?.key ?? ''),
  () => (active.value = -1),
)

const unit = computed(() => (props.bucket === '1d' ? 'day' : 'bucket'))
const label = (index: number) => {
  const slot = props.slots[index]
  return slot ? adminSlotLabel(slot, props.bucket, props.tz, 'full') : ''
}
const open = (index: number) => {
  const slot = props.slots[index]
  return slot ? adminSlotInProgress(slot, props.nowMs) : false
}

const detail = computed(() => {
  const index = active.value
  if (!props.slots[index]) return null
  return {
    open: open(index),
    rows: enabled.value.map((item) => ({
      id: item.id,
      label: item.label,
      value: adminShownValue(item.values[index]),
    })),
    title: label(index),
  }
})
const tableRows = computed(() =>
  props.slots.map((slot, index) => ({
    label: `${label(index)}${open(index) ? ' (in progress)' : ''}`,
    ...Object.fromEntries(
      enabled.value.map((item) => [item.id, adminShownValue(item.values[index])]),
    ),
  })),
)
</script>

<template>
  <section class="ne-an-panel" aria-label="Traffic over time">
    <div class="ne-an-panel-head">
      <div class="ne-an-metrics" role="tablist" aria-label="Series">
        <UButton
          v-for="item in metrics"
          :key="item.id"
          role="tab"
          class="ne-an-tab"
          color="neutral"
          variant="ghost"
          :aria-selected="metric?.id === item.id"
          :disabled="Boolean(item.disabledReason)"
          :title="item.disabledReason"
          :label="item.label"
          @click="metricId = item.id"
        />
      </div>
      <div class="ne-an-seg" role="group" aria-label="View">
        <UButton
          v-for="item in VIEWS"
          :key="item.id"
          color="neutral"
          variant="ghost"
          :aria-pressed="view === item.id"
          :label="item.label"
          @click="view = item.id"
        />
      </div>
    </div>

    <div class="ne-an-panel-body">
      <div v-if="loading && !slots.length" aria-hidden="true">
        <div class="ne-an-skel" style="height: 240px" />
      </div>
      <p v-else-if="!slots.length || !metric" class="ne-an-empty">{{ empty }}</p>

      <AdminAnalyticsChartTable
        v-else-if="view === 'table'"
        :first="bucket === '1d' ? 'Day' : 'Time'"
        :metrics="enabled"
        :rows="tableRows"
      />

      <template v-else>
        <AdminAnalyticsPlot
          v-model:active="active"
          :bucket="bucket"
          :label="metric.label"
          :now-ms="nowMs"
          :slots="slots"
          :tz="tz"
          :values="metric.values"
          :view="view"
        />
        <AdminAnalyticsChartDetail :detail="detail" :unit="unit" />
        <p v-if="metric.note" class="ne-an-note" style="margin-top: 8px">{{ metric.note }}</p>
      </template>
    </div>
  </section>
</template>
