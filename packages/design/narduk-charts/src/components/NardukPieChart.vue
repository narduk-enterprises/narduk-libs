<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChart } from '../composables/useChart'
import { useTooltip } from '../composables/useTooltip'
import { describeArc, easeOutCubic, formatValue } from '../utils/math'
import { getColor } from '../utils/colors'
import ChartTooltip from './ChartTooltip.vue'
import ChartLegend from './ChartLegend.vue'
import type {
  PieDataItem,
  LegendItem,
  TooltipItem,
  PieSliceClickPayload,
  ChartTheme,
} from '../types'
import { chartThemeClass } from '../utils/chartTheme'

interface SliceData {
  path: string
  color: string
  item: PieDataItem
  midAngle: number
  percentage: number
  labelX: number
  labelY: number
}

const props = withDefaults(defineProps<{
  data: PieDataItem[]
  width?: number
  height?: number
  donut?: boolean
  innerRadius?: number
  showLabels?: boolean
  colors?: string[]
  animate?: boolean
  dark?: boolean
  respectReducedMotion?: boolean
  theme?: ChartTheme
}>(), {
  donut: false,
  innerRadius: 0.6,
  showLabels: true,
  animate: true,
  respectReducedMotion: true,
})

const emit = defineEmits<{
  sliceClick: [payload: PieSliceClickPayload]
}>()

defineSlots<{
  empty?: () => unknown
  tooltip?: (props: { title: string; items: TooltipItem[]; visible: boolean }) => unknown
  'legend-item'?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()

const containerRef = ref<HTMLElement | null>(null)
const { chartWidth, chartHeight, padding, isDark, effectiveAnimate } = useChart(
  containerRef, props,
  { top: 20, right: 20, bottom: 20, left: 20 },
)
const { tooltip, show: showTooltip, hide: hideTooltip } = useTooltip()

const rootChartClasses = computed(() => {
  const c = ['narduk-chart']
  if (isDark.value) c.push('narduk-chart--dark')
  const t = chartThemeClass(props.theme)
  if (t) c.push(t)
  return c
})

const runAnimation = computed(() => effectiveAnimate(props.animate))

// ── Series visibility ────────────────────────────────────────

const hiddenItems = ref(new Set<string>())

function toggleItem(label: string) {
  const next = new Set(hiddenItems.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  hiddenItems.value = next
}

const visibleData = computed(() =>
  props.data.filter(d => !hiddenItems.value.has(d.label)),
)

// ── Geometry ─────────────────────────────────────────────────

const cx = computed(() => chartWidth.value / 2)
const cy = computed(() => (chartHeight.value - 40) / 2 + padding.value.top)

const outerRadius = computed(() => {
  const w = chartWidth.value - padding.value.left - padding.value.right
  const h = chartHeight.value - padding.value.top - padding.value.bottom - 40
  return Math.max(20, Math.min(w, h) / 2 - 10)
})

const innerR = computed(() =>
  props.donut ? outerRadius.value * props.innerRadius : 0,
)

// ── Animation ────────────────────────────────────────────────

const progress = ref(0)
let rafId = 0

onMounted(() => {
  if (!runAnimation.value) {
    progress.value = 1
    return
  }
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const duration = 800

  function tick(now: number) {
    const t = Math.min((now - start) / duration, 1)
    progress.value = easeOutCubic(t)
    if (t < 1) rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)
})

onUnmounted(() => cancelAnimationFrame(rafId))

// ── Slices ───────────────────────────────────────────────────

const total = computed(() =>
  visibleData.value.reduce((s, d) => s + d.value, 0),
)

const isEmpty = computed(() =>
  props.data.length === 0 || visibleData.value.length === 0 || total.value <= 0,
)

const slices = computed<SliceData[]>(() => {
  const result: SliceData[] = []
  const t = total.value
  if (t === 0) return result

  const startOffset = -Math.PI / 2
  let currentAngle = startOffset

  for (const item of visibleData.value) {
    const fraction = item.value / t
    const sweep = fraction * 2 * Math.PI * progress.value
    const endAngle = currentAngle + sweep

    const oR = outerRadius.value
    const iR = innerR.value
    const midAngle = currentAngle + sweep / 2
    const labelRadius = props.donut ? (oR + iR) / 2 : oR * 0.65
    const idx = props.data.indexOf(item)

    result.push({
      path: sweep > 0.001 ? describeArc(cx.value, cy.value, oR, iR, currentAngle, endAngle) : '',
      color: item.color || getColor(props.colors, idx),
      item,
      midAngle,
      percentage: fraction * 100,
      labelX: cx.value + labelRadius * Math.cos(midAngle),
      labelY: cy.value + labelRadius * Math.sin(midAngle),
    })

    currentAngle = endAngle
  }

  return result
})

// ── Hover ────────────────────────────────────────────────────

const hoverIndex = ref<number | null>(null)

function onMouseMove(event: MouseEvent) {
  const svg = containerRef.value?.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  const sx = mouseX * (chartWidth.value / rect.width)
  const sy = mouseY * (chartHeight.value / rect.height)

  const dx = sx - cx.value
  const dy = sy - cy.value
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist > outerRadius.value || (props.donut && dist < innerR.value)) {
    hoverIndex.value = null
    hideTooltip()
    return
  }

  let angle = Math.atan2(dy, dx)
  if (angle < -Math.PI / 2) angle += 2 * Math.PI

  const startOffset = -Math.PI / 2
  let cumAngle = startOffset

  for (let i = 0; i < slices.value.length; i++) {
    const fraction = slices.value[i].item.value / total.value
    const sweep = fraction * 2 * Math.PI * progress.value
    if (angle >= cumAngle && angle < cumAngle + sweep) {
      hoverIndex.value = i
      const s = slices.value[i]
      const items: TooltipItem[] = [{
        color: s.color,
        label: s.item.label,
        value: `${formatValue(s.item.value)} (${s.percentage.toFixed(1)}%)`,
      }]
      showTooltip(mouseX, mouseY, '', items)
      return
    }
    cumAngle += sweep
  }

  hoverIndex.value = null
  hideTooltip()
}

function onMouseLeave() {
  hoverIndex.value = null
  hideTooltip()
}

function onSliceClick(slice: SliceData, e: MouseEvent) {
  e.stopPropagation()
  emit('sliceClick', {
    label: slice.item.label,
    value: slice.item.value,
    percentage: slice.percentage,
  })
}

// ── Legend ────────────────────────────────────────────────────

const legendItems = computed<LegendItem[]>(() =>
  props.data.map((d, i) => ({
    name: d.label,
    color: d.color || getColor(props.colors, i),
    hidden: hiddenItems.value.has(d.label),
  })),
)

function sliceTransform(index: number): string {
  if (hoverIndex.value !== index) return 'translate(0,0)'
  const s = slices.value[index]
  const offset = 8
  const tx = offset * Math.cos(s.midAngle)
  const ty = offset * Math.sin(s.midAngle)
  return `translate(${tx},${ty})`
}
</script>

<template>
  <div
    ref="containerRef"
    :class="rootChartClasses"
    :style="{ width: props.width ? `${props.width}px` : '100%' }"
  >
    <div
      v-if="isEmpty"
      class="narduk-chart__empty"
    >
      <slot name="empty">No data</slot>
    </div>
    <svg
      v-else-if="chartWidth > 0"
      :width="chartWidth"
      :height="chartHeight"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    >
      <g v-for="(slice, i) in slices" :key="slice.item.label">
        <path
          v-if="slice.path"
          class="narduk-pie-slice"
          :d="slice.path"
          :fill="slice.color"
          :opacity="hoverIndex !== null && hoverIndex !== i ? 0.6 : 1"
          :transform="sliceTransform(i)"
          @click="onSliceClick(slice, $event)"
        />
      </g>

      <!-- Labels (shown after animation completes) -->
      <g v-if="showLabels && progress >= 0.95">
        <text
          v-for="slice in slices"
          :key="'lbl-' + slice.item.label"
          class="narduk-pie-label"
          :x="slice.labelX"
          :y="slice.labelY - 6"
          text-anchor="middle"
          dominant-baseline="auto"
        >
          {{ slice.item.label }}
        </text>
        <text
          v-for="slice in slices"
          :key="'pct-' + slice.item.label"
          class="narduk-pie-value"
          :x="slice.labelX"
          :y="slice.labelY + 8"
          text-anchor="middle"
          dominant-baseline="auto"
        >
          {{ slice.percentage.toFixed(1) }}%
        </text>
      </g>

      <!-- Donut center label -->
      <text
        v-if="donut"
        class="narduk-pie-label"
        :x="cx"
        :y="cy - 6"
        text-anchor="middle"
        dominant-baseline="auto"
        font-size="20"
        font-weight="700"
      >
        {{ formatValue(total) }}
      </text>
      <text
        v-if="donut"
        class="narduk-pie-value"
        :x="cx"
        :y="cy + 14"
        text-anchor="middle"
        dominant-baseline="auto"
      >
        Total
      </text>
    </svg>

    <template v-if="!isEmpty">
      <ChartLegend
        :items="legendItems"
        @toggle="toggleItem"
      >
        <template
          v-if="$slots['legend-item']"
          #item="slotProps"
        >
          <slot
            name="legend-item"
            v-bind="slotProps"
          />
        </template>
      </ChartLegend>
      <ChartTooltip
        v-bind="tooltip"
        :chart-width="chartWidth"
      >
        <template
          v-if="$slots.tooltip"
          #content="slotProps"
        >
          <slot
            name="tooltip"
            v-bind="slotProps"
          />
        </template>
      </ChartTooltip>
    </template>
  </div>
</template>
