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
} from '../../format'

import type { NeDateInput } from '../../format'
import type { NeDetailFormat, NeDetailItem, NeDetailViewProps } from './ne-detail-view-types'

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

function asNumber(value: unknown, empty: string, format: (n: number) => string): string {
  return typeof value === 'number' ? format(value) : empty
}

function asZonedDate(
  value: unknown,
  timeZone: string | undefined,
  empty: string,
  format: (input: NeDateInput, options: { timeZone: string }) => string,
): string {
  if (!timeZone) return empty
  return format(value as NeDateInput, { timeZone })
}

const FORMATTERS: Record<
  NeDetailFormat,
  (item: NeDetailItem, value: unknown, empty: string, timeZone: string | undefined) => string
> = {
  compact: (_item, value, empty) => asNumber(value, empty, formatCompact),
  date: (item, value, empty, timeZone) =>
    asZonedDate(value, item.timeZone ?? timeZone, empty, formatDate),
  datetime: (item, value, empty, timeZone) =>
    asZonedDate(value, item.timeZone ?? timeZone, empty, formatDateTime),
  duration: (_item, value, empty) => asNumber(value, empty, formatDuration),
  money: (item, value, empty) =>
    typeof value === 'number' && item.currency
      ? formatMoney(value, { currency: item.currency })
      : empty,
  number: (_item, value, empty) => asNumber(value, empty, formatNumber),
  percent: (_item, value, empty) => asNumber(value, empty, formatPercent),
  quantity: (item, value, empty) =>
    typeof value === 'number' && item.unit ? formatQuantity(value, { unit: item.unit }) : empty,
}

function displayValue(item: NeDetailItem): string {
  const empty = item.empty ?? fallback.value
  if (isBlank(item.value)) return empty
  if (item.format === undefined) {
    return typeof item.value === 'number' ? formatNumber(item.value) : String(item.value)
  }
  return FORMATTERS[item.format](item, item.value, empty, props.timeZone)
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
