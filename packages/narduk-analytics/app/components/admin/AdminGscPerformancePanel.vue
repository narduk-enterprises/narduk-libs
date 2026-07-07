<script setup lang="ts">
import {
  ADMIN_GSC_DIMENSIONS,
  type AdminGscDimension,
} from '../../composables/useAdminGscPerformance'

const filters = reactive({
  startDate: '',
  endDate: '',
  dimension: 'query' as AdminGscDimension,
})

const gscColumns = [
  { accessorKey: 'key', header: 'Key' },
  { accessorKey: 'clicks', header: 'Clicks' },
  { accessorKey: 'impressions', header: 'Impressions' },
  { accessorKey: 'ctr', header: 'CTR' },
  { accessorKey: 'position', header: 'Position' },
]

const gsc = useAdminGscPerformance({
  dimension: computed(() => filters.dimension),
  startDate: computed(() => filters.startDate || undefined),
  endDate: computed(() => filters.endDate || undefined),
})

const gscRows = computed(() =>
  gsc.data.value.rows.map((row) => ({
    key: row.keys.join(' / '),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: `${(row.ctr * 100).toFixed(2)}%`,
    position: row.position.toFixed(2),
  })),
)
</script>

<template>
  <UCard class="card-base border-default">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">Search Console</p>
          <h2 class="text-lg font-semibold text-default">Performance</h2>
          <p class="text-sm text-muted">
            Dimension-based search performance for shared admin dashboards.
          </p>
        </div>

        <div class="flex flex-wrap gap-3">
          <UFormField label="Dimension">
            <!-- eslint-disable-next-line narduk/no-unknown-component-prop -- False positive on v-model mapping to modelValue -->
            <USelectMenu v-model="filters.dimension" :items="[...ADMIN_GSC_DIMENSIONS]" />
          </UFormField>
          <UFormField label="Start">
            <UInput v-model="filters.startDate" type="date" />
          </UFormField>
          <UFormField label="End">
            <UInput v-model="filters.endDate" type="date" />
          </UFormField>
          <UButton
            color="neutral"
            variant="outline"
            :loading="gsc.status.value === 'pending'"
            @click="gsc.refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>

      <p v-if="gsc.data.value?.fetchedAt" class="text-xs text-muted">
        Cached: {{ gsc.data.value.cached ? 'yes' : 'no' }}. Fetched {{ gsc.data.value.fetchedAt }}.
      </p>

      <div class="overflow-hidden rounded-xl border border-default">
        <UTable
          :data="gscRows"
          :columns="gscColumns"
          :loading="gsc.status.value === 'pending'"
          empty="No Search Console rows found for this range."
        />
      </div>
    </div>
  </UCard>
</template>
