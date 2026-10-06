<script setup lang="ts">
import { computed } from 'vue'

import { adminFormatCount } from '../../utils/analyticsAdminRange'

import type {
  AdminAnalyticsOriginDimension,
  AdminAnalyticsOrigins,
} from '../../types/adminAnalyticsTypes'

const props = defineProps<{
  data: AdminAnalyticsOrigins | null
  dimension: AdminAnalyticsOriginDimension
  failure: string
  loading: boolean
}>()

const emit = defineEmits<{ 'update:dimension': [value: AdminAnalyticsOriginDimension] }>()

const TABS: Array<{ id: AdminAnalyticsOriginDimension; label: string; none: string }> = [
  { id: 'channels', label: 'Channels', none: '' },
  { id: 'referrers', label: 'Referrers', none: '' },
  { id: 'campaigns', label: 'Campaigns', none: 'sessions carry no campaign' },
  { id: 'landing', label: 'Landing pages', none: '' },
  { id: 'countries', label: 'Countries', none: 'sessions have no country' },
]

const items = computed(() =>
  (props.data?.rows ?? []).map((row) => ({
    group: row.group,
    label: row.label,
    other: row.other,
    unknown: row.unknown,
    value: row.sessions,
  })),
)
const noValue = computed(() => TABS.find((tab) => tab.id === props.dimension)?.none ?? '')
</script>

<template>
  <section class="ne-an-panel" aria-label="Where sessions come from">
    <div class="ne-an-panel-head">
      <h2>Origins</h2>
      <div class="ne-an-metrics" role="tablist" aria-label="Origin dimension">
        <UButton
          v-for="tab in TABS"
          :key="tab.id"
          role="tab"
          class="ne-an-tab"
          color="neutral"
          variant="ghost"
          :aria-selected="dimension === tab.id"
          :label="tab.label"
          @click="emit('update:dimension', tab.id)"
        />
      </div>
    </div>
    <div class="ne-an-panel-body">
      <p v-if="failure && !data" class="ne-an-empty">Origins not measured: {{ failure }}</p>
      <div v-else-if="loading && !data" aria-hidden="true">
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
      </div>
      <p v-else-if="!items.length" class="ne-an-empty">
        No sessions with {{ TABS.find((tab) => tab.id === dimension)?.label.toLowerCase() }} in this
        range.
      </p>
      <template v-else>
        <AdminAnalyticsBarList :items="items" :title="`Sessions by ${dimension}`" share />
        <p class="ne-an-note" style="margin-top: 10px">
          Sessions, by each session's first pageview. A blank referrer is unknown, not direct.
          <template v-if="data?.truncated">
            Long groups are cut to the top rows; the rest is folded into “N more”.</template
          >
          <template v-if="data?.sessionsWithoutValue && noValue">
            {{ adminFormatCount(data.sessionsWithoutValue) }} {{ noValue }}; they are not in the
            rows.
          </template>
        </p>
      </template>
    </div>
  </section>
</template>
