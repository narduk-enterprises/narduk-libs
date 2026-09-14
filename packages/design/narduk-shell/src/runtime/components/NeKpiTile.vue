<script setup lang="ts">
/**
 * NeKpiTile — one measured metric in a `UCard`: a label, a value, and an
 * optional signed delta with a caption (components backlog item 15,
 * narduk-libs#262).
 *
 * The value and the delta are formatted through item 5's `./format` subpath
 * (`formatNumber`), never with `Number.prototype.toLocaleString` — the same
 * SSR-stability rule the rest of the suite reads its numbers through:
 * `formatNumber`'s locale is a fixed `en-US` rather than the host's, so the
 * server and the browser render the exact same digits and grouping on the
 * first paint (`test/NeKpiTile.ssr.test.ts` is that proof). `value` and
 * `delta` also accept a plain string for a caller that already bound its own
 * formatter (`createFormatters().formatMoney(...)`, say) or needs a
 * formatter this component does not call itself.
 *
 * Colour is never the only signal for a delta's direction
 * (operator-portal's `SparkTile` gets this right and this component keeps
 * it): the rendered text always carries the sign (`formatNumber`'s
 * `signDisplay: 'always'`) and a ▲/▼ glyph, so the reading survives with
 * every tone-driven colour class removed. `tone` colours the delta; it never
 * changes what the delta *says*.
 *
 * `UCard` is referenced as a bare global tag rather than imported, the same
 * choice `NeStatusBadge` makes and for the same reason: this package
 * type-checks and unit-tests standalone, with no live Nuxt app of its own to
 * resolve `Card.vue`'s build-time-only `#build/ui/card` and `#imports`
 * specifiers. A real consuming app resolves the tag normally through Nuxt
 * UI's own global registration; `test/NeKpiTile.*.test.ts` register a fake
 * under the same global name.
 *
 * The `#spark` slot is deliberately just a slot: narduk-shell must not
 * depend on narduk-charts, so a sparkline (`NardukLineChart` or anything
 * else) is the caller's own composition, not this component's import.
 */
import { computed } from 'vue'

import { formatNumber } from '../../format'

import type { NeNumberOptions } from '../../format'
import type { NeStatusTone } from '../utils/status-map'

export interface NeKpiTileProps {
  /**
   * Change since a prior period, e.g. `-3`. Same dual reading as `value`: a
   * `number` is formatted with `formatNumber` (`signDisplay: 'always'` by
   * default, so the sign is always in the text) and gains a ▲/▼ direction
   * glyph; a `string` is rendered as-is, with no glyph — this component
   * cannot infer a sign from an arbitrary string, so the caller's own text
   * must already carry it. Omit `delta` entirely when there is nothing to
   * compare against.
   */
  delta?: number | string | null
  /** Forwarded to `formatNumber` when `delta` is a `number`. Ignored for a string delta. */
  deltaOptions?: NeNumberOptions
  /** Caption next to the delta, e.g. `"vs last week"`. */
  detail?: string
  /** The metric's name, shown above the value. */
  label: string
  /**
   * Semantic tone for the delta. Colours it only — it never substitutes for
   * the sign/glyph a delta always carries, and it says nothing about `value`
   * itself. Defaults to no colouring (`text-muted`).
   */
  tone?: NeStatusTone
  /**
   * The measured value. A `number` is formatted with `formatNumber`
   * (never `toLocaleString`); pass a pre-formatted `string` when the metric
   * needs a different formatter (`formatMoney`, `formatPercent`,
   * `formatCompact`, or a bound `createFormatters()` set). `null`/`undefined`
   * render `formatNumber`'s own empty placeholder (`—`).
   */
  value: number | string | null | undefined
  /** Forwarded to `formatNumber` when `value` is a `number`. Ignored for a string value. */
  valueOptions?: NeNumberOptions
}

const props = withDefaults(defineProps<NeKpiTileProps>(), {
  valueOptions: undefined,
  delta: undefined,
  deltaOptions: undefined,
  detail: '',
  tone: undefined,
})

defineSlots<{
  /**
   * An optional small chart under the value and delta, e.g. a
   * `NardukLineChart` sparkline. Left to the caller so narduk-shell never
   * depends on narduk-charts.
   */
  spark?(): unknown
}>()

/** Delta direction: shape, not hue — every reading also gets its own glyph. */
type NeKpiDeltaDirection = 'up' | 'down' | 'flat'

const DIRECTION_GLYPH: Readonly<Record<NeKpiDeltaDirection, string>> = {
  up: '▲',
  down: '▼',
  flat: '',
}

/** The tone vocabulary's colour, read the same way `NeStatusBadge` reads it. */
const TONE_TEXT_CLASS: Readonly<Record<NeStatusTone, string>> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  neutral: 'text-muted',
  pending: 'text-muted',
}

const displayValue = computed(() =>
  typeof props.value === 'string' ? props.value : formatNumber(props.value, props.valueOptions),
)

/**
 * The delta's full display text, glyph and sign already joined into one
 * string -- not split across a separate `aria-hidden` glyph span and a text
 * node, which would leave the visible reading dependent on how the template
 * compiler happens to treat the whitespace between them. `formatNumber`'s
 * `signDisplay: 'always'` already puts the sign in the text either way, so
 * the direction is legible from `deltaDisplay` alone with no glyph at all;
 * the glyph is a second, redundant cue, not the only one.
 */
const deltaDisplay = computed<string | null>(() => {
  if (props.delta === null || props.delta === undefined) return null
  if (typeof props.delta === 'string') return props.delta
  const direction: NeKpiDeltaDirection = props.delta > 0 ? 'up' : props.delta < 0 ? 'down' : 'flat'
  const text = formatNumber(props.delta, { signDisplay: 'always', ...props.deltaOptions })
  const glyph = DIRECTION_GLYPH[direction]
  return glyph ? `${glyph} ${text}` : text
})

const toneClass = computed(() => TONE_TEXT_CLASS[props.tone ?? 'neutral'])
</script>

<template>
  <UCard data-testid="ne-kpi-tile">
    <dl class="ne-kpi-tile">
      <dt class="text-xs font-medium uppercase tracking-wide text-muted">{{ label }}</dt>
      <dd class="ne-kpi-tile__value mt-1 font-medium text-highlighted">{{ displayValue }}</dd>
      <dd
        v-if="deltaDisplay || detail"
        class="ne-kpi-tile__meta mt-1 flex flex-wrap items-baseline gap-x-1.5 text-sm"
      >
        <span
          v-if="deltaDisplay"
          data-testid="ne-kpi-tile-delta"
          class="ne-kpi-tile__delta font-medium"
          :class="toneClass"
          >{{ deltaDisplay }}</span
        >
        <span v-if="detail" class="ne-kpi-tile__detail text-muted">{{ detail }}</span>
      </dd>
    </dl>
    <div v-if="$slots.spark" class="ne-kpi-tile__spark mt-3">
      <slot name="spark" />
    </div>
  </UCard>
</template>
