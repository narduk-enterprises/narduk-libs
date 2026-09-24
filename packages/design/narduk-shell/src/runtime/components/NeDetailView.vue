<script setup lang="ts">
/**
 * NeDetailView — a key-value panel (components backlog item 17,
 * narduk-libs#264). Each row is a label, a value, an optional `./format`
 * name and unit, and a missing reading that never looks like zero.
 *
 * Numbers and dates go through the `./format` subpath, never through
 * `toLocaleString` or a host time zone. A `date` / `datetime` row without
 * an explicit zone (row or panel) is treated as unavailable rather than
 * rendered in whichever zone the Worker and the browser happen to disagree
 * on — that is the hydration class item 5 exists to remove.
 *
 * `relative` is not a format here: it needs a caller-supplied `now`. Format
 * that string at the call site and pass it as a pre-formatted value.
 */
import { computed } from 'vue'

import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  type NeDateInput,
} from '../../format'

import type { NeDetailItem, NeDetailViewProps } from './ne-detail-view-types'

const props = withDefaults(defineProps<NeDetailViewProps>(), {
  timeZone: undefined,
  unavailableMessage: undefined,
})

const fallback = computed(() => props.unavailableMessage ?? formatNumber(null))

function isBlank(value: NeDetailItem['value']): boolean {
  return (
    value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))
  )
}

function displayValue(item: NeDetailItem): string {
  if (isBlank(item.value)) return item.empty ?? fallback.value

  const value = item.value
  switch (item.format) {
    case 'compact':
      return typeof value === 'number' ? formatCompact(value) : String(value)
    case 'date': {
      const timeZone = item.timeZone ?? props.timeZone
      if (!timeZone) return item.empty ?? fallback.value
      return formatDate(value as NeDateInput, { timeZone })
    }
    case 'datetime': {
      const timeZone = item.timeZone ?? props.timeZone
      if (!timeZone) return item.empty ?? fallback.value
      return formatDateTime(value as NeDateInput, { timeZone })
    }
    case 'duration':
      return typeof value === 'number' ? formatDuration(value) : String(value)
    case 'money':
      if (typeof value !== 'number' || !item.currency) return item.empty ?? fallback.value
      return formatMoney(value, { currency: item.currency })
    case 'number':
      return typeof value === 'number' ? formatNumber(value) : String(value)
    case 'percent':
      return typeof value === 'number' ? formatPercent(value) : String(value)
    case 'quantity':
      if (typeof value !== 'number' || !item.unit) return item.empty ?? fallback.value
      return formatQuantity(value, { unit: item.unit })
    default:
      return typeof value === 'number' ? formatNumber(value) : String(value)
  }
}

function isUnavailable(item: NeDetailItem): boolean {
  return displayValue(item) === (item.empty ?? fallback.value)
}
</script>

<template>
  <dl data-ne-detail-view data-testid="ne-detail-view" class="ne-detail-view space-y-2">
    <div
      v-for="item in items"
      :key="item.label"
      class="ne-detail-view__row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      :data-ne-detail-unavailable="isUnavailable(item) ? 'true' : undefined"
    >
      <dt class="ne-detail-view__label text-sm text-muted">{{ item.label }}</dt>
      <dd
        class="ne-detail-view__value text-sm"
        :class="isUnavailable(item) ? 'text-muted' : 'font-mono tabular-nums text-highlighted'"
      >
        {{ displayValue(item) }}
      </dd>
    </div>
  </dl>
</template>
