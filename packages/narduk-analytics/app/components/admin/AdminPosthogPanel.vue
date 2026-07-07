<script setup lang="ts">
/* eslint-disable narduk/file-size-budget -- PostHog admin panel is a cohesive dashboard surface (filters + KPIs + charts + event table) meant to be used as a single operator view. */
const filters = reactive({
  period: '30d',
  limit: 10,
})

const pagesColumns = [
  { accessorKey: 'page', header: 'Page' },
  { accessorKey: 'pageviews', header: 'Views' },
  { accessorKey: 'uniqueVisitors', header: 'Unique' },
]

const referrerColumns = [
  { accessorKey: 'referrer', header: 'Referrer' },
  { accessorKey: 'visits', header: 'Visits' },
  { accessorKey: 'uniqueVisitors', header: 'Unique' },
]

const deviceColumns = [
  { accessorKey: 'device', header: 'Device' },
  { accessorKey: 'pageviews', header: 'Views' },
  { accessorKey: 'uniqueVisitors', header: 'Unique' },
]

const recordingColumns = [
  { accessorKey: 'startTime', header: 'Started' },
  { accessorKey: 'personId', header: 'Visitor' },
  { accessorKey: 'duration', header: 'Duration' },
  { accessorKey: 'clickCount', header: 'Clicks' },
  { accessorKey: 'replayUrl', header: 'Replay' },
]

const dashboard = useAdminPosthogDashboard({
  period: computed(() => filters.period),
  limit: computed(() => filters.limit),
})

const insightSeries = computed(() => {
  const insightData = dashboard.insights.data.value
  const results = Array.isArray(insightData.results) ? insightData.results : []

  return results.map((result, index) => {
    const series = result as {
      action?: { name?: string }
      count?: number
      data?: number[]
      label?: string
    }

    return {
      label: series.label ?? series.action?.name ?? `Series ${index + 1}`,
      latestValue: Array.isArray(series.data) ? (series.data.at(-1) ?? 0) : (series.count ?? 0),
    }
  })
})

const pagesRows = computed(() => dashboard.pages.data.value.rows)
const referrerRows = computed(() => dashboard.referrers.data.value.rows)
const deviceRows = computed(() => dashboard.devices.data.value.rows)
const recordingRows = computed(() => dashboard.recordings.data.value?.recordings ?? [])
</script>

<template>
  <UCard class="card-base border-default">
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">PostHog</p>
          <h2 class="text-lg font-semibold text-default">Behavior Dashboard</h2>
          <p class="text-sm text-muted">
            Shared owner/admin analytics queries for pages, referrers, devices, and recordings.
          </p>
        </div>

        <div class="flex flex-wrap gap-3">
          <UFormField label="Period">
            <!-- eslint-disable-next-line narduk/no-unknown-component-prop -- False positive on v-model mapping to modelValue -->
            <USelectMenu v-model="filters.period" :items="['24h', '7d', '30d', '90d']" />
          </UFormField>
          <UFormField label="Recordings">
            <UInput v-model.number="filters.limit" type="number" min="1" max="50" />
          </UFormField>
          <UButton color="neutral" variant="outline" @click="dashboard.refreshAll()">
            Refresh
          </UButton>
        </div>
      </div>

      <div v-if="insightSeries.length > 0" class="grid gap-3 md:grid-cols-2">
        <div
          v-for="series in insightSeries"
          :key="series.label"
          class="rounded-xl border border-default bg-elevated/60 px-4 py-3"
        >
          <p class="text-xs uppercase tracking-wide text-muted">{{ series.label }}</p>
          <p class="mt-2 text-lg font-semibold text-default">{{ series.latestValue }}</p>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">Top Pages</h3>
          <div class="overflow-hidden rounded-xl border border-default">
            <UTable :data="pagesRows" :columns="pagesColumns" empty="No pageview rows found." />
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">Referrers</h3>
          <div class="overflow-hidden rounded-xl border border-default">
            <UTable
              :data="referrerRows"
              :columns="referrerColumns"
              empty="No referrer rows found."
            />
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">Devices</h3>
          <div class="overflow-hidden rounded-xl border border-default">
            <UTable :data="deviceRows" :columns="deviceColumns" empty="No device rows found." />
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">Entry / Exit</h3>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded-xl border border-default p-4">
              <p class="mb-3 text-xs uppercase tracking-wide text-muted">Entry Pages</p>
              <ul class="space-y-2 text-sm text-default">
                <li
                  v-for="row in dashboard.entryExit.data.value?.entryPages ?? []"
                  :key="`entry-${row.page}`"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="truncate">{{ row.page }}</span>
                  <span class="text-muted">{{ row.count }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-xl border border-default p-4">
              <p class="mb-3 text-xs uppercase tracking-wide text-muted">Exit Pages</p>
              <ul class="space-y-2 text-sm text-default">
                <li
                  v-for="row in dashboard.entryExit.data.value?.exitPages ?? []"
                  :key="`exit-${row.page}`"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="truncate">{{ row.page }}</span>
                  <span class="text-muted">{{ row.count }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
            Recent Recordings
          </h3>
          <UButton
            v-if="dashboard.recordings.data.value?.projectReplayUrl"
            :to="dashboard.recordings.data.value.projectReplayUrl"
            target="_blank"
            color="neutral"
            variant="ghost"
          >
            Open PostHog
          </UButton>
        </div>

        <div class="overflow-hidden rounded-xl border border-default">
          <UTable
            :data="recordingRows"
            :columns="recordingColumns"
            empty="No recent recordings found."
          >
            <template #replayUrl-cell="{ row }">
              <UButton
                :to="row.original.replayUrl"
                target="_blank"
                size="xs"
                variant="ghost"
                color="primary"
              >
                Replay
              </UButton>
            </template>
          </UTable>
        </div>
      </section>
    </div>
  </UCard>
</template>
