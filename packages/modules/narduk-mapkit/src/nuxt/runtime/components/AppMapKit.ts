/**
 * `<AppMapKit>` -- the 2.1.0 map component at
 * `@narduk-enterprises/narduk-mapkit/nuxt`.
 *
 * ## Why this is a render function and not a `.vue` file
 *
 * Everything else this package publishes is framework-free and its `dist/` is
 * committed and built by plain `tsc`. An SFC would mean adding an SFC compiler
 * to a package whose other nine entry points have no use for one, and a second
 * build output to keep in sync with the committed one. A render function costs
 * one import of `vue` and compiles with the rest of the package.
 *
 * ## What the component itself owns
 *
 * Almost nothing. The decisions -- keyed reconciliation, per-pin anchor
 * geometry, callout placement, overlay lifecycle -- live in the framework-free
 * controllers beside this file, because two consumers drive MapKit from plain
 * TypeScript and the seam has to hold without Vue (narduk-libs#422). This file
 * turns props into calls on those controllers and renders the slots.
 */
import {
  Teleport,
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { MapKitCalloutHostLayer } from '../callout-host.js'
import { useMapKitPreload } from '../preload.js'
import { MapKitOverlayLayer } from '../overlay-layer.js'
import { mapKitAnchorOffset } from '../pin-geometry.js'
import { MapKitPinLayer, defaultMapKitItemKey } from '../pin-layer.js'
import { mapKitBoundingRegion, mapKitGeometryPoints } from '../region.js'
import { mapKitColorModeInjectionKey, mapKitNonceInjectionKey } from '../injection-keys.js'
import { useMapKit } from '../composables/useMapKit.js'

import type { MapKitCalloutEntry, MapKitCalloutPoint } from '../callout-host.js'
import type { MapKitMapLike, MapKitNamespaceLike, MapKitRegionLike } from '../mapkit-surface.js'
import type { MapKitOverlayMapLike, MapKitOverlayNamespaceLike } from '../overlay-layer.js'
import type { MapKitPinGeometry } from '../pin-geometry.js'
import type { MapKitDiff, MapKitPinElement, MapKitPinItem } from '../pin-layer.js'
import type { MapKitLatLng } from '../region.js'
import type { MapKitFailure, MapKitLibrary } from '../../../client/mapkit.js'
import type {
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  GeoJSONFeatureProperties,
  MapKitCircle,
  MapKitColorScheme,
  MapKitMapType,
  OverlayStyle,
} from '../../types.js'
import type { PropType, SlotsType, VNode } from 'vue'

type MapKitItem = MapKitPinItem & { id?: string }

export interface MapKitCalloutSlotScope<T> {
  close: () => void
  id: string
  item: T
  placement: 'above' | 'below'
  position: MapKitCalloutPoint
}

const props = {
  ariaLabel: { default: 'Map', type: String },
  boundingPadding: { default: 0.05, type: Number },
  /** Open the callout for the selected item. Off hands control to `openCallout`. */
  calloutFollowSelection: { default: true, type: Boolean },
  circleScaleFactor: { default: 0.004, type: Number },
  circles: { default: () => [] as MapKitCircle[], type: Array as PropType<MapKitCircle[]> },
  clusteringIdentifier: { default: undefined, type: String },
  colorScheme: { default: 'auto' as const, type: String as PropType<MapKitColorScheme> },
  createClusterElement: {
    default: undefined,
    type: Function as PropType<
      (cluster: { coordinate: unknown; memberAnnotations: unknown[] }, count: number) => HTMLElement
    >,
  },
  /** Returns ONLY the glyph. The focusable, labelled host is the library's. */
  createPinElement: {
    default: undefined,
    type: Function as PropType<(item: MapKitItem, isSelected: boolean) => MapKitPinElement>,
  },
  dynamicCircleRadius: { default: false, type: Boolean },
  fallbackCenter: { default: undefined, type: Object as PropType<MapKitLatLng> },
  geojson: { default: null, type: Object as PropType<GeoJSONFeatureCollection | null> },
  isRotationEnabled: { default: false, type: Boolean },
  isScrollEnabled: { default: true, type: Boolean },
  isZoomEnabled: { default: true, type: Boolean },
  items: { default: () => [] as MapKitItem[], type: Array as PropType<readonly MapKitItem[]> },
  /**
   * The buoys#112 root-cause fix: a stable key per item is what makes an
   * `items` change a diff instead of a rebuild.
   */
  itemKey: {
    default: defaultMapKitItemKey,
    type: Function as PropType<(item: MapKitItem, index: number) => string>,
  },
  /** REQUIRED when `items` is non-empty: the accessible name of the pin. */
  itemLabel: { default: undefined, type: Function as PropType<(item: MapKitItem) => string> },
  language: { default: undefined, type: String },
  /** REQUIRED: MapKit JS 6 loads no map library by default. */
  libraries: { default: undefined, type: Array as PropType<readonly MapKitLibrary[]> },
  mapType: { default: 'standard' as const, type: String as PropType<MapKitMapType> },
  maxCircleRadius: { default: 6000, type: Number },
  minCircleRadius: { default: 200, type: Number },
  minSpanDelta: { default: 0, type: Number },
  nonce: { default: undefined, type: String },
  overlayStyleFn: {
    default: undefined,
    type: Function as PropType<(properties: GeoJSONFeatureProperties) => OverlayStyle>,
  },
  /** Per-pin size and anchor. Replaces 2.0.x's one global `annotationSize`. */
  pinGeometry: {
    default: undefined,
    type: Function as PropType<(item: MapKitItem) => MapKitPinGeometry>,
  },
  /** 7 of 7 consumers set this, so 2.1.0 flips the default. */
  preserveRegion: { default: true, type: Boolean },
  selectedId: { default: null, type: String as PropType<string | null> },
  /** Six observed consumer values, all `false`, riverstatus included. */
  showsPointsOfInterest: { default: false, type: Boolean },
  /** 4 of 5 selection users set this, so 2.1.0 flips the default. */
  suppressSelectionZoom: { default: true, type: Boolean },
  zoomSpan: {
    default: () => ({ lat: 0.002, lng: 0.0025 }),
    type: Object as PropType<MapKitLatLng>,
  },
} as const

const AppMapKitImpl = defineComponent({
  name: 'AppMapKit',
  props,
  emits: {
    'callout-close': (payload: { id: string; item: MapKitItem }) => Boolean(payload),
    'callout-open': (payload: { id: string; item: MapKitItem }) => Boolean(payload),
    'feature-select': (feature: GeoJSONFeature) => Boolean(feature),
    'map-click': (coordinate: MapKitLatLng) => Boolean(coordinate),
    'map-ready': (map: unknown) => Boolean(map),
    'mapkit-error': (failure: MapKitFailure) => Boolean(failure),
    'region-change': (region: {
      centerLat: number
      centerLng: number
      latDelta: number
      lngDelta: number
    }) => Boolean(region),
    'update:selectedId': (id: string | null) => id === null || typeof id === 'string',
  },
  slots: Object as SlotsType<{
    callout?: (scope: MapKitCalloutSlotScope<MapKitItem>) => VNode[]
    default?: () => VNode[]
    error?: (scope: { failure: MapKitFailure; retry: () => void }) => VNode[]
    fallback?: () => VNode[]
    loading?: () => VNode[]
  }>,
  setup(componentProps, { emit, expose, slots }) {
    const injectedNonce = inject(mapKitNonceInjectionKey, null)
    const colorMode = inject(mapKitColorModeInjectionKey, null)

    const mapKitOptions: Parameters<typeof useMapKit>[0] = {}
    if (componentProps.libraries) mapKitOptions.libraries = componentProps.libraries
    if (componentProps.language !== undefined) mapKitOptions.language = componentProps.language

    // Emitted from the component, so a page with no map downloads nothing (§f).
    useMapKitPreload({
      ...mapKitOptions,
      ...((componentProps.nonce ?? injectedNonce)
        ? { nonce: componentProps.nonce ?? injectedNonce ?? undefined }
        : {}),
    })
    const { failure, mapkit, ready, retry: retryLoad } = useMapKit(mapKitOptions)

    const calloutEntries = shallowRef<ReadonlyArray<MapKitCalloutEntry<MapKitItem>>>([])
    const containerRef = ref<HTMLElement | null>(null)
    /**
     * `ready` says MapKit JS loaded; this says the `mapkit.Map` exists. They are
     * one tick apart -- the map is constructed in a post-flush watcher, after
     * the container element is in the DOM -- and the wrapper's
     * `data-mapkit-state` has to track the second, not the first. A plain `let`
     * cannot: it would leave the component rendered as `loading` forever.
     */
    const mapReady = ref(false)
    const wrapperRef = ref<HTMLElement | null>(null)

    let calloutLayer: MapKitCalloutHostLayer<MapKitItem> | null = null
    let map: MapKitMapLike | null = null
    let overlayLayer: MapKitOverlayLayer | null = null
    let overviewRegion: MapKitRegionLike | null = null
    let pinLayer: MapKitPinLayer<MapKitItem> | null = null

    const state = computed(() => {
      if (failure.value) return 'error'
      return ready.value && mapReady.value ? 'ready' : 'loading'
    })

    function report(cause: unknown): void {
      const next: MapKitFailure = {
        message: cause instanceof Error ? cause.message : String(cause),
        source: 'mapkit',
        status: 'Unknown',
      }
      emit('mapkit-error', next)
      throw cause
    }

    function framingPoints(): MapKitLatLng[] {
      const points: MapKitLatLng[] = componentProps.items.map((item) => ({
        lat: item.lat,
        lng: item.lng,
      }))
      for (const feature of componentProps.geojson?.features ?? []) {
        points.push(...mapKitGeometryPoints(feature.geometry))
      }
      for (const circle of componentProps.circles) points.push({ lat: circle.lat, lng: circle.lng })
      return points
    }

    function toRegion(namespace: MapKitNamespaceLike, plain: MapKitLatLng, span: MapKitLatLng) {
      return new namespace.CoordinateRegion(
        new namespace.Coordinate(plain.lat, plain.lng),
        new namespace.CoordinateSpan(span.lat, span.lng),
      )
    }

    function computeOverview(namespace: MapKitNamespaceLike): MapKitRegionLike | null {
      const plain = mapKitBoundingRegion(framingPoints(), {
        boundingPadding: componentProps.boundingPadding,
        fallbackCenter: componentProps.fallbackCenter,
        minSpanDelta: componentProps.minSpanDelta,
      })
      if (!plain) return null
      return toRegion(namespace, plain.center, plain.span)
    }

    /**
     * Where a coordinate lands inside the map container.
     *
     * `convertCoordinateToPointOnPage` is the right answer where it exists, but
     * the deterministic fake at `./testing` deliberately does not model it and
     * THROWS rather than answering `undefined` -- and a real map that has not
     * laid out yet returns `null`. Both fall through to the pin's own placed
     * position, which MapKit and the fake both write.
     */
    function projectCoordinate(
      coordinate: { lat: number; lng: number },
      id: string,
    ): MapKitCalloutPoint | null {
      const container = containerRef.value
      const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
      if (!container || !map || !namespace) return null

      try {
        const convert = (
          map as unknown as {
            convertCoordinateToPointOnPage?: (value: unknown) => { x: number; y: number } | null
          }
        ).convertCoordinateToPointOnPage
        if (typeof convert === 'function') {
          const point = convert.call(map, new namespace.Coordinate(coordinate.lat, coordinate.lng))
          if (point) {
            const box = container.getBoundingClientRect()
            return {
              x: point.x - box.left - globalThis.scrollX,
              y: point.y - box.top - globalThis.scrollY,
            }
          }
        }
      } catch {
        // Not modelled on this map; the pin's own position answers the same question.
      }

      const host = pinLayer?.hostFor(id)
      if (!host) return null
      const geometry = componentProps.pinGeometry?.(pinLayer?.itemFor(id) as MapKitItem) ?? {}
      const offset = mapKitAnchorOffset(geometry)
      const left = host.offsetLeft || Number.parseFloat(host.style.left || '0')
      const top = host.offsetTop || Number.parseFloat(host.style.top || '0')
      return {
        x: left - offset.x + (geometry.size ? geometry.size.width / 2 + offset.x : 0),
        y: top,
      }
    }

    function calloutAnchorOffset(item: MapKitItem): MapKitCalloutPoint {
      const geometry = componentProps.pinGeometry?.(item) ?? {}
      const offset = mapKitAnchorOffset(geometry)
      return { x: offset.x + (geometry.size?.width ?? 0) / 2, y: offset.y }
    }

    function openCallout(id: string): void {
      const item = pinLayer?.itemFor(id)
      const container = containerRef.value
      if (!item || !container) return
      calloutLayer ??= new MapKitCalloutHostLayer<MapKitItem>({
        container,
        onChange: (entries) => {
          calloutEntries.value = entries
        },
        projectCoordinate,
      })
      calloutLayer.open({
        anchorOffset: calloutAnchorOffset(item),
        coordinate: { lat: item.lat, lng: item.lng },
        id,
        item,
      })
      emit('callout-open', { id, item })
    }

    function closeCallout(id?: string): void {
      if (!calloutLayer) return
      const targets = id === undefined ? [...calloutLayer.openIds] : [id]
      for (const target of targets) {
        const item = pinLayer?.itemFor(target)
        if (calloutLayer.close(target) && item) emit('callout-close', { id: target, item })
      }
    }

    function select(id: string | null): void {
      if (id === componentProps.selectedId) return
      emit('update:selectedId', id)
    }

    function applySelection(id: string | null): void {
      if (!pinLayer) return
      pinLayer.setSelected(id)
      if (!componentProps.calloutFollowSelection) return
      closeCallout()
      if (id !== null) openCallout(id)
    }

    function zoomToItem(namespace: MapKitNamespaceLike, item: MapKitItem): void {
      map?.setRegionAnimated(
        toRegion(namespace, { lat: item.lat, lng: item.lng }, componentProps.zoomSpan),
        true,
      )
    }

    function applyItems(): void {
      const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
      if (!map || !pinLayer || !namespace) return
      pinLayer.setItems(componentProps.items)
      if (componentProps.preserveRegion) return
      overviewRegion = computeOverview(namespace)
      if (overviewRegion) map.setRegionAnimated(overviewRegion, true)
    }

    function initMap(): void {
      const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
      const container = containerRef.value
      if (!namespace || !container || map) return

      overviewRegion = computeOverview(namespace)
      const mapOptions: Record<string, unknown> = {
        colorScheme: resolveColorScheme(),
        isRotationEnabled: componentProps.isRotationEnabled,
        isScrollEnabled: componentProps.isScrollEnabled,
        isZoomEnabled: componentProps.isZoomEnabled,
        mapType: componentProps.mapType,
        showsPointsOfInterest: componentProps.showsPointsOfInterest,
      }
      if (overviewRegion) mapOptions['region'] = overviewRegion
      if (
        componentProps.clusteringIdentifier !== undefined &&
        componentProps.createClusterElement
      ) {
        mapOptions['annotationForCluster'] = (cluster: {
          coordinate: unknown
          memberAnnotations: unknown[]
        }) =>
          new namespace.Annotation(
            cluster.coordinate as { latitude: number; longitude: number },
            () => componentProps.createClusterElement!(cluster, cluster.memberAnnotations.length),
            { calloutEnabled: false },
          )
      }

      map = new namespace.Map(container, mapOptions)
      pinLayer = new MapKitPinLayer<MapKitItem>({
        ...(componentProps.clusteringIdentifier === undefined
          ? {}
          : { clusteringIdentifier: componentProps.clusteringIdentifier }),
        ...(componentProps.createPinElement
          ? {
              createPinElement: (item, selected) =>
                componentProps.createPinElement!(item, selected),
            }
          : {}),
        ...(componentProps.itemLabel
          ? { itemLabel: (item) => componentProps.itemLabel!(item) }
          : {}),
        // Read the live prop, not the function identity captured at init -- a
        // pinGeometry-only setProps would otherwise restyle nothing.
        itemKey: (item, index) => componentProps.itemKey(item, index),
        pinGeometry: (item) => componentProps.pinGeometry?.(item) ?? {},
        map,
        mapkit: namespace,
        onSelect: select,
      })

      map.addEventListener('region-change-end', () => {
        const region = map?.region
        if (!region) return
        emit('region-change', {
          centerLat: region.center.latitude,
          centerLng: region.center.longitude,
          latDelta: region.span.latitudeDelta,
          lngDelta: region.span.longitudeDelta,
        })
        overlayLayer?.resizeCirclesToRegion(region.span.latitudeDelta)
        calloutLayer?.reposition()
      })

      pinLayer.setItems(componentProps.items)
      applyOverlays()
      if (componentProps.selectedId !== null) applySelection(componentProps.selectedId)
      mapReady.value = true
      emit('map-ready', map)
    }

    function applyOverlays(): void {
      const hasOverlayWork =
        (componentProps.geojson?.features.length ?? 0) > 0 || componentProps.circles.length > 0
      if (!map || (!overlayLayer && !hasOverlayWork)) return
      const namespace = mapkit.value as unknown as MapKitOverlayNamespaceLike | null
      if (!namespace) return
      overlayLayer ??= new MapKitOverlayLayer({
        circleScaleFactor: componentProps.circleScaleFactor,
        dynamicCircleRadius: componentProps.dynamicCircleRadius,
        map: map as MapKitOverlayMapLike,
        mapkit: namespace,
        maxCircleRadius: componentProps.maxCircleRadius,
        minCircleRadius: componentProps.minCircleRadius,
        ...(componentProps.overlayStyleFn ? { overlayStyleFn: componentProps.overlayStyleFn } : {}),
      })
      overlayLayer.setGeoJSON(componentProps.geojson)
      overlayLayer.setCircles(componentProps.circles)
    }

    function resolveColorScheme(): 'dark' | 'light' {
      if (componentProps.colorScheme !== 'auto') return componentProps.colorScheme
      return colorMode?.value === 'dark' ? 'dark' : 'light'
    }

    watch(
      () => ready.value,
      (value) => {
        if (value) {
          try {
            initMap()
          } catch (cause) {
            report(cause)
          }
        }
      },
      { flush: 'post', immediate: true },
    )
    watch(
      () => componentProps.items,
      () => {
        try {
          applyItems()
        } catch (cause) {
          report(cause)
        }
      },
    )
    watch(
      () => componentProps.selectedId,
      (id) => {
        applySelection(id)
        const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
        if (componentProps.suppressSelectionZoom || !map || !namespace) return
        const item = id === null ? null : pinLayer?.itemFor(id)
        if (item) zoomToItem(namespace, item)
        else if (overviewRegion) map.setRegionAnimated(overviewRegion, true)
      },
    )
    watch(
      () => [componentProps.geojson, componentProps.circles] as const,
      () => {
        applyOverlays()
      },
    )
    watch(
      () =>
        [
          componentProps.createPinElement,
          componentProps.itemKey,
          componentProps.itemLabel,
          componentProps.pinGeometry,
        ] as const,
      () => {
        try {
          applyItems()
        } catch (cause) {
          report(cause)
        }
      },
    )
    watch(
      () => failure.value,
      (value) => {
        if (value) emit('mapkit-error', value)
      },
    )

    onBeforeUnmount(() => {
      calloutLayer?.destroy()
      calloutLayer = null
      calloutEntries.value = []
      overlayLayer?.destroy()
      overlayLayer = null
      pinLayer?.destroy()
      pinLayer = null
      map?.destroy()
      map = null
    })

    function retry(): void {
      pinLayer?.destroy()
      pinLayer = null
      overlayLayer?.destroy()
      overlayLayer = null
      calloutLayer?.destroy()
      calloutLayer = null
      calloutEntries.value = []
      map?.destroy()
      map = null
      mapReady.value = false
      retryLoad()
    }

    expose({
      closeCallout,
      getDiagnostics: (): { annotations: number; lastDiff: MapKitDiff } =>
        pinLayer?.getDiagnostics() ?? {
          annotations: 0,
          lastDiff: { added: [], moved: [], removed: [], restyled: [] },
        },
      getMap: () => map,
      openCallout,
      retry,
      scrollIntoView: () => {
        containerRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
      select,
      setRegion: (center: MapKitLatLng, span?: MapKitLatLng) => {
        const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
        if (!map || !namespace) return
        map.setRegionAnimated(toRegion(namespace, center, span ?? { lat: 0.01, lng: 0.01 }), true)
      },
      zoomToFit: (zoomOutLevels = 0) => {
        const namespace = mapkit.value as unknown as MapKitNamespaceLike | null
        if (!map || !namespace) return
        const plain = mapKitBoundingRegion(framingPoints(), {
          boundingPadding: componentProps.boundingPadding,
          fallbackCenter: componentProps.fallbackCenter,
          minSpanDelta: componentProps.minSpanDelta,
        })
        if (!plain) return
        const factor = 2 ** zoomOutLevels
        map.setRegionAnimated(
          toRegion(namespace, plain.center, {
            lat: plain.span.lat * factor,
            lng: plain.span.lng * factor,
          }),
          true,
        )
      },
    })

    return () => {
      const children: VNode[] = []

      if (failure.value) {
        children.push(
          h(
            'div',
            { class: 'mapkit-status', role: 'alert' },
            slots.error?.({ failure: failure.value, retry }) ?? [
              h('strong', 'Map unavailable'),
              // Never the raw error: the code and a retry, per §c.4.
              h('span', failure.value.status),
              h('button', { onClick: retry, type: 'button' }, 'Try again'),
            ],
          ),
        )
      } else if (!ready.value) {
        children.push(
          h(
            'div',
            { class: 'mapkit-status', role: 'status' },
            slots.loading?.() ?? [h('span', 'Loading map…')],
          ),
        )
      }

      if (slots.fallback && failure.value?.source === 'mapkit') {
        children.push(h('div', { class: 'mapkit-fallback' }, slots.fallback()))
      }

      children.push(
        h('div', {
          class: 'mapkit-canvas',
          nonce: componentProps.nonce ?? injectedNonce ?? undefined,
          ref: containerRef,
        }),
      )
      if (slots.default) children.push(...slots.default())

      for (const entry of calloutEntries.value) {
        if (!slots.callout) break
        children.push(
          h(
            Teleport,
            { key: entry.id, to: entry.host },
            {
              default: () =>
                slots.callout?.({
                  close: () => {
                    closeCallout(entry.id)
                    if (componentProps.calloutFollowSelection) select(null)
                  },
                  id: entry.id,
                  item: entry.item,
                  placement: entry.placement,
                  position: entry.position,
                }),
            },
          ),
        )
      }

      return h(
        'div',
        {
          'aria-label': componentProps.ariaLabel,
          class: 'mapkit-wrapper',
          'data-mapkit-state': state.value,
          ref: wrapperRef,
          role: 'region',
        },
        children,
      )
    }
  },
})

/**
 * Exported with a generic construct signature so an app's own item type flows
 * through `items`, `itemKey`, `createPinElement`, `pinGeometry` and the
 * `#callout` slot. The runtime props above cannot carry a type parameter, so the
 * generic surface is applied here, once.
 */
export default AppMapKitImpl as typeof AppMapKitImpl & {
  new <T extends MapKitPinItem>(): {
    $props: Omit<InstanceType<typeof AppMapKitImpl>['$props'], 'items'> & {
      items?: readonly T[]
    }
  }
}
