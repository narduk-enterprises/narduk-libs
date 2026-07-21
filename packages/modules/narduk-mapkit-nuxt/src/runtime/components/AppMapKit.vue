<script lang="ts">
/* eslint-disable narduk/file-size-budget -- Apple MapKit integration is a single orchestration primitive (SDK loader + map + pins + GeoJSON overlays + selection + dark mode + lifecycle); the global imperative SDK forces state + effects + template to stay co-located to avoid races. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mapkit is a global injected by Apple's CDN script, no type definitions available
declare const mapkit: any
</script>

<script setup lang="ts" generic="T extends { id: string; lat: number; lng: number }">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useMapKit } from '../composables/useMapKit'

/**
 * AppMapKit — Reusable Apple MapKit JS map component.
 *
 * Supports two rendering modes (can be combined):
 *   1. Pin annotations — pass `items` + `createPinElement`
 *   2. GeoJSON polygon/line overlays — pass `geojson` + optional `overlayStyleFn`
 *
 * Handles MapKit loading, map initialization, bounding region calculation,
 * pin annotations with selection, GeoJSON overlays, zoom behavior, dark mode
 * sync, and cleanup.
 */

export interface GeoJSONGeometry {
  coordinates: unknown
  type: string
}

export interface GeoJSONFeatureProperties {
  [key: string]: unknown
}

export interface GeoJSONFeature {
  geometry: GeoJSONGeometry
  properties: GeoJSONFeatureProperties
  type: 'Feature'
}

export interface GeoJSONFeatureCollection {
  features: GeoJSONFeature[]
  type: 'FeatureCollection'
}

export interface OverlayStyle {
  fillRule?: 'evenodd' | 'nonzero'
  fillColor: string
  fillOpacity?: number
  lineDash?: number[]
  lineWidth: number
  strokeColor: string
  strokeOpacity?: number
}

const props = withDefaults(
  defineProps<{
    annotationSize?: { height: number; width: number }
    boundingPadding?: number
    /** Text label to display at the center of the GeoJSON features. */
    centerLabel?: string
    /** Lightweight circle overlays for rendering large point clouds. */
    circles?: Array<{ color: string; lat: number; lng: number; opacity?: number; radius: number }>
    /** Scale factor for dynamic radius (fraction of visible latitude span). */
    circleScaleFactor?: number
    /** When set, nearby annotations merge into cluster bubbles at low zoom. */
    clusteringIdentifier?: string
    /** Custom factory for cluster annotation elements. Receives the cluster and its member count. */
    createClusterElement?: (
      cluster: { coordinate: unknown; memberAnnotations: unknown[] },
      count: number,
    ) => HTMLElement
    /** Factory to create pin DOM elements. Required when items are provided. */
    createPinElement?: (
      item: T,
      isSelected: boolean,
    ) => { cleanup?: () => void; element: HTMLElement }
    /** When true, circle radii scale dynamically with zoom level. */
    dynamicCircleRadius?: boolean
    fallbackCenter?: { lat: number; lng: number }
    /** GeoJSON FeatureCollection with Polygon/MultiPolygon/LineString features. */
    geojson?: GeoJSONFeatureCollection | null
    /** When false, disables map rotation interaction. */
    isRotationEnabled?: boolean
    /** When false, disables map scroll (pan) interaction — for static/display-only maps. */
    isScrollEnabled?: boolean
    /** When false, disables map zoom interaction — for static/display-only maps. */
    isZoomEnabled?: boolean
    /** Pin annotation items (optional when using geojson-only mode). */
    items?: T[]
    /** Maximum circle radius in meters (only when dynamicCircleRadius is true). */
    maxCircleRadius?: number
    /** Minimum circle radius in meters (only when dynamicCircleRadius is true). */
    minCircleRadius?: number
    /** Minimum span in degrees for the bounding region (ensures small areas still show context). */
    minSpanDelta?: number
    /** Custom style function for each GeoJSON overlay polygon/line feature. */
    overlayStyleFn?: (properties: GeoJSONFeatureProperties) => OverlayStyle
    /** When true, keeps the current map region when items change instead of auto-zooming to fit. */
    preserveRegion?: boolean
    /** When false, hides all point-of-interest labels (road names, city names, etc). */
    showsPointsOfInterest?: boolean
    /** When true, selection changes only refresh pins; parent controls camera updates. */
    suppressSelectionZoom?: boolean
    zoomSpan?: { lat: number; lng: number }
  }>(),
  {
    items: () => [] as unknown as T[],
    createPinElement: undefined,
    geojson: null,
    overlayStyleFn: undefined,
    circles: () => [],
    dynamicCircleRadius: false,
    minCircleRadius: 200,
    maxCircleRadius: 6000,
    circleScaleFactor: 0.004,
    clusteringIdentifier: undefined,
    createClusterElement: undefined,
    annotationSize: () => ({ width: 100, height: 56 }),
    zoomSpan: () => ({ lat: 0.002, lng: 0.0025 }),
    boundingPadding: 0.05,
    minSpanDelta: 0,
    isScrollEnabled: true,
    isZoomEnabled: true,
    isRotationEnabled: false,
    preserveRegion: false,
    suppressSelectionZoom: false,
    showsPointsOfInterest: true,
    centerLabel: undefined,
  },
)

const emit = defineEmits<{
  /** Emitted when a GeoJSON polygon overlay is clicked. */
  'feature-select': [feature: GeoJSONFeature]
  /** Emitted when the map background is clicked (not a pin or overlay). */
  'map-click': [coords: { lat: number; lng: number }]
  /** Emitted once the internal `mapkit.Map` instance is ready for imperative camera control. */
  'map-ready': [map: InstanceType<typeof mapkit.Map>]
  /** Emitted when the visible map region changes (zoom/pan). */
  'region-change': [
    span: { centerLat: number; centerLng: number; latDelta: number; lngDelta: number },
  ]
}>()

const selectedId = defineModel<string | null>('selectedId', { default: null })

const { mapkitReady, mapkitError } = useMapKit()
const mapContainer = ref<HTMLElement | null>(null)

const pinCleanups: Array<() => void> = []
const ownedPinAnnotations: Array<InstanceType<typeof mapkit.Annotation>> = []
const ownedGeoJSONOverlays: object[] = []
let map: InstanceType<typeof mapkit.Map> | null = null
let overviewRegion: InstanceType<typeof mapkit.CoordinateRegion> | null | undefined = null
const overlayFeatureMap = new WeakMap<object, GeoJSONFeature>()

// ── Bounding region ──────────────────────────────────────────

interface LatLngBounds {
  hasPoints: boolean
  maxLat: number
  maxLng: number
  minLat: number
  minLng: number
}

function expandBoundsWithLngLat(bounds: LatLngBounds, lng: number, lat: number): void {
  if (lat < bounds.minLat) bounds.minLat = lat
  if (lat > bounds.maxLat) bounds.maxLat = lat
  if (lng < bounds.minLng) bounds.minLng = lng
  if (lng > bounds.maxLng) bounds.maxLng = lng
  bounds.hasPoints = true
}

function computeBoundingRegion(): InstanceType<typeof mapkit.CoordinateRegion> | undefined {
  const bounds: LatLngBounds = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
    hasPoints: false,
  }

  for (const s of props.items) {
    expandBoundsWithLngLat(bounds, s.lng, s.lat)
  }

  const features = props.geojson?.features
  if (features) {
    for (const feat of features) {
      for (const [lng, lat] of extractAllPoints(feat.geometry)) {
        expandBoundsWithLngLat(bounds, lng, lat)
      }
    }
  }

  for (const c of props.circles) {
    expandBoundsWithLngLat(bounds, c.lng, c.lat)
  }

  if (bounds.hasPoints) {
    const pad = props.boundingPadding
    const minSpan = props.minSpanDelta
    const latDelta = Math.max((bounds.maxLat - bounds.minLat) * (1 + pad), minSpan, 0.005)
    const lngDelta = Math.max((bounds.maxLng - bounds.minLng) * (1 + pad), minSpan, 0.006)
    const center = new mapkit.Coordinate(
      (bounds.minLat + bounds.maxLat) / 2,
      (bounds.minLng + bounds.maxLng) / 2,
    )
    return new mapkit.CoordinateRegion(center, new mapkit.CoordinateSpan(latDelta, lngDelta))
  }

  if (!props.fallbackCenter) return undefined
  const { lat, lng } = props.fallbackCenter
  return new mapkit.CoordinateRegion(
    new mapkit.Coordinate(lat, lng),
    new mapkit.CoordinateSpan(0.08, 0.1),
  )
}

// ── GeoJSON helpers ──────────────────────────────────────────

function pushLngLatPairFromPoint(points: Array<[number, number]>, pt: unknown): void {
  if (Array.isArray(pt) && pt.length >= 2) {
    points.push([pt[0] as number, pt[1] as number])
  }
}

function extractPolygonExteriorPoints(coords: unknown): Array<[number, number]> {
  if (!Array.isArray(coords)) return []
  const outer = coords[0]
  if (!Array.isArray(outer)) return []
  const points: Array<[number, number]> = []
  for (const pt of outer) pushLngLatPairFromPoint(points, pt)
  return points
}

function extractMultiPolygonPoints(coords: unknown): Array<[number, number]> {
  if (!Array.isArray(coords)) return []
  const points: Array<[number, number]> = []
  for (const polygon of coords) {
    if (!Array.isArray(polygon)) continue
    const outer = polygon[0]
    if (!Array.isArray(outer)) continue
    for (const pt of outer) pushLngLatPairFromPoint(points, pt)
  }
  return points
}

function extractLineStringPoints(coords: unknown): Array<[number, number]> {
  if (!Array.isArray(coords)) return []
  const points: Array<[number, number]> = []
  for (const pt of coords) pushLngLatPairFromPoint(points, pt)
  return points
}

function extractAllPoints(geometry: GeoJSONGeometry): Array<[number, number]> {
  const coords = geometry.coordinates
  if (!Array.isArray(coords)) return []

  if (geometry.type === 'Polygon') return extractPolygonExteriorPoints(coords)
  if (geometry.type === 'MultiPolygon') return extractMultiPolygonPoints(coords)
  if (geometry.type === 'LineString') return extractLineStringPoints(coords)

  return []
}

function defaultOverlayStyle(): OverlayStyle {
  return {
    strokeColor: '#065f46', // eslint-disable-line narduk/no-inline-hex -- MapKit Style API requires raw hex values; Tailwind utilities cannot be used in JS objects
    strokeOpacity: 1,
    fillColor: '#10b981', // eslint-disable-line narduk/no-inline-hex -- MapKit Style API requires raw hex values; Tailwind utilities cannot be used in JS objects
    fillOpacity: 0.2,
    lineWidth: 1.5,
  }
}

function defaultLineOverlayStyle(): OverlayStyle {
  return {
    // eslint-disable-next-line narduk/no-inline-hex -- MapKit Style API requires raw hex values; Tailwind utilities cannot be used in JS objects
    strokeColor: '#0284c7',
    strokeOpacity: 0.92,
    // eslint-disable-next-line narduk/no-inline-hex -- MapKit Style API requires raw hex values; Tailwind utilities cannot be used in JS objects
    fillColor: '#000000',
    fillOpacity: 0,
    lineWidth: 3,
  }
}

function buildPolygonRings(
  geometry: GeoJSONGeometry,
): Array<Array<Array<InstanceType<typeof mapkit.Coordinate>>>> {
  const coords = geometry.coordinates
  if (!Array.isArray(coords)) return []

  const polygons: Array<Array<Array<InstanceType<typeof mapkit.Coordinate>>>> = []

  if (geometry.type === 'LineString') {
    return polygons
  }

  if (geometry.type === 'Polygon') {
    const rings = coords
      .filter(Array.isArray)
      .map((sourceRing) => sourceRing
        .filter((pt: unknown) => Array.isArray(pt) && (pt as number[]).length >= 2)
        .map((pt: unknown) => new mapkit.Coordinate((pt as number[])[1], (pt as number[])[0])))
      .filter((ring) => ring.length >= 3)
    if (rings.length) polygons.push(rings)
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of coords) {
      if (!Array.isArray(polygon)) continue
      const rings = polygon
        .filter(Array.isArray)
        .map((sourceRing) => sourceRing
          .filter((pt: unknown) => Array.isArray(pt) && (pt as number[]).length >= 2)
          .map((pt: unknown) => new mapkit.Coordinate((pt as number[])[1], (pt as number[])[0])))
        .filter((ring) => ring.length >= 3)
      if (rings.length) polygons.push(rings)
    }
  }

  return polygons
}

function buildLineStringCoordinates(
  geometry: GeoJSONGeometry,
): Array<InstanceType<typeof mapkit.Coordinate>> {
  if (geometry.type !== 'LineString') return []

  const coords = geometry.coordinates
  if (!Array.isArray(coords)) return []

  return coords
    .filter((pt: unknown) => Array.isArray(pt) && (pt as number[]).length >= 2)
    .map((pt: unknown) => new mapkit.Coordinate((pt as number[])[1], (pt as number[])[0]))
}

// ── Map initialization ───────────────────────────────────────

function buildClusterElement(cluster: {
  coordinate: unknown
  memberAnnotations: unknown[]
}): HTMLElement {
  const count = cluster.memberAnnotations.length

  if (!import.meta.client) {
    // SSR mock
    return {
      className: 'mapkit-cluster',
      innerHTML: '',
      setAttribute: () => {},
      style: {},
      addEventListener: () => {},
    } as unknown as HTMLElement
  }

  let el: HTMLElement
  if (props.createClusterElement) {
    el = props.createClusterElement(cluster, count)
  } else {
    // eslint-disable-next-line narduk/no-ssr-dom-access -- guarded by `import.meta.client` check above; document access is safe here
    el = document.createElement('div')
    el.className = 'mapkit-cluster'
    el.innerHTML = `<div class="mapkit-cluster-bubble"><span class="mapkit-cluster-count">${count}</span></div>`
  }

  el.setAttribute('data-map-pin', '')
  el.style.cursor = 'pointer'
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    // Zoom in to reveal individual pins
    if (map && cluster.coordinate) {
      const span = new mapkit.CoordinateSpan(
        map.region.span.latitudeDelta / 3,
        map.region.span.longitudeDelta / 3,
      )
      map.setRegionAnimated(new mapkit.CoordinateRegion(cluster.coordinate, span), true)
    }
  })
  return el
}

function initMap() {
  if (!mapContainer.value) return

  overviewRegion = computeBoundingRegion()

  let isDark = false
  if (import.meta.client) {
    isDark = document.documentElement.classList.contains('dark')
  }

  const excludeAllPoi = !props.showsPointsOfInterest
    ? mapkit.PointOfInterestFilter?.excludingAllCategories
    : null

  // Keep constructor options narrow. Some constructor-time options route through
  // MapKit rotation handling on clients that do not support rotation.
  const mapOpts: Record<string, unknown> = {
    showsCompass: mapkit.FeatureVisibility.Hidden,
    showsMapTypeControl: false,
    showsZoomControl: props.isZoomEnabled,
    showsScale: mapkit.FeatureVisibility.Adaptive,
    colorScheme: isDark ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light,
    isZoomEnabled: props.isZoomEnabled,
    isScrollEnabled: props.isScrollEnabled,
    mapType: props.showsPointsOfInterest
      ? mapkit.Map.MapTypes.Standard
      : mapkit.Map.MapTypes.MutedStandard,
  }

  if (overviewRegion) mapOpts.region = overviewRegion

  if (excludeAllPoi) {
    mapOpts.pointOfInterestFilter = excludeAllPoi
  } else {
    mapOpts.showsPointsOfInterest = props.showsPointsOfInterest
  }

  // Register cluster annotation factory when clustering is enabled
  if (props.clusteringIdentifier) {
    mapOpts.annotationForCluster = (cluster: {
      coordinate: unknown
      memberAnnotations: unknown[]
    }) => {
      return new mapkit.Annotation(cluster.coordinate, () => buildClusterElement(cluster), {
        anchorOffset: new DOMPoint(0, 0),
        size: { width: 44, height: 44 },
        calloutEnabled: false,
      })
    }
  }

  map = new mapkit.Map(mapContainer.value, mapOpts)
  map.addEventListener('select', handleOverlaySelect)

  if (excludeAllPoi && map.pointOfInterestFilter !== excludeAllPoi) {
    map.pointOfInterestFilter = excludeAllPoi
  }

  // Only enable rotation when the client actually supports it.
  if (props.isRotationEnabled && map.isRotationAvailable) {
    map.isRotationEnabled = true
  }

  // Click on map background (not a pin) clears selection + emits coordinates
  // Use a delay to avoid firing on double-click-to-zoom
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  map.element.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-map-pin]')) return

    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      if (selectedId.value) selectedId.value = null

      // Convert page coordinates to map coordinates
      try {
        const point = new DOMPoint(e.pageX, e.pageY)
        const coord = map.convertPointOnPageToCoordinate(point)
        if (coord) {
          emit('map-click', {
            lat: Math.round(coord.latitude * 1e6) / 1e6,
            lng: Math.round(coord.longitude * 1e6) / 1e6,
          })
        }
      } catch {
        // Silently ignore if conversion fails
      }
    }, 250)
  })

  map.element.addEventListener('dblclick', () => {
    if (clickTimer) clearTimeout(clickTimer)
  })

  addAnnotations()
  addOverlays()
  addCenterLabel()
  addCircles()
  resizeCirclesToRegion() // Apply dynamic radius for the initial zoom level

  // Emit region changes for zoom-responsive behavior + dynamic circle radius
  map.addEventListener('region-change-end', () => {
    const region = map.region
    if (region) {
      emit('region-change', {
        latDelta: region.span.latitudeDelta,
        lngDelta: region.span.longitudeDelta,
        centerLat: region.center.latitude,
        centerLng: region.center.longitude,
      })

      // Dynamically resize circles based on visible span
      resizeCirclesToRegion()
    }
  })

  emit('map-ready', map)
}

// ── Pin annotations ──────────────────────────────────────────

function clearPinCleanups() {
  for (const fn of pinCleanups) fn()
  pinCleanups.length = 0
}

function addAnnotations() {
  if (!map || !props.items.length || !props.createPinElement) return

  const annotations = props.items.map((item) => {
    const coord = new mapkit.Coordinate(item.lat, item.lng)
    const opts: Record<string, unknown> = {
      anchorOffset: new DOMPoint(0, -6),
      calloutEnabled: false,
      size: props.annotationSize,
      data: { id: item.id },
    }
    if (props.clusteringIdentifier) {
      opts.clusteringIdentifier = props.clusteringIdentifier
    }
    return new mapkit.Annotation(
      coord,
      () => {
        const isSelected = selectedId.value === item.id
        const { element, cleanup } = props.createPinElement!(item, isSelected)

        const wrapper = import.meta.client ? document.createElement('div') : ({} as HTMLElement)
        wrapper.setAttribute('data-map-pin', '')
        wrapper.style.cursor = 'pointer'
        wrapper.appendChild(element)
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation()
          selectedId.value = selectedId.value === item.id ? null : item.id
        })

        if (cleanup) pinCleanups.push(cleanup)

        return wrapper
      },
      opts,
    )
  })
  ownedPinAnnotations.push(...annotations)
  map.addAnnotations(annotations)
}

function removeOwnedPinAnnotations() {
  if (!map || ownedPinAnnotations.length === 0) return
  map.removeAnnotations([...ownedPinAnnotations])
  ownedPinAnnotations.length = 0
}

function rebuildAnnotations() {
  if (!map) return
  clearPinCleanups()
  removeOwnedPinAnnotations()
  addAnnotations()
}

// ── Polygon overlays ─────────────────────────────────────────

function addOverlays() {
  if (!map || !props.geojson?.features.length) return

  for (const feature of props.geojson.features) {
    const lineCoordinates = buildLineStringCoordinates(feature.geometry)
    if (lineCoordinates.length >= 2) {
      const styleCfg = props.overlayStyleFn
        ? props.overlayStyleFn(feature.properties)
        : defaultLineOverlayStyle()

      const style = new mapkit.Style({
        strokeColor: styleCfg.strokeColor,
        strokeOpacity: styleCfg.strokeOpacity,
        fillColor: styleCfg.fillColor,
        fillOpacity: styleCfg.fillOpacity ?? 0,
        lineWidth: styleCfg.lineWidth,
        lineDash: styleCfg.lineDash,
      })

      const overlay = new mapkit.PolylineOverlay(lineCoordinates, { style })
      overlay.enabled = true
      overlayFeatureMap.set(overlay, feature)
      ownedGeoJSONOverlays.push(overlay)
      map.addOverlay(overlay)
      continue
    }

    const polygons = buildPolygonRings(feature.geometry)
    if (polygons.length === 0) continue

    const styleCfg = props.overlayStyleFn
      ? props.overlayStyleFn(feature.properties)
      : defaultOverlayStyle()

    const style = new mapkit.Style({
      strokeColor: styleCfg.strokeColor,
      strokeOpacity: styleCfg.strokeOpacity ?? 1,
      fillColor: styleCfg.fillColor,
      fillOpacity: styleCfg.fillOpacity ?? 0.2,
      fillRule: styleCfg.fillRule ?? 'evenodd',
      lineDash: styleCfg.lineDash,
      lineWidth: styleCfg.lineWidth,
    })

    for (const rings of polygons) {
      const coordinates = rings.length === 1 ? rings[0] : rings
      const overlay = new mapkit.PolygonOverlay(coordinates, { style })
      overlay.enabled = true
      overlayFeatureMap.set(overlay, feature)
      ownedGeoJSONOverlays.push(overlay)
      map.addOverlay(overlay)
    }
  }
}

function handleOverlaySelect(event: { overlay?: object }) {
  const overlay = event.overlay
  if (!overlay) return
  const feature = overlayFeatureMap.get(overlay)
  if (feature) emit('feature-select', feature)
}

function clearOverlays() {
  if (!map || ownedGeoJSONOverlays.length === 0) return
  map.removeOverlays([...ownedGeoJSONOverlays])
  ownedGeoJSONOverlays.length = 0
}

// ── Center label annotation ─────────────────────────────────────
let centerLabelAnnotation: InstanceType<typeof mapkit.Annotation> | null = null

function addCenterLabel() {
  if (!map || !props.centerLabel) return

  const region = computeBoundingRegion()
  if (!region) return
  const center = region.center

  let isDark = false
  if (import.meta.client) {
    isDark = document.documentElement.classList.contains('dark')
  }

  const el = import.meta.client ? document.createElement('div') : ({} as HTMLElement)
  el.style.cssText = `
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
    text-shadow: ${
      isDark
        ? '0 1px 4px rgba(0,0,0,0.5), 0 0 12px rgba(0,0,0,0.3)'
        : '0 0 4px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.7), 0 1px 2px rgba(0,0,0,0.1)'
    };
    color: ${isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)'};
  `
  el.textContent = props.centerLabel

  centerLabelAnnotation = new mapkit.Annotation(center, () => el, {
    anchorOffset: new DOMPoint(0, 0),
    calloutEnabled: false,
    animates: false,
  })
  map.addAnnotation(centerLabelAnnotation)
}

// ── Circle overlays (lightweight dots) ──────────────────────────
const circleOverlayRefs: Array<InstanceType<typeof mapkit.CircleOverlay>> = []

function addCircles() {
  if (!map || !props.circles.length) return
  for (const c of props.circles) {
    const center = new mapkit.Coordinate(c.lat, c.lng)
    const style = new mapkit.Style({
      fillColor: c.color,
      fillOpacity: c.opacity ?? 0.7,
      strokeColor: c.color,
      strokeOpacity: 0,
      lineWidth: 0,
    })
    const circle = new mapkit.CircleOverlay(center, c.radius, { style })
    circleOverlayRefs.push(circle)
    map.addOverlay(circle)
  }
}

function clearCircles() {
  if (!map) return
  for (const c of circleOverlayRefs) {
    map.removeOverlay(c)
  }
  circleOverlayRefs.length = 0
}

/** Resize all circle overlays proportionally to the current visible map region. */
function resizeCirclesToRegion() {
  if (!map || !props.dynamicCircleRadius || circleOverlayRefs.length === 0) return
  const region = map.region
  if (!region) return
  const latDelta = region.span.latitudeDelta
  // 1 degree latitude ≈ 111,320 meters
  const rawRadius = latDelta * 111_320 * props.circleScaleFactor
  const clampedRadius = Math.max(props.minCircleRadius, Math.min(props.maxCircleRadius, rawRadius))
  for (const c of circleOverlayRefs) {
    c.radius = clampedRadius
  }
}

// ── Zoom behavior ────────────────────────────────────────────

function zoomToItem(item: T) {
  if (!map) return
  const center = new mapkit.Coordinate(item.lat, item.lng)
  const span = new mapkit.CoordinateSpan(props.zoomSpan.lat, props.zoomSpan.lng)
  map.setRegionAnimated(new mapkit.CoordinateRegion(center, span), true)
}

function zoomOut() {
  if (!map || !overviewRegion) return
  map.setRegionAnimated(overviewRegion, true)
}

// ── Watchers ─────────────────────────────────────────────────

// Re-render annotations and handle zoom when selection changes
watch(selectedId, (newId) => {
  if (!map) return
  rebuildAnnotations()
  if (props.suppressSelectionZoom) return
  if (newId) {
    const item = props.items.find((i) => i.id === newId)
    if (item) zoomToItem(item)
  } else {
    zoomOut()
  }
})

// Re-render annotations and zoom to fit when items change
watch(
  () => props.items,
  () => {
    if (!map) return
    if (props.preserveRegion) {
      clearPinCleanups()
      removeOwnedPinAnnotations()
      addAnnotations()
      return
    }

    selectedId.value = null
    clearPinCleanups()
    removeOwnedPinAnnotations()
    overviewRegion = computeBoundingRegion()
    if (overviewRegion) map.setRegionAnimated(overviewRegion, true)
    addAnnotations()
  },
  { deep: false },
)

// Re-render overlays when geojson changes (preserve zoom)
watch(
  () => props.geojson,
  () => {
    if (!map) return
    clearOverlays()
    addOverlays()
  },
  { deep: false },
)

// Re-render circles when circles change (preserve zoom)
watch(
  () => props.circles,
  () => {
    if (!map) return
    clearCircles()
    addCircles()
  },
  { deep: false },
)

let colorSchemeObserver: MutationObserver | null = null

function syncColorScheme() {
  if (!map || !import.meta.client) return
  map.colorScheme = document.documentElement.classList.contains('dark')
    ? mapkit.Map.ColorSchemes.Dark
    : mapkit.Map.ColorSchemes.Light
}

watch(mapkitReady, (ready) => {
  if (ready) void nextTick(initMap)
})

onMounted(() => {
  if (mapkitReady.value) initMap()
  colorSchemeObserver = new MutationObserver(syncColorScheme)
  colorSchemeObserver.observe(document.documentElement, {
    attributeFilter: ['class'],
    attributes: true,
  })
})

onBeforeUnmount(() => {
  colorSchemeObserver?.disconnect()
  colorSchemeObserver = null
  clearPinCleanups()
  removeOwnedPinAnnotations()
  if (map) {
    map.removeEventListener('select', handleOverlaySelect)
    clearOverlays()
    map.destroy()
    map = null
  }
})

function scrollIntoView() {
  mapContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setRegion(center: { lat: number; lng: number }, span?: { lat: number; lng: number }) {
  if (!map) return
  const coord = new mapkit.Coordinate(center.lat, center.lng)
  const s = new mapkit.CoordinateSpan(span?.lat ?? 0.01, span?.lng ?? 0.01)
  map.setRegionAnimated(new mapkit.CoordinateRegion(coord, s), true)
}
function zoomToFit(zoomOutLevels = 0) {
  if (!map) return
  const region = computeBoundingRegion()
  if (!region) return

  let latDelta = region.span.latitudeDelta
  let lngDelta = region.span.longitudeDelta
  for (let i = 0; i < zoomOutLevels; i++) {
    latDelta *= 2
    lngDelta *= 2
  }

  map.setRegionAnimated(
    new mapkit.CoordinateRegion(region.center, new mapkit.CoordinateSpan(latDelta, lngDelta)),
    true,
  )
}

function getMap() {
  return map
}

defineExpose({ scrollIntoView, setRegion, zoomToFit, getMap })
</script>

<template>
  <div class="mapkit-wrapper">
    <div
      v-if="mapkitError"
      class="mapkit-status"
    >
      <strong>Map unavailable</strong>
      <span>{{ mapkitError }}</span>
    </div>

    <div v-else-if="!mapkitReady" class="mapkit-status" role="status">
      <span>Loading map…</span>
    </div>

    <div
      ref="mapContainer"
      class="mapkit-canvas"
      :class="{ 'mapkit-canvas--hidden': !mapkitReady }"
    />
  </div>
</template>

<style scoped>
.mapkit-wrapper {
  isolation: isolate;
  overflow: hidden;
  position: relative;
  width: 100%;
  height: 100%;
}

.mapkit-status {
  align-items: center;
  backdrop-filter: blur(4px);
  background: color-mix(in srgb, Canvas 82%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: absolute;
  text-align: center;
  z-index: 10;
}

.mapkit-canvas {
  height: 100%;
  inset: 0;
  opacity: 1;
  position: absolute;
  transition: opacity 500ms ease-out;
  width: 100%;
}

.mapkit-canvas--hidden {
  opacity: 0;
}
</style>
