/**
 * `useMapKitView()` -- owns the MapKit map behind a map-first page's
 * `<AppMapKit>`: camera, frame, tier, padding, basemap, the `./marks` layer
 * and fullscreen.
 *
 * Lifted from buoys, the reference consumer of `./marks`. It carries no app
 * copy, domain types or data access: the caller supplies the marks to draw and
 * the chrome insets to keep clear, and renders `<AppMapKit :items="[]">` with
 * `@map-ready="view.onMapReady"` so the component's own pin layer stays empty.
 *
 * The page draws its own zoom buttons, layers menu and scale, so the view turns
 * MapKit's built-in controls off (MapKit paints its map-type control into the
 * canvas top-right, where it shows through as a second panel above any chrome).
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { refreshMapKitMapLayout } from '../../../client/layout.js'
import {
  padRect,
  projectToFrame,
  rectForBox,
  rectRevealing,
  tierForSpan,
  unpadRect,
  zoomRect,
} from '../../../marks/camera.js'
import { createMarkLayer } from '../../../marks/layer.js'
import { asMkMap, asMkRuntime } from '../../../marks/runtime.js'
import { useMapKitFullscreen } from './useMapKitFullscreen.js'

import type { FrameInsets, FrameSize, LatLon, LngLatBox, MapTier } from '../../../marks/camera.js'
import type { MarkLayer, MarkSpec } from '../../../marks/layer.js'
import type { MkMap, MkMapRect, MkMapType, MkRuntime } from '../../../marks/runtime.js'
import type { ComputedRef, Ref } from 'vue'

export interface UseMapKitViewOptions {
  /** Base map to show. Applied to the live map, not through `<AppMapKit>`'s prop. */
  basemap: () => MkMapType
  /** Pixels of chrome over each edge of the map the camera must keep clear. */
  insets: () => FrameInsets
  /**
   * Pixels MapKit itself keeps clear inside each edge, as `map.padding`.
   * MapKit JS 6 paints Apple's logo and Legal link INTO the canvas at the
   * bottom-left of this padded box -- there is no DOM node for them -- so
   * padding is the only way to lift them out from under the page's chrome.
   * Omitted, the map is unpadded. The view keeps the camera in whole-frame
   * terms either way: `rect`, `fitBox` and `reveal` never see the padding.
   */
  padding?: () => FrameInsets
  /** Marks for the current camera and data; re-read whenever its inputs change. */
  specs: () => readonly MarkSpec[]
  /** Map plus its chrome; the element fullscreen presents. */
  surface: () => HTMLElement | null
}

export interface UseMapKitViewResult {
  /** Frames a lat/lon box inside the part of the map the chrome leaves free. */
  fitBox: (box: LngLatBox, animate?: boolean) => void
  /** The map element's last real size, in CSS pixels. */
  frame: Readonly<Ref<FrameSize>>
  fullscreen: Readonly<Ref<boolean>>
  /** True once the map exists AND its host has a laid-out box. */
  mapReady: Readonly<Ref<boolean>>
  /** `<AppMapKit>`'s `map-ready` handler: `(map, mapkit)`, both untyped. */
  onMapReady: (map: unknown, mapkit: unknown) => void
  /** The whole-frame visible map rect, padding removed. */
  rect: Readonly<Ref<MkMapRect | null>>
  /** Pans a coordinate into the free area at the current zoom; already there is a no-op. */
  reveal: (point: LatLon, animate?: boolean) => void
  tier: ComputedRef<MapTier>
  toggleFullscreen: () => void
  /** Zooms around the camera centre; a factor above 1 zooms in. */
  zoomBy: (factor: number) => void
}

const EMPTY_FRAME: FrameSize = { height: 0, width: 0 }
const NO_PADDING: FrameInsets = { bottom: 0, left: 0, right: 0, top: 0 }
const HOST_RETRY_LIMIT = 16

function samePadding(a: FrameInsets, b: FrameInsets): boolean {
  return a.bottom === b.bottom && a.left === b.left && a.right === b.right && a.top === b.top
}

/**
 * MapKit's `FeatureVisibility.Hidden`, as a literal rather than a read off the
 * namespace: a runtime can model the map and not the enum (K-5).
 */
const FEATURE_HIDDEN = 'hidden'

function hostSize(element: HTMLElement): FrameSize {
  return { height: element.clientHeight, width: element.clientWidth }
}

function hostHasSize(size: FrameSize): boolean {
  return size.height > 0 && size.width > 0
}

export function useMapKitView(options: UseMapKitViewOptions): UseMapKitViewResult {
  const frame = shallowRef<FrameSize>(EMPTY_FRAME)
  const longitudeDelta = shallowRef(0)
  const rect = shallowRef<MkMapRect | null>(null)
  const mapReady = shallowRef(false)

  let map: MkMap | null = null
  let runtime: MkRuntime | null = null
  let layer: MarkLayer | null = null
  let observer: ResizeObserver | null = null
  let hostRetry: number | null = null
  let hostRetries = 0
  /** The padding the live map has now, which every rect crossing to MapKit is converted by. */
  let padding: FrameInsets = NO_PADDING
  /** Whether this map has had its padding set at all; the first set is explicit, even at zero. */
  let paddingSet = false

  const tier = computed<MapTier>(() => tierForSpan(longitudeDelta.value, frame.value.width || 1))

  /** Reads the camera back off the map once MapKit has settled a pan, zoom or resize. */
  function syncCamera() {
    if (!map) return
    const size = hostSize(map.element)
    // A 0×0 read after the first real layout is a transient (sheet swap,
    // header hide). Keep the last good frame so marks do not collapse back to
    // "nothing to project".
    if (hostHasSize(size) || !mapReady.value) frame.value = size
    const padded = map.visibleMapRect
    const whole = unpadRect(padded, frame.value, padding)
    // The region spans the padded box too; widen it by the same factor.
    const widen = padded.size.width > 0 ? whole.size.width / padded.size.width : 1
    longitudeDelta.value = map.region.span.longitudeDelta * widen
    rect.value = whole
  }

  /**
   * MapKit's `map-ready` can fire before the host has a laid-out box. The
   * tile layer often recovers on its own; custom annotations do not. Hold
   * `mapReady` until `clientWidth`/`clientHeight` are real, then re-apply the
   * region so the annotation overlay matches the canvas.
   */
  function settleHost() {
    if (!map) return
    syncCamera()
    if (!hostHasSize(frame.value)) {
      scheduleHostRetry()
      return
    }
    refreshMapKitMapLayout(map)
    syncCamera()
    mapReady.value = true
  }

  function scheduleHostRetry() {
    if (hostRetry !== null || hostRetries >= HOST_RETRY_LIMIT) return
    if (typeof requestAnimationFrame !== 'function') return
    hostRetries += 1
    hostRetry = requestAnimationFrame(() => {
      hostRetry = null
      settleHost()
    })
  }

  function applyBasemap() {
    if (map && runtime) map.mapType = runtime.MapType[options.basemap()]
  }

  /**
   * `camera.ts` is pure math and returns plain rects; MapKit's own setter wants
   * one of its `mapkit.MapRect` instances, so the conversion happens here --
   * the one place that holds both the runtime and the map.
   */
  function moveCamera(next: MkMapRect, animate: boolean) {
    if (!map || !runtime) return
    const { origin, size } = padRect(next, frame.value, padding)
    map.setVisibleMapRectAnimated(
      new runtime.MapRect(origin.x, origin.y, size.width, size.height),
      animate,
    )
  }

  /**
   * Applies the caller's padding. MapKit keeps the padded box's CENTRE when
   * the padding changes, which would slide the map under a phone sheet every
   * time it resizes; re-applying the whole-frame rect afterwards holds the
   * map still, so only Apple's logo moves.
   */
  function applyPadding() {
    const next = options.padding?.() ?? NO_PADDING
    if (!map || !runtime || (paddingSet && samePadding(next, padding))) return
    paddingSet = true
    const keep = mapReady.value ? rect.value : null
    padding = { ...next }
    map.padding = new runtime.Padding({ ...next })
    if (keep) moveCamera(keep, false)
    syncCamera()
  }

  function onMapReady(rawMap: unknown, rawMapKit: unknown) {
    const ready = asMkMap(rawMap)
    const scoped = asMkRuntime(rawMapKit)
    if (!ready || !scoped) return
    map = ready
    runtime = scoped
    map.showsZoomControl = false
    map.showsMapTypeControl = false
    map.showsScale = FEATURE_HIDDEN
    applyBasemap()
    applyPadding()
    map.addEventListener('region-change-end', syncCamera)
    layer = createMarkLayer(map, runtime)
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(settleHost)
      observer.observe(map.element)
    }
    settleHost()
  }

  function fitBox(box: LngLatBox, animate = true) {
    moveCamera(rectForBox(box, frame.value, options.insets()), animate)
  }

  function reveal(point: LatLon, animate = true) {
    const current = rect.value
    if (!current) return
    const at = projectToFrame(current, frame.value, point)
    const next = rectRevealing(current, frame.value, options.insets(), at)
    if (next) moveCamera(next, animate)
  }

  function zoomBy(factor: number) {
    const current = rect.value
    if (current) moveCamera(zoomRect(current, factor), true)
  }

  const fullscreen = useMapKitFullscreen({
    onLayout: () => {
      if (map) refreshMapKitMapLayout(map)
      syncCamera()
    },
    surface: options.surface,
  })

  watch(options.basemap, applyBasemap)
  // Gated on `mapReady` like `specs`: a watch source runs at setup, and the
  // page's padding getter can read state it declares after this composable.
  watch(() => (mapReady.value ? options.padding?.() : null), applyPadding)
  watch(
    () => (mapReady.value ? options.specs() : null),
    (specs) => {
      if (specs) layer?.render(specs)
    },
    { flush: 'post' },
  )

  onScopeDispose(() => {
    if (hostRetry !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(hostRetry)
    }
    hostRetry = null
    observer?.disconnect()
    observer = null
    map?.removeEventListener('region-change-end', syncCamera)
    layer?.destroy()
    layer = null
    map = null
    runtime = null
    padding = NO_PADDING
    paddingSet = false
    mapReady.value = false
  })

  return {
    fitBox,
    frame,
    fullscreen: fullscreen.active,
    mapReady,
    onMapReady,
    rect,
    reveal,
    tier,
    toggleFullscreen: fullscreen.toggle,
    zoomBy,
  }
}
