<script setup lang="ts">
import { computed } from 'vue'

import { adminFormatCount } from '../../utils/analyticsAdminRange'

import type { AdminAnalyticsGsc } from '../../types/adminAnalyticsTypes'

const props = defineProps<{
  dailyOnly: boolean
  data: AdminAnalyticsGsc | null
  dimension: 'page' | 'query'
  failure: string
  failureKind: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  'show-daily': []
  'update:dimension': [value: 'page' | 'query']
}>()

const DIMENSIONS = [
  { id: 'query' as const, label: 'Queries' },
  { id: 'page' as const, label: 'Pages' },
]

const right = {
  td: 'text-right tabular-nums whitespace-nowrap',
  th: 'text-right whitespace-nowrap',
}
const columns = computed(() => [
  {
    accessorKey: 'key',
    header: props.dimension === 'query' ? 'Query' : 'Page',
    meta: { class: { td: 'min-w-36' } },
  },
  { accessorKey: 'clicks', header: 'Clicks', meta: { class: right } },
  { accessorKey: 'impressions', header: 'Impr.', meta: { class: right } },
  { accessorKey: 'ctr', header: 'CTR', meta: { class: right } },
  { accessorKey: 'position', header: 'Pos.', meta: { class: right } },
])
const rows = computed(() =>
  (props.data?.rows ?? []).map((row) => ({
    clicks: adminFormatCount(row.clicks),
    ctr: `${(row.ctr * 100).toFixed(1)}%`,
    impressions: adminFormatCount(row.impressions),
    key: row.keys.join(' / '),
    position: row.position.toFixed(1),
  })),
)
const noun = computed(() => (props.dimension === 'query' ? 'queries' : 'pages'))
</script>

<template>
  <section class="ne-an-panel" aria-label="Search Console">
    <div class="ne-an-panel-head">
      <h2>Search</h2>
      <div class="ne-an-seg" role="group" aria-label="Search dimension">
        <UButton
          v-for="item in DIMENSIONS"
          :key="item.id"
          color="neutral"
          variant="ghost"
          :aria-pressed="dimension === item.id"
          :label="item.label"
          @click="emit('update:dimension', item.id)"
        />
      </div>
    </div>
    <div class="ne-an-panel-body">
      <template v-if="dailyOnly">
        <p class="ne-an-empty">
          Search Console is daily only, so it has no figure for an hourly range.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          label="Show the last 7 d"
          @click="emit('show-daily')"
        />
      </template>
      <p v-else-if="failureKind === 'not_configured'" class="ne-an-empty">
        Search Console is not set up for this app.
      </p>
      <p v-else-if="failure && !data" class="ne-an-empty">Search not measured: {{ failure }}</p>
      <div v-else-if="loading && !data" aria-hidden="true">
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
      </div>
      <p v-else-if="!rows.length" class="ne-an-empty">
        Search Console has no {{ noun }} for these days.
      </p>
      <template v-else>
        <UTable
          class="ne-an-scroll"
          sticky
          :data="rows"
          :columns="columns"
          :ui="{ td: 'whitespace-normal break-words' }"
        />
        <p v-if="data" class="ne-an-note" style="margin-top: 10px">
          {{ data.startDate }} to {{ data.endDate }} · top 50 by clicks · Google lags two to three
          days, so the latest days are incomplete.
        </p>
      </template>
    </div>
  </section>
</template>
