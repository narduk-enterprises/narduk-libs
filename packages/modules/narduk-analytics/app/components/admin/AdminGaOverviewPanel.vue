<script setup lang="ts">
const filters = reactive({
  startDate: '',
  endDate: '',
})

const gaColumns = [
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'activeUsers', header: 'Active Users' },
  { accessorKey: 'sessions', header: 'Sessions' },
  { accessorKey: 'pageviews', header: 'Pageviews' },
]

const ga = useAdminGaOverview({
  startDate: computed(() => filters.startDate || undefined),
  endDate: computed(() => filters.endDate || undefined),
})

const metricCards = computed(() => {
  const totals = ga.data.value.totals

  return [
    { label: 'Active Users', value: totals[0]?.value ?? '0' },
    { label: 'Sessions', value: totals[1]?.value ?? '0' },
    { label: 'Pageviews', value: totals[2]?.value ?? '0' },
    { label: 'Bounce Rate', value: totals[3]?.value ?? '0' },
    { label: 'Avg. Session Duration', value: totals[4]?.value ?? '0' },
  ]
})

const gaRows = computed(() =>
  ga.data.value.rows.map((row) => ({
    date: row.dimensionValues?.[0]?.value ?? 'n/a',
    activeUsers: row.metricValues?.[0]?.value ?? '0',
    sessions: row.metricValues?.[1]?.value ?? '0',
    pageviews: row.metricValues?.[2]?.value ?? '0',
  })),
)
</script>

<template>
  <UCard class="card-base border-default">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">GA4</p>
          <h2 class="text-lg font-semibold text-default">Traffic Overview</h2>
          <p class="text-sm text-muted">
            Shared admin summary for active users, sessions, and pageviews.
          </p>
        </div>

        <div class="flex flex-wrap gap-3">
          <UFormField label="Start">
            <UInput v-model="filters.startDate" type="date" />
          </UFormField>
          <UFormField label="End">
            <UInput v-model="filters.endDate" type="date" />
          </UFormField>
          <UButton
            color="neutral"
            variant="outline"
            :loading="ga.status.value === 'pending'"
            @click="ga.refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-5">
        <div
          v-for="card in metricCards"
          :key="card.label"
          class="rounded-xl border border-default bg-elevated/60 px-4 py-3"
        >
          <p class="text-xs uppercase tracking-wide text-muted">{{ card.label }}</p>
          <p class="mt-2 text-lg font-semibold text-default">{{ card.value }}</p>
        </div>
      </div>

      <p v-if="ga.data.value?.fetchedAt" class="text-xs text-muted">
        Cached: {{ ga.data.value.cached ? 'yes' : 'no' }}. Fetched {{ ga.data.value.fetchedAt }}.
      </p>

      <div class="overflow-hidden rounded-xl border border-default">
        <UTable
          :data="gaRows"
          :columns="gaColumns"
          :loading="ga.status.value === 'pending'"
          empty="No GA rows found for this range."
        />
      </div>
    </div>
  </UCard>
</template>
