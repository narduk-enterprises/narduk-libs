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

function asNumber(value: unknown, format: (n: number) => string): string | null {
  return typeof value === 'number' ? format(value) : null
}

function asZonedDate(
  value: unknown,
  timeZone: string | undefined,
  format: (input: NeDateInput, options: { timeZone: string }) => string,
): string | null {
  return timeZone ? format(value as NeDateInput, { timeZone }) : null
}

/** Each formatter returns `null` when it cannot render the value it was given. */
const FORMATTERS: Record<
  NeDetailFormat,
  (item: NeDetailItem, value: unknown, timeZone: string | undefined) => string | null
> = {
  compact: (_item, value) => asNumber(value, formatCompact),
  date: (item, value, timeZone) => asZonedDate(value, item.timeZone ?? timeZone, formatDate),
  datetime: (item, value, timeZone) =>
    asZonedDate(value, item.timeZone ?? timeZone, formatDateTime),
  duration: (_item, value) => asNumber(value, formatDuration),
  money: (item, value) =>
    typeof value === 'number' && item.currency
      ? formatMoney(value, { currency: item.currency })
      : null,
  number: (_item, value) => asNumber(value, formatNumber),
  percent: (_item, value) => asNumber(value, formatPercent),
  quantity: (item, value) =>
    typeof value === 'number' && item.unit ? formatQuantity(value, { unit: item.unit }) : null,
}

function formatted(item: NeDetailItem): string | null {
  if (isBlank(item.value)) return null
  if (item.format === undefined) {
    return typeof item.value === 'number' ? formatNumber(item.value) : String(item.value)
  }
  return FORMATTERS[item.format](item, item.value, props.timeZone)
}

/*
 * "Unavailable" is decided from the value, never by comparing the rendered
 * text with the placeholder: a reported "N/A" or "—" is still a reported
 * value (narduk-libs#875).
 */
const rows = computed(() =>
  props.items.map((item) => {
    const text = formatted(item)
    return text === null
      ? { item, text: item.empty ?? fallback.value, unavailable: true }
      : { item, text, unavailable: false }
  }),
)
</script>

<template>
  <dl data-ne-detail-view data-testid="ne-detail-view" class="ne-detail-view space-y-2">
    <div
      v-for="row in rows"
      :key="row.item.label"
      class="ne-detail-view__row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      :data-ne-detail-unavailable="row.unavailable ? 'true' : undefined"
    >
      <dt class="ne-detail-view__label text-sm text-muted">{{ row.item.label }}</dt>
      <dd
        class="ne-detail-view__value text-sm"
        :class="row.unavailable ? 'text-muted' : 'font-mono tabular-nums text-highlighted'"
      >
        {{ row.text }}
      </dd>
    </div>
  </dl>
</template>
