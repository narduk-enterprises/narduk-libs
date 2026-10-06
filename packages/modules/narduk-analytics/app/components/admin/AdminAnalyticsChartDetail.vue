<script setup lang="ts">
/** The reading under the chart: every drawn series for the bucket the pointer or keys are on. */
defineProps<{
  detail: {
    open: boolean
    rows: Array<{ id: string; label: string; value: string }>
    title: string
  } | null
  /** "day" or "bucket". */
  unit: string
}>()
</script>

<template>
  <div class="ne-an-detail" aria-live="polite">
    <template v-if="detail">
      <b>{{ detail.title }}</b>
      <span v-if="detail.open" class="ne-an-note"> · still filling</span>
      <dl>
        <div v-for="row in detail.rows" :key="row.id">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </template>
    <span v-else class="ne-an-note">
      Hover, tap or use the arrow keys on the chart to read one {{ unit }}.
    </span>
  </div>
</template>
