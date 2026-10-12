<script setup lang="ts">
import { computed, ref, toRaw, useId } from 'vue'

import { drawPoints, drawShapes, layoutLabels, type DrawnPoint, type DrawnShape } from '../layout'
import { createFrameView, createMapView, resolveBounds, type ViewPoint } from '../projection'
import { metricsFor } from '../tokens'
import MapTable from './MapTable.vue'

import type { Bounds, CutoutLayer, GeoMapProps, MapMetrics, MapPoint, ShapeFeature } from '../types'
import type { MarkColor } from '../marks'

/**
 * SVG map. Draws from a viewBox, never measures the DOM and never reads the clock, so the
 * server render and the client render are identical. Hover and focus state starts empty.
 */
const props = withDefaults(defineProps<GeoMapProps & { metrics?: Partial<MapMetrics> }>(), {
  shapes: null,
  idKey: 'id',
  nameKey: 'name',
  fills: undefined,
  hatch: undefined,
  water: true,
  points: () => [],
  highlight: null,
  selected: null,
  interactive: false,
  plain: false,
  levelText: undefined,
  labels: 'shapes',
  width: 520,
  height: undefined,
  padding: 14,
  bounds: null,
  ariaLabel: 'Map',
  table: false,
  scheme: null,
  basemap: null,
  metrics: undefined,
})

const emit = defineEmits<{
  select: [id: string]
  'point-hover': [id: string | null]
}>()

defineSlots<{
  tooltip?: (scope: {
    kind: 'shape' | 'point'
    id: string
    title: string
    text: string
    point: MapPoint | null
    feature: ShapeFeature | null
  }) => unknown
}>()

const uid = useId()
const hatchId = `${uid}-hatch`
const maskId = `${uid}-water`
const clipId = `${uid}-clip`

const metrics = computed(() => metricsFor(props.metrics))

const rootStyle = computed(() => {
  const m = metrics.value
  return {
    '--size-map-halo': `${m.haloWidth}px`,
    '--size-map-halo-opacity': String(m.haloOpacity),
    '--size-map-shore': `${m.shoreWidth}px`,
    '--size-map-boundary': `${m.boundaryWidth}px`,
    '--size-map-boundary-focus': `${m.boundaryFocusWidth}px`,
    '--size-map-hatch-width': `${m.hatchWidth}px`,
    '--size-map-label': `${m.labelSize}px`,
    '--weight-map-label': String(m.labelWeight),
    '--spacing-map-label': `${m.labelSpacing}em`,
    '--size-map-label-halo': `${m.labelHaloWidth}px`,
    '--size-map-bm-label': `${m.bmLabelSize}px`,
  }
})

/** The baked layers by id, each one path. */
const baked = computed(() => {
  const out: Partial<Record<CutoutLayer['id'], string>> = {}
  for (const layer of props.basemap?.layers ?? []) {
    out[layer.id] = out[layer.id] ? out[layer.id] + layer.d : layer.d
  }
  return out
})

const fitBounds = computed<Bounds>(() =>
  resolveBounds(props.shapes ? toRaw(props.shapes) : null, props.points, props.bounds),
)

// A baked basemap fixes the frame: its bbox and viewBox, anchored at the north-west corner,
// so shapes and points project into the same pixels as the baked layers.
const view = computed(() =>
  props.basemap
    ? createFrameView({
        bbox: props.basemap.bbox,
        width: props.basemap.viewBox[0],
        height: props.basemap.viewBox[1],
      })
    : createMapView({
        bounds: fitBounds.value,
        width: props.width,
        height: props.height,
        padding: props.padding,
      }),
)

const drawn = computed<DrawnShape[]>(() =>
  drawShapes(props.shapes, props.idKey, props.nameKey, view.value),
)

const allD = computed(() => drawn.value.map(s => s.d).join(''))

function fillFor(shape: DrawnShape): string {
  const fills = props.fills
  const value = typeof fills === 'function' ? fills(shape.feature) : fills?.[shape.id]
  // Over a baked basemap an unfilled shape stays transparent so the land shows through.
  return value || (props.basemap ? 'transparent' : 'var(--color-map-land)')
}

const fillById = computed(() => {
  const map = new Map<string, string>()
  for (const s of drawn.value) map.set(s.id, fillFor(s))
  return map
})

const noData = computed(() => drawn.value.filter(s => props.hatch?.[s.id]))

function levelOf(id: string): string {
  return props.levelText?.[id] ?? ''
}

function shapeLabel(shape: DrawnShape): string {
  const text = levelOf(shape.id)
  return text ? `${shape.name}: ${text}` : shape.name
}

const pointViews = computed<DrawnPoint[]>(() =>
  drawPoints(props.points, props.highlight, view.value, metrics.value),
)

const placed = computed(() =>
  layoutLabels({
    drawn: drawn.value,
    points: pointViews.value,
    labels: props.labels,
    plain: props.plain,
    levelText: props.levelText,
    view: view.value,
    metrics: metrics.value,
    ...(props.basemap ? { basemapLabels: props.basemap.labels } : {}),
  }),
)

const lineHeight = computed(() => metrics.value.labelSize * 1.25)

// ---- colour roles -> CSS (the SVG reads custom properties; GL resolves its own hex)
function cssColor(role: MarkColor, color: string): string {
  switch (role) {
    case 'color':
      return color
    case 'outline':
      return `color-mix(in srgb, ${color} 55%, var(--color-map-ink))`
    case 'ring':
      return 'var(--color-map-mark-ring)'
    case 'core':
      return 'var(--color-map-mark-core)'
    case 'hatch':
      return 'var(--color-map-hatch)'
  }
}

// ---- hover / focus (client state; empty on the server)
interface Hover {
  kind: 'shape' | 'point'
  id: string
  x: number
  y: number
}
const hover = ref<Hover | null>(null)
const focused = ref<string | null>(null)

function toView(event: PointerEvent | MouseEvent): ViewPoint | null {
  const target = event.currentTarget as SVGElement | null
  const svg = target?.ownerSVGElement
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0) return null
  return [
    ((event.clientX - rect.left) / rect.width) * view.value.width,
    ((event.clientY - rect.top) / rect.height) * view.value.height,
  ]
}

function enterShape(shape: DrawnShape, event: PointerEvent) {
  if (props.plain) return
  const at = toView(event) ?? shape.anchor
  if (at) hover.value = { kind: 'shape', id: shape.id, x: at[0], y: at[1] }
}

function focusShape(shape: DrawnShape) {
  focused.value = shape.id
  if (props.plain || !shape.anchor) return
  hover.value = { kind: 'shape', id: shape.id, x: shape.anchor[0], y: shape.anchor[1] }
}

function leaveShape() {
  hover.value = null
}

function blurShape() {
  focused.value = null
  hover.value = null
}

function enterPoint(p: DrawnPoint) {
  if (props.plain) return
  hover.value = { kind: 'point', id: p.point.id, x: p.x, y: p.y - p.reach }
  emit('point-hover', p.point.id)
}

function leavePoint() {
  hover.value = null
  emit('point-hover', null)
}

function choose(id: string) {
  if (props.interactive && !props.plain) emit('select', id)
}

const tip = computed(() => {
  const h = hover.value
  if (!h) return null
  if (h.kind === 'shape') {
    const shape = drawn.value.find(s => s.id === h.id)
    if (!shape) return null
    return {
      h,
      id: shape.id,
      name: shape.name,
      text: levelOf(shape.id),
      point: null,
      feature: shape.feature,
    }
  }
  const p = props.points.find(q => q.id === h.id)
  if (!p) return null
  return { h, id: p.id, name: p.label, text: '', point: p, feature: null }
})

const tipStyle = computed(() => {
  const h = tip.value?.h
  if (!h) return {}
  return {
    left: `${(h.x / view.value.width) * 100}%`,
    top: `${(h.y / view.value.height) * 100}%`,
  }
})

const tipClass = computed(() => {
  const h = tip.value?.h
  if (!h) return []
  const fx = h.x / view.value.width
  const fy = h.y / view.value.height
  return [
    fx < 0.25 ? 'narduk-geomap__tooltip--start' : fx > 0.75 ? 'narduk-geomap__tooltip--end' : '',
    fy < 0.3 ? 'narduk-geomap__tooltip--below' : '',
  ]
})

const focusId = computed(() => {
  if (props.plain) return props.selected
  return hover.value?.kind === 'shape' ? hover.value.id : (focused.value ?? props.selected)
})
const focusD = computed(() => drawn.value.find(s => s.id === focusId.value)?.d ?? '')
const selectedD = computed(() => drawn.value.find(s => s.id === props.selected)?.d ?? '')

const summary = computed(() => drawn.value.map(shapeLabel).join('; '))
const svgLabel = computed(() =>
  props.plain && summary.value ? `${props.ariaLabel}. ${summary.value}` : props.ariaLabel,
)

const tableRows = computed(() =>
  drawn.value.map(s => ({ id: s.id, name: s.name, text: levelOf(s.id) })),
)
</script>

<template>
  <div
    class="narduk-geomap"
    :class="{ 'narduk-map--dark': scheme === 'dark', 'is-plain': plain }"
    :style="rootStyle"
  >
    <!-- eslint-disable-next-line vue/no-restricted-html-elements -- a data graphic drawn from data, not an icon -->
    <svg
      class="narduk-geomap__svg"
      :viewBox="`0 0 ${view.width} ${view.height}`"
      :role="plain ? 'img' : 'group'"
      :aria-label="svgLabel"
      focusable="false"
    >
      <defs>
        <pattern
          :id="hatchId"
          patternUnits="userSpaceOnUse"
          :width="metrics.hatchSize"
          :height="metrics.hatchSize"
          :patternTransform="`rotate(${metrics.hatchAngle})`"
        >
          <line class="narduk-geomap__hatch-line" x1="0" y1="0" x2="0" :y2="metrics.hatchSize" />
        </pattern>
        <clipPath v-if="baked.water" :id="clipId">
          <path :d="baked.water" />
        </clipPath>
        <mask
          v-if="water && !basemap"
          :id="maskId"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          :width="view.width"
          :height="view.height"
        >
          <rect x="0" y="0" :width="view.width" :height="view.height" fill="#fff" />
          <path :d="allD" fill="#000" />
        </mask>
      </defs>

      <g v-if="basemap" class="narduk-geomap__basemap" aria-hidden="true">
        <rect
          class="narduk-geomap__bm narduk-geomap__bm--land"
          x="0"
          y="0"
          :width="view.width"
          :height="view.height"
        />
        <path
          v-if="baked.green"
          class="narduk-geomap__bm narduk-geomap__bm--green"
          :d="baked.green"
        />
      </g>

      <template v-else-if="water">
        <rect class="narduk-geomap__sea" x="0" y="0" :width="view.width" :height="view.height" />
        <path class="narduk-geomap__halo" :d="allD" :mask="`url(#${maskId})`" />
        <path class="narduk-geomap__shore" :d="allD" :mask="`url(#${maskId})`" />
      </template>

      <g class="narduk-geomap__shapes">
        <path
          v-for="shape in drawn"
          :key="shape.id"
          class="narduk-geomap__shape"
          :class="{ 'narduk-geomap__shape--interactive': interactive && !plain }"
          :data-shape-id="shape.id"
          :d="shape.d"
          :style="{ fill: fillById.get(shape.id) }"
          :role="interactive && !plain ? 'button' : undefined"
          :tabindex="interactive && !plain ? 0 : undefined"
          :aria-pressed="interactive && !plain ? selected === shape.id : undefined"
          :aria-label="interactive && !plain ? shapeLabel(shape) : undefined"
          @pointerenter="enterShape(shape, $event)"
          @pointermove="enterShape(shape, $event)"
          @pointerleave="leaveShape"
          @focus="focusShape(shape)"
          @blur="blurShape"
          @click="choose(shape.id)"
          @keydown.enter.prevent="choose(shape.id)"
          @keydown.space.prevent="choose(shape.id)"
        />
      </g>

      <g v-if="basemap" class="narduk-geomap__basemap" aria-hidden="true">
        <path
          v-if="baked.water"
          class="narduk-geomap__bm narduk-geomap__bm--water"
          :d="baked.water"
        />
        <template v-if="baked.shore">
          <path
            class="narduk-geomap__bm narduk-geomap__bm--shore-halo"
            :d="baked.shore"
            :clip-path="baked.water ? `url(#${clipId})` : undefined"
          />
          <path class="narduk-geomap__bm narduk-geomap__bm--shore" :d="baked.shore" />
        </template>
        <path
          v-if="baked.roadMinor"
          class="narduk-geomap__bm narduk-geomap__bm--roadMinor"
          :d="baked.roadMinor"
        />
        <path
          v-if="baked.roadMajor"
          class="narduk-geomap__bm narduk-geomap__bm--roadMajor"
          :d="baked.roadMajor"
        />
        <path
          v-if="baked.state"
          class="narduk-geomap__bm narduk-geomap__bm--state"
          :d="baked.state"
        />
      </g>

      <path
        v-for="shape in noData"
        :key="`nd-${shape.id}`"
        class="narduk-geomap__nodata"
        :d="shape.d"
        :fill="`url(#${hatchId})`"
      />

      <path class="narduk-geomap__boundary" :d="allD" />
      <path v-if="focusD" class="narduk-geomap__focus" :d="focusD" />
      <path v-if="selectedD && selectedD !== focusD" class="narduk-geomap__focus" :d="selectedD" />

      <g class="narduk-geomap__labels" aria-hidden="true">
        <template v-for="label in placed" :key="label.id">
          <text
            class="narduk-geomap__label"
            :class="label.kind ? `narduk-geomap__label--${label.kind}` : undefined"
            :data-label-id="label.id"
            :x="label.x"
            :y="label.y"
            text-anchor="middle"
          >
            {{ label.text }}
          </text>
          <text
            v-for="(line, i) in label.sub ?? []"
            :key="`${label.id}-sub-${i}`"
            class="narduk-geomap__label narduk-geomap__label--sub"
            :x="label.x"
            :y="label.y + lineHeight * (i + 1)"
            text-anchor="middle"
          >
            {{ line }}
          </text>
        </template>
      </g>

      <g class="narduk-geomap__points">
        <component
          :is="point.point.href && !plain ? 'a' : 'g'"
          v-for="point in pointViews"
          :key="point.point.id"
          class="narduk-geomap__point"
          :data-point-id="point.point.id"
          :href="point.point.href && !plain ? point.point.href : undefined"
          :role="point.point.href && !plain ? undefined : 'img'"
          :tabindex="plain ? undefined : point.point.href ? undefined : 0"
          :aria-label="point.point.label"
          @pointerenter="enterPoint(point)"
          @pointerleave="leavePoint"
          @focus="enterPoint(point)"
          @blur="leavePoint"
        >
          <circle
            class="narduk-geomap__hit"
            :cx="point.x"
            :cy="point.y"
            :r="metrics.markHitRadius"
            fill="transparent"
          />
          <circle
            v-for="(disc, i) in point.discs"
            :key="i"
            class="narduk-geomap__disc"
            :cx="point.x"
            :cy="point.y"
            :r="disc.r"
            :fill="cssColor(disc.fill, point.point.color)"
            :stroke="disc.ring ? cssColor(disc.ring.color, point.point.color) : undefined"
            :stroke-width="disc.ring ? disc.ring.width * 2 : undefined"
            :stroke-dasharray="disc.ring?.dash ? disc.ring.dash.join(' ') : undefined"
          />
          <circle
            class="narduk-geomap__focus-halo"
            :cx="point.x"
            :cy="point.y"
            :r="point.reach + 2"
          />
        </component>
      </g>
      <text
        v-if="basemap"
        class="narduk-geomap__attribution"
        :x="view.width - 8"
        :y="view.height - 8"
        text-anchor="end"
      >
        {{ basemap.attribution }}
      </text>
    </svg>

    <div
      v-if="tip"
      class="narduk-geomap__tooltip"
      :class="tipClass"
      :style="tipStyle"
      role="presentation"
    >
      <slot
        name="tooltip"
        :kind="tip.h.kind"
        :id="tip.id"
        :title="tip.name"
        :text="tip.text"
        :point="tip.point"
        :feature="tip.feature"
      >
        <div class="narduk-geomap__tooltip-title">{{ tip.name }}</div>
        <div v-if="tip.text" class="narduk-geomap__tooltip-body">{{ tip.text }}</div>
      </slot>
    </div>

    <MapTable v-if="table" :caption="ariaLabel" :rows="tableRows" :points="points" />
  </div>
</template>
