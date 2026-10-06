<script setup lang="ts">
import type { AdminTile } from '../../utils/analyticsAdminTiles'

defineProps<{
  loading: boolean
  tiles: AdminTile[]
}>()

const emit = defineEmits<{ 'show-daily': [] }>()
</script>

<template>
  <section class="ne-an-kpis" aria-label="Key figures" :aria-busy="loading">
    <div v-for="tile in tiles" :key="tile.id" class="ne-an-kpi">
      <span class="ne-an-label">
        {{ tile.label }}
        <span v-if="tile.badge" class="ne-an-badge ne-an-badge--bare" data-state="warn">{{
          tile.badge
        }}</span>
      </span>
      <span class="ne-an-kpi-value" :data-muted="tile.notMeasured">{{ tile.value }}</span>
      <span v-if="tile.delta" class="ne-an-delta" :data-sign="tile.delta.sign">{{
        tile.delta.label
      }}</span>
      <span class="ne-an-note">{{ tile.note }}</span>
      <UButton
        v-if="tile.notMeasured && /daily only/iu.test(tile.note)"
        color="neutral"
        variant="outline"
        label="Use 7 d"
        @click="emit('show-daily')"
      />
    </div>
  </section>
</template>
