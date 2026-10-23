<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'

import { toLiteralColor } from '../gl-colour'
import { markImage, MARK_PIXEL_RATIO, renderMark } from '../gl-marks'
import {
  POINTS_LAYER,
  POINTS_SOURCE,
  pointsLayer,
  buildLabelData,
  buildPointData,
  buildShapeData,
  hatchPixels,
} from '../gl-data'
import { drawPoints, drawShapes, layoutLabels } from '../layout'
import { createMapView, resolveBounds } from '../projection'
import { createBasemapStyle, type BasemapStyle } from '../basemap-style'
import { metricsFor, parseHex, tokensFor } from '../tokens'
import MapTable from './MapTable.vue'
import NardukGeoMap from './NardukGeoMap.vue'

import type { DrawnShape } from '../layout'
import type { GlMapProps, MapPoint, ShapeFeature } from '../types'
import type * as MapLibre from 'maplibre-gl'
import type { GeoJSONSource, Map as GlMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl'

/**
 * Live map. The SVG poster paints first (on the server too); the GL library is imported
 * dynamically when `load` says so, mounted over the poster with the same bounds and padding,
 * and faded in when it reports idle. If the import or WebGL fails the poster stays.
 */
const props = withDefaults(defineProps<GlMapProps>(), {
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
  scheme: 'light',
  overlays: () => [],
  visibleLayers: undefined,
  load: 'visible',
  tokens: undefined,
  metrics: undefined,
})

const emit = defineEmits<{
  select: [id: string]
  'point-hover': [id: string | null]
  error: [error: unknown]
  ready: []
}>()

defineSlots<{
  popup?: (scope: { point: MapPoint }) => unknown
  tooltip?: (scope: Record<string, unknown>) => unknown
}>()

const L_FILL = 'narduk-shapes-fill'
const L_HATCH = 'narduk-shapes-hatch'
const L_LINE = 'narduk-shapes-line'
const L_FOCUS = 'narduk-shapes-focus'
const L_LABEL = 'narduk-labels'
const HATCH_IMAGE = 'narduk-hatch'
const FONT_BOLD = 'Noto Sans Bold'

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLElement | null>(null)
const map = shallowRef<GlMap | null>(null)
const ready = ref(false)
const failed = ref(false)
const popup = ref<{ id: string; x: number; y: number } | null>(null)
const zoomLimits = ref({ canIn: true, canOut: true })

const metrics = computed(() => metricsFor(props.metrics))
const tokens = computed(() => tokensFor(props.scheme ?? 'light', props.tokens))
const view = computed(() =>
  createMapView({
    bounds: resolveBounds(props.shapes, props.points, props.bounds),
    width: props.width,
    height: props.height,
    padding: props.padding,
  }),
)
const drawn = computed(() => drawShapes(props.shapes, props.idKey, props.nameKey, view.value))
const pointViews = computed(() =>
  drawPoints(props.points, props.highlight, view.value, metrics.value),
)
const placed = computed(() =>
  layoutLabels({
    drawn: drawn.value,
    points: pointViews.value,
    labels: props.labels,
    plain: false,
    levelText: undefined,
    view: view.value,
    metrics: metrics.value,
  }),
)

const posterProps = computed(() => ({
  shapes: props.shapes,
  idKey: props.idKey,
  nameKey: props.nameKey,
  fills: props.fills,
  hatch: props.hatch,
  water: props.water,
  points: props.points,
  highlight: props.highlight,
  selected: props.selected,
  interactive: props.interactive,
  plain: props.plain,
  levelText: props.levelText,
  labels: props.labels,
  width: props.width,
  height: props.height,
  padding: props.padding,
  bounds: props.bounds,
  ariaLabel: props.ariaLabel,
  scheme: props.scheme,
  metrics: props.metrics,
}))

const visibleOverlays = computed(() =>
  props.overlays.filter(o =>
    props.visibleLayers ? props.visibleLayers.includes(o.id) : o.visible !== false,
  ),
)
const overlayAttributions = computed(() =>
  visibleOverlays.value.map(o => o.attribution).filter((a): a is string => Boolean(a)),
)

const popupPoint = computed(() => props.points.find(p => p.id === popup.value?.id) ?? null)
const tableRows = computed(() =>
  drawn.value.map(s => ({ id: s.id, name: s.name, text: props.levelText?.[s.id] ?? '' })),
)

// ---- colour handling: GL paint needs literal colours, never var() or color-mix()
function resolveColor(value: string | undefined | null): string {
  if (!value) return tokens.value.land
  let v = value.trim()
  if (v.startsWith('var(') && v.endsWith(')') && root.value) {
    // var(--name) or var(--name, fallback)
    const inner = v.slice(4, -1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()
    v = getComputedStyle(root.value).getPropertyValue(name).trim() || fallback || tokens.value.land
  }
  return toLiteralColor(v)
}

function fillFor(shape: DrawnShape): string {
  const fills = props.fills
  const value =
    typeof fills === 'function' ? fills(shape.feature as ShapeFeature) : fills?.[shape.id]
  return resolveColor(value)
}

// ---- sources
function shapeData() {
  return buildShapeData(drawn.value, fillFor, props.hatch)
}
function pointData() {
  ensureMarkImages()
  return buildPointData(pointViews.value, view.value, tokens.value, metrics.value)
}
function labelData() {
  return buildLabelData(placed.value, view.value)
}

let scale = 1
let lib: typeof MapLibre | null = null
let style: BasemapStyle | null = null
let started = false
let destroyed = false
let observer: ResizeObserver | null = null
let teardown: Array<() => void> = []
let overlayIds = new Set<string>()

function hiddenNames(): string[] {
  if (props.labels === 'none') return []
  return props.labels === 'shapes' ? drawn.value.map(s => s.name) : props.labels.map(l => l.text)
}

function buildStyle(): BasemapStyle {
  return createBasemapStyle(props.tokens ?? {}, {
    scheme: props.scheme ?? 'light',
    labels: 'places',
    metrics: props.metrics,
    hideNames: hiddenNames(),
  })
}

function setData(id: string, data: unknown) {
  const source = map.value?.getSource(id) as GeoJSONSource | undefined
  void source?.setData(data as Parameters<GeoJSONSource['setData']>[0])
}

function install() {
  const gl = map.value
  if (!gl || !style) return
  const t = tokens.value
  const m = metrics.value
  const slots = style.metadata['narduk:slots']
  const before = slots.lines ?? undefined
  const fillsBefore = slots.fills

  gl.addSource('narduk-shapes', { type: 'geojson', data: shapeData() as never })
  gl.addLayer(
    {
      id: L_FILL,
      type: 'fill',
      source: 'narduk-shapes',
      paint: { 'fill-color': ['get', '__fill'] },
    },
    fillsBefore,
  )
  const hatchRgb = parseHex(t.hatch) ?? [0, 0, 0]
  if (!gl.hasImage(HATCH_IMAGE)) {
    gl.addImage(HATCH_IMAGE, hatchPixels(m.hatchSize, hatchRgb, m.hatchWidth), { pixelRatio: 2 })
  }
  gl.addLayer(
    {
      id: L_HATCH,
      type: 'fill',
      source: 'narduk-shapes',
      filter: ['==', ['get', '__hatch'], 1],
      paint: { 'fill-pattern': HATCH_IMAGE },
    },
    fillsBefore,
  )

  syncOverlays(before)

  gl.addLayer(
    {
      id: L_LINE,
      type: 'line',
      source: 'narduk-shapes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': t.boundary,
        'line-opacity': t.boundaryOpacity,
        'line-width': m.boundaryWidth,
      },
    },
    before,
  )
  gl.addLayer(
    {
      id: L_FOCUS,
      type: 'line',
      source: 'narduk-shapes',
      filter: ['==', ['get', '__id'], props.selected ?? '\u0000'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': t.boundaryFocus, 'line-width': m.boundaryFocusWidth },
    },
    before,
  )

  if (props.labels !== 'none') {
    gl.addSource('narduk-labels', { type: 'geojson', data: labelData() as never })
    gl.addLayer({
      id: L_LABEL,
      type: 'symbol',
      source: 'narduk-labels',
      layout: {
        'text-field': ['get', 'text'],
        'text-font': [FONT_BOLD],
        'text-size': m.labelSize,
        'text-transform': 'uppercase',
        'text-letter-spacing': m.labelSpacing,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': t.ink,
        'text-halo-color': t.labelHalo,
        'text-halo-width': m.labelHaloWidth,
      },
    })
  }

  gl.addSource(POINTS_SOURCE, { type: 'geojson', data: pointData() as never })
  gl.addLayer(pointsLayer(scale) as never)
}

/** Register the mark pictures the current points need; each is drawn once per colour. */
function ensureMarkImages() {
  const gl = map.value
  if (!gl) return
  for (const p of pointViews.value) {
    const image = markImage(
      p.point.shape,
      p.point.color,
      p.highlighted,
      tokens.value,
      metrics.value,
    )
    if (gl.hasImage(image.id)) continue
    const pixels = renderMark(image)
    if (pixels) gl.addImage(image.id, pixels, { pixelRatio: MARK_PIXEL_RATIO })
  }
}

function syncOverlays(beforeId?: string) {
  const gl = map.value
  if (!gl) return
  const want = new Map(props.overlays.map(o => [o.id, o]))
  for (const id of overlayIds) {
    if (!want.has(id)) {
      if (gl.getLayer(`ov-${id}`)) gl.removeLayer(`ov-${id}`)
      if (gl.getSource(`ov-${id}`)) gl.removeSource(`ov-${id}`)
      overlayIds.delete(id)
    }
  }
  const before = beforeId ?? style?.metadata['narduk:slots'].lines ?? undefined
  for (const o of props.overlays) {
    const visibility = visibleOverlays.value.includes(o) ? 'visible' : 'none'
    if (!gl.getSource(`ov-${o.id}`)) {
      gl.addSource(`ov-${o.id}`, {
        type: 'raster',
        tiles: o.tiles,
        tileSize: o.tileSize ?? 256,
        ...(o.minzoom === undefined ? {} : { minzoom: o.minzoom }),
        ...(o.maxzoom === undefined ? {} : { maxzoom: o.maxzoom }),
      })
      gl.addLayer(
        {
          id: `ov-${o.id}`,
          type: 'raster',
          source: `ov-${o.id}`,
          layout: { visibility },
          paint: { 'raster-opacity': o.opacity ?? 1 },
        },
        before && gl.getLayer(before) ? before : undefined,
      )
      overlayIds.add(o.id)
    } else {
      gl.setLayoutProperty(`ov-${o.id}`, 'visibility', visibility)
      gl.setPaintProperty(`ov-${o.id}`, 'raster-opacity', o.opacity ?? 1)
    }
  }
}

function framing() {
  const el = root.value
  const cw = el?.clientWidth || props.width
  scale = cw / view.value.width
  const v = view.value
  return {
    padding: props.padding * scale,
    // The poster's fit zoom, moved to the container's pixel width.
    zoom: v.zoom + Math.log2(scale),
  }
}

function updateZoomState() {
  const gl = map.value
  if (!gl) return
  zoomLimits.value = {
    canIn: gl.getZoom() < gl.getMaxZoom() - 0.01,
    canOut: gl.getZoom() > gl.getMinZoom() + 0.01,
  }
}

function updatePopup() {
  const gl = map.value
  const point = popupPoint.value
  if (!gl || !point) return
  const p = gl.project([point.lon, point.lat])
  popup.value = { id: point.id, x: p.x, y: p.y }
}

function onClick(e: MapMouseEvent) {
  const gl = map.value
  if (!gl) return
  const reach = 8
  const hit = gl.queryRenderedFeatures(
    [
      [e.point.x - reach, e.point.y - reach],
      [e.point.x + reach, e.point.y + reach],
    ],
    { layers: [POINTS_LAYER] },
  )[0]
  if (hit) {
    const id = String(hit.properties?.__id)
    const point = props.points.find(p => p.id === id)
    if (point) {
      const p = gl.project([point.lon, point.lat])
      popup.value = { id, x: p.x, y: p.y }
      return
    }
  }
  popup.value = null
  const shape = gl.queryRenderedFeatures(e.point, { layers: [L_FILL] })[0]
  if (shape && props.interactive) emit('select', String(shape.properties?.__id))
}

let hoverId: string | null = null
function onMove(e: MapMouseEvent) {
  const gl = map.value
  if (!gl) return
  const reach = 6
  const hit = gl.queryRenderedFeatures(
    [
      [e.point.x - reach, e.point.y - reach],
      [e.point.x + reach, e.point.y + reach],
    ],
    { layers: [POINTS_LAYER] },
  )[0]
  const id = hit ? String(hit.properties?.__id) : null
  canvas.value?.classList.toggle('is-pointer', Boolean(id) || (props.interactive && isOverShape(e)))
  if (id !== hoverId) {
    hoverId = id
    emit('point-hover', id)
  }
}

function isOverShape(e: MapMouseEvent): boolean {
  return (map.value?.queryRenderedFeatures(e.point, { layers: [L_FILL] }).length ?? 0) > 0
}

async function start() {
  // `plain` is the print view: it stays the SVG poster, with its subtitles and no tab stops.
  if (started || destroyed || props.plain) return
  started = true
  try {
    const mod = await import('maplibre-gl')
    lib = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
    const container = canvas.value
    if (!container || destroyed) return
    const { padding, zoom } = framing()
    style = buildStyle()
    const gl = new lib.Map({
      container,
      style: style as unknown as StyleSpecification,
      bounds: view.value.bounds,
      fitBoundsOptions: { padding, animate: false },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      cooperativeGestures: true,
      renderWorldCopies: false,
      fadeDuration: 120,
      minZoom: Math.max(0, zoom - 1.5),
      maxZoom: 17,
    })
    gl.touchZoomRotate.disableRotation()
    map.value = gl
    gl.on('load', () => {
      install()
      updateZoomState()
      void gl.once('idle', () => {
        if (!failed.value) ready.value = true
      })
      // Offline or blocked tiles still leave a usable shapes-only map.
      const fallback = setTimeout(() => {
        if (!failed.value) ready.value = true
      }, 6000)
      teardown.push(() => clearTimeout(fallback))
    })
    gl.on('click', onClick)
    gl.on('mousemove', onMove)
    gl.on('move', () => {
      if (popup.value) updatePopup()
    })
    gl.on('zoom', updateZoomState)
    gl.on('error', e => {
      const err = e.error
      if (err?.message?.includes('WebGL')) {
        failed.value = true
        ready.value = false
        emit('error', err instanceof Error ? err : new Error(err.message))
      }
    })
  } catch (error) {
    failed.value = true
    emit('error', error)
  }
}

function schedule() {
  const el = root.value
  if (!el) return
  const mode = props.load
  if (mode === 'eager') {
    void start()
  } else if (mode === 'idle') {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => void start())
    else setTimeout(() => void start(), 200)
  } else if (mode === 'interaction') {
    const go = () => void start()
    const events = ['pointerenter', 'focusin', 'touchstart', 'click'] as const
    for (const name of events) el.addEventListener(name, go, { once: true, passive: true })
    teardown.push(() => {
      for (const name of events) el.removeEventListener(name, go)
    })
  } else if (typeof IntersectionObserver === 'undefined') {
    void start()
  } else {
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(en => en.isIntersecting)) {
          io.disconnect()
          void start()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    teardown.push(() => io.disconnect())
  }
}

onMounted(() => {
  schedule()
  if (root.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      if (!map.value) return
      framing()
      map.value.setLayoutProperty(POINTS_LAYER, 'icon-size', scale)
      setData(POINTS_SOURCE, pointData())
      map.value.resize()
    })
    observer.observe(root.value)
  }
})

onBeforeUnmount(() => {
  destroyed = true
  observer?.disconnect()
  for (const fn of teardown) fn()
  teardown = []
  map.value?.remove()
  map.value = null
})

watch(ready, value => {
  if (value) emit('ready')
})
watch([drawn, () => props.fills, () => props.hatch, tokens], () => {
  setData('narduk-shapes', shapeData())
})
watch([pointViews, tokens], () => setData(POINTS_SOURCE, pointData()))
watch(placed, () => setData('narduk-labels', labelData()))
watch(
  () => props.selected,
  id => {
    if (map.value?.getLayer(L_FOCUS)) {
      map.value.setFilter(L_FOCUS, ['==', ['get', '__id'], id ?? '\u0000'])
    }
  },
)
/* vue-official allow-deep-watch -- overlays are edited in place by callers (opacity, visibility) */
watch([() => props.overlays, () => props.visibleLayers], () => syncOverlays(), { deep: true })
watch(view, () => {
  const gl = map.value
  if (!gl) return
  const { padding } = framing()
  gl.fitBounds(view.value.bounds, { padding, duration: 0 })
})
watch([() => props.scheme, () => props.tokens, () => props.metrics], () => {
  const gl = map.value
  if (!gl) return
  style = buildStyle()
  gl.setStyle(style as unknown as StyleSpecification, { diff: false })
  void gl.once('style.load', () => install())
})

function zoomBy(delta: number) {
  const gl = map.value
  if (!gl) return
  if (delta > 0) gl.zoomIn({ duration: 200 })
  else gl.zoomOut({ duration: 200 })
}

defineExpose({
  /** The live map, or null until the GL library has loaded. An escape hatch. */
  map,
} as unknown as ComponentPublicInstance)
</script>

<template>
  <div
    ref="root"
    class="narduk-map"
    :class="{
      'is-ready': ready,
      'is-failed': failed,
      'narduk-map--interactive': interactive,
      'narduk-map--dark': scheme === 'dark',
    }"
    @keydown.esc="popup = null"
  >
    <NardukGeoMap
      class="narduk-map__poster"
      v-bind="posterProps"
      @select="emit('select', $event)"
      @point-hover="emit('point-hover', $event)"
    >
      <template v-if="$slots.tooltip" #tooltip="scope">
        <slot name="tooltip" v-bind="scope" />
      </template>
    </NardukGeoMap>

    <div
      ref="canvas"
      class="narduk-map__canvas"
      role="group"
      :aria-label="ariaLabel"
      :aria-hidden="ready ? undefined : true"
    />

    <div v-if="ready" class="narduk-map__controls">
      <button
        type="button"
        class="narduk-map__control"
        aria-label="Zoom in"
        :disabled="!zoomLimits.canIn"
        @click="zoomBy(1)"
      >
        +
      </button>
      <button
        type="button"
        class="narduk-map__control"
        aria-label="Zoom out"
        :disabled="!zoomLimits.canOut"
        @click="zoomBy(-1)"
      >
        &minus;
      </button>
    </div>

    <div
      v-if="popup && popupPoint"
      class="narduk-map__popup"
      :style="{ left: `${popup.x}px`, top: `${popup.y}px` }"
    >
      <div class="narduk-geomap__tooltip" role="dialog" :aria-label="popupPoint.label">
        <slot name="popup" :point="popupPoint">
          <div class="narduk-geomap__tooltip-title">{{ popupPoint.label }}</div>
        </slot>
        <button
          type="button"
          class="narduk-map__popup-close"
          aria-label="Close"
          @click="popup = null"
        >
          &times;
        </button>
      </div>
    </div>

    <p class="narduk-map__attribution">
      <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
      <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener"
        >&copy; OpenStreetMap</a
      >
      <span v-for="text in overlayAttributions" :key="text"> &middot; {{ text }}</span>
    </p>

    <MapTable v-if="table && ready" :caption="ariaLabel" :rows="tableRows" :points="points" />
  </div>
</template>
