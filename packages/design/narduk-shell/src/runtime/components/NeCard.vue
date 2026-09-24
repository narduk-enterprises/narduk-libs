<script setup lang="ts">
/**
 * NeCard — one entity card wrapping `UCard` (components backlog item 17,
 * narduk-libs#264). Media, title, badge, stat rows, actions.
 *
 * It wraps Nuxt UI rather than reimplementing it: `UCard` is the frame,
 * `NeStatusBadge` is the chip. Numbers go through `./format` (`formatNumber`
 * / `formatQuantity`), never `toLocaleString` — the same SSR-stability rule
 * as `NeKpiTile`.
 *
 * `UCard` is a bare global tag, the same choice `NeKpiTile` makes and for
 * the same reason: this package type-checks and unit-tests standalone, with
 * no live Nuxt app of its own to resolve `Card.vue`'s build-time-only
 * `#build/ui/card` and `#imports` specifiers. A real consuming app resolves
 * the tag through Nuxt UI's registration; the mount and SSR suites register
 * a fake under the same name.
 */
import { computed } from 'vue'

import { formatNumber, formatQuantity } from '../../format'
import NeStatusBadge from './NeStatusBadge.vue'

import type { NeCardProps, NeCardStat } from './ne-card-types'
import type { NeStatusTone } from '../utils/status-map'

const props = withDefaults(defineProps<NeCardProps>(), {
  badge: undefined,
  media: '',
  mediaAlt: '',
  stats: () => [],
  title: '',
})

defineSlots<{
  /** Trailing controls — edit, open, a confirm. Rendered in `UCard`'s footer. */
  actions?(): unknown
  /** Replaces the badge chip. */
  badge?(): unknown
  /** Body under the stats. */
  default?(): unknown
  /** Replaces the `<img>` when `media` is not a URL. */
  media?(): unknown
  /** Replaces the title text. */
  title?(): unknown
}>()

const badge = computed<{ label: string; tone: NeStatusTone } | null>(() => {
  if (props.badge === undefined || props.badge === '') return null
  if (typeof props.badge === 'string') return { label: props.badge, tone: 'neutral' }
  return props.badge
})

const mediaAlt = computed(() => props.mediaAlt || props.title)

function isBlank(value: NeCardStat['value']): boolean {
  return (
    value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))
  )
}

function statText(stat: NeCardStat): string {
  if (isBlank(stat.value)) return formatNumber(null)
  if (typeof stat.value === 'string') return stat.value
  if (stat.unit) return formatQuantity(stat.value, { unit: stat.unit })
  return formatNumber(stat.value)
}
</script>

<template>
  <UCard data-ne-card data-testid="ne-card">
    <template v-if="title || badge || $slots.title || $slots.badge" #header>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="ne-card__title min-w-0 font-medium text-highlighted">
          <slot name="title">{{ title }}</slot>
        </div>
        <div v-if="badge || $slots.badge" class="ne-card__badge">
          <slot name="badge">
            <NeStatusBadge v-if="badge" :label="badge.label" :tone="badge.tone" />
          </slot>
        </div>
      </div>
    </template>

    <div v-if="media || $slots.media" data-ne-card-media class="ne-card__media">
      <slot name="media">
        <img :src="media" :alt="mediaAlt" class="w-full" />
      </slot>
    </div>

    <dl v-if="stats.length" data-ne-card-stats class="ne-card__stats mt-2 space-y-1 text-sm">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="flex flex-wrap items-baseline justify-between gap-x-3"
      >
        <dt class="text-muted">{{ stat.label }}</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ statText(stat) }}</dd>
      </div>
    </dl>

    <div v-if="$slots.default" class="ne-card__body mt-2">
      <slot />
    </div>

    <template v-if="$slots.actions" #footer>
      <div data-ne-card-actions class="ne-card__actions">
        <slot name="actions" />
      </div>
    </template>
  </UCard>
</template>
