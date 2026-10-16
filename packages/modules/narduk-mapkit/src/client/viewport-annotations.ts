/**
 * Viewport-bounded annotation management: keep only the markers near what the
 * map shows in the DOM, however many there are in the data.
 *
 * A city has thousands of stops, but a phone shows forty. Every annotation
 * MapKit holds costs a DOM node and a layout pass on every pan, so a layer that
 * adds all of them is slow exactly when it matters (a pan on a mid-range
 * phone). This wraps `MapKitAnnotationRegistry`: `sync(items, region)` adds the
 * items inside the region (plus a margin so a small pan reveals nothing late),
 * removes those well outside it, and leaves the rest untouched.
 *
 * The margin has hysteresis, so a marker on the boundary does not flicker in
 * and out: an item enters at `enterPadding` of the region's size beyond each
 * edge, but is only removed once it is `keepPadding` beyond. Items the consumer
 * names in `pinned` (the selected one, the followed one) are always kept.
 *
 * Call `sync` from the map's region-change-end (or the `region-change` event
 * of `<AppMapKit>`), and again when the data changes.
 */
import { isInVisibleRegion } from '../geometry/declutter.js'

import { MapKitAnnotationRegistry } from './annotations.js'

import type { LatLng } from '../geometry/helpers.js'
import type { MapKitVisibleRegion } from '../geometry/declutter.js'
import type {
  MapKitAnnotationDescriptor,
  MapKitAnnotationMapHandle,
  MapKitAnnotationReconcileResult,
} from './annotations.js'

export interface MapKitViewportAnnotationsOptions<TItem extends LatLng, TAnnotation> {
  /** Build the annotation for an item. Called once per item that enters. */
  create: (item: TItem) => TAnnotation
  /**
   * Fraction of the region's size beyond each edge at which an item is added.
   * Default 0.25. Must not exceed `keepPadding`.
   */
  enterPadding?: number
  /** Stable identity of an item. */
  key: (item: TItem) => string
  /**
   * Fraction of the region's size beyond each edge at which an item already on
   * the map is removed. Default 0.6.
   */
  keepPadding?: number
  map: MapKitAnnotationMapHandle<TAnnotation>
  /** Keys that stay on the map wherever the region is. */
  pinned?: () => Iterable<string>
  /** Everything that changes how an item looks. Without it, an item is built once. */
  signature?: (item: TItem) => string
  /** Apply a changed signature in place instead of rebuilding that annotation. */
  update?: (annotation: TAnnotation, item: TItem) => void
}

export class MapKitViewportAnnotations<TItem extends LatLng, TAnnotation> {
  readonly #options: MapKitViewportAnnotationsOptions<TItem, TAnnotation>
  readonly #registry: MapKitAnnotationRegistry<TAnnotation>

  constructor(options: MapKitViewportAnnotationsOptions<TItem, TAnnotation>) {
    const enter = options.enterPadding ?? 0.25
    const keep = options.keepPadding ?? 0.6
    if (enter > keep) throw new Error('enterPadding must not exceed keepPadding')
    this.#options = options
    this.#registry = new MapKitAnnotationRegistry({ map: options.map })
  }

  /** Annotations on the map now. */
  get size(): number {
    return this.#registry.size
  }

  has(key: string): boolean {
    return this.#registry.has(key)
  }

  get(key: string): TAnnotation | undefined {
    return this.#registry.get(key)
  }

  keys(): readonly string[] {
    return this.#registry.list()
  }

  /**
   * Make the map hold the items near `region`. Pass `null` for a region not yet
   * known: every item is held back, because adding thousands before the first
   * region report is the stall this exists to avoid.
   */
  sync(
    items: readonly TItem[],
    region: MapKitVisibleRegion | null,
  ): MapKitAnnotationReconcileResult {
    const { create, key, pinned, signature, update } = this.#options
    const enter = this.#options.enterPadding ?? 0.25
    const keep = this.#options.keepPadding ?? 0.6
    const pins = new Set(pinned?.() ?? [])

    const descriptors: Array<MapKitAnnotationDescriptor<TAnnotation>> = []
    for (const item of items) {
      const id = key(item)
      const wanted =
        pins.has(id) ||
        (region !== null && isInVisibleRegion(item, region, this.#registry.has(id) ? keep : enter))
      if (!wanted) continue
      descriptors.push({
        create: () => create(item),
        key: id,
        signature: signature?.(item) ?? '',
        ...(update ? { update: (annotation: TAnnotation) => update(annotation, item) } : {}),
      })
    }
    return this.#registry.reconcile(descriptors)
  }

  /** Remove everything and refuse further syncs. */
  destroy(): void {
    this.#registry.destroy()
  }
}
