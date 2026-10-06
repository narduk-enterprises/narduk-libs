<script setup lang="ts">
import { computed } from 'vue'

import type {
  AdminAnalyticsDevices,
  AdminAnalyticsEntryExit,
  AdminAnalyticsPages,
} from '../../types/adminAnalyticsTypes'

const props = defineProps<{
  devices: AdminAnalyticsDevices | null
  entryExit: AdminAnalyticsEntryExit | null
  failure: string
  loading: boolean
  pages: AdminAnalyticsPages | null
  range: string
}>()

const topPages = computed(() =>
  (props.pages?.rows ?? []).slice(0, 10).map((row) => ({ label: row.page, value: row.pageviews })),
)
const entry = computed(() =>
  (props.entryExit?.entryPages ?? []).map((row) => ({ label: row.page, value: row.count })),
)
const exit = computed(() =>
  (props.entryExit?.exitPages ?? []).map((row) => ({ label: row.page, value: row.count })),
)
const devices = computed(() =>
  (props.devices?.rows ?? []).map((row) => ({
    label: row.unknown ? 'Unknown' : row.device,
    unknown: row.unknown,
    value: row.pageviews,
  })),
)
const ready = computed(() => Boolean(props.pages || props.devices || props.entryExit))
const pageviews = computed(() => (props.pages?.rows ?? []).reduce((s, r) => s + r.pageviews, 0))
</script>

<template>
  <section class="ne-an-panel" aria-label="Behavior">
    <div class="ne-an-panel-head">
      <h2>Behavior</h2>
      <span v-if="pages" class="ne-an-note">{{ range }}</span>
    </div>
    <div class="ne-an-panel-body">
      <p v-if="failure && !ready" class="ne-an-empty">Behavior not measured: {{ failure }}</p>
      <div v-else-if="loading && !ready" aria-hidden="true">
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
      </div>
      <div v-else class="ne-an-grid ne-an-grid--cols-3">
        <div class="ne-an-col">
          <h3 class="ne-an-label ne-an-subhead">Top pages · pageviews</h3>
          <AdminAnalyticsBarList v-if="topPages.length" :items="topPages" title="Top pages" />
          <p v-else class="ne-an-empty">No pageviews in this range.</p>
          <p v-if="pages && pageviews" class="ne-an-note">Top 10 by pageviews.</p>
        </div>
        <div class="ne-an-col">
          <h3 class="ne-an-label ne-an-subhead">Entry pages · sessions</h3>
          <AdminAnalyticsBarList v-if="entry.length" :items="entry" title="Entry pages" />
          <p v-else class="ne-an-empty">No sessions in this range.</p>
          <h3 class="ne-an-label ne-an-subhead" style="margin-top: 18px">Exit pages · sessions</h3>
          <AdminAnalyticsBarList v-if="exit.length" :items="exit" title="Exit pages" />
          <p v-else class="ne-an-empty">No sessions in this range.</p>
          <p class="ne-an-note">First and last pageview of each session.</p>
        </div>
        <div class="ne-an-col">
          <h3 class="ne-an-label ne-an-subhead">Devices · pageviews</h3>
          <AdminAnalyticsBarList v-if="devices.length" :items="devices" title="Devices" share />
          <p v-else class="ne-an-empty">No pageviews in this range.</p>
        </div>
      </div>
    </div>
  </section>
</template>
