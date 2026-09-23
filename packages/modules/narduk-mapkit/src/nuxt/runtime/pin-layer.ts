/**
 * The keyed pin layer: `<AppMapKit>`'s annotation seam, with no Vue in it.
 *
 * ## Why this is a controller and not component code
 *
 * Two consumers (gonogo and earthdata) drive MapKit from plain TypeScript, and
 * the 2.1.0 contract (narduk-libs#422) requires the seam to hold without Vue. So
 * everything that decides *what the map is told* lives here and is exercised by
 * `tests/nuxt/pin-layer.test.ts` with no component mounted; `AppMapKit` only
 * turns props and watchers into calls on this object.
 *
 * ## The buoys#112 root cause
 *
 * 2.0.x rebuilt every annotation on every `items` change **and on every
 * selection change**: `rebuildAnnotations()` removed all N and added all N. On a
 * 570-pin mobile map that destroyed the DOM node the user had just tapped, so
 * the callout's "View details" link never survived long enough to be pressed.
 *
 * Here:
 *
 * - `setItems()` reconciles by key. An unchanged pin is not touched at all; a
 *   moved or restyled pin is updated **in place**, keeping its annotation object
 *   identity and its DOM host; only genuinely new keys are added and genuinely
 *   absent keys removed. Initial render of N items is exactly one
 *   `addAnnotations` call.
 * - `setSelected()` performs **zero** adds and **zero** removes. It re-renders
 *   exactly the outgoing and incoming glyphs inside hosts that persist, so
 *   `document.activeElement` survives a selection change.
 *
 * ## Who owns which element
 *
 * The library owns the **host**: a `role="button"`, `tabindex="0"` element
 * carrying the accessible name, `aria-pressed`, the click and Enter/Space
 * handlers, and the test hooks. The app owns the **glyph** only, returned by
 * `createPinElement`. That split is what makes every pin Tab-reachable without
 * every app re-implementing it -- the third defect the 2.1.0 fake pinned.
 */
import { MapKitAnnotationRegistry } from '../../client/annotations.js'

import { mapKitAnchorOffset, mapKitPinGeometrySignature } from './pin-geometry.js'

import type { MapKitPinGeometry } from './pin-geometry.js'
import type {
  MapKitAnnotationLike,
  MapKitAnnotationOptionsLike,
  MapKitMapLike,
  MapKitNamespaceLike,
} from './mapkit-surface.js'

/** The minimum an `<AppMapKit>` item carries: somewhere to put it. */
export interface MapKitPinItem {
  lat: number
  lng: number
}

/** What one `setItems()` or `setSelected()` did, as `getDiagnostics().lastDiff`. */
export interface MapKitDiff {
  added: string[]
  moved: string[]
  removed: string[]
  restyled: string[]
}

export interface MapKitPinElement {
  cleanup?: () => void
  element: HTMLElement
}

/** How a pin selection was made. */
export type MapKitSelectVia = 'keyboard' | 'pointer'

export interface MapKitPinLayerOptions<T extends MapKitPinItem> {
  /** Merges nearby pins into cluster bubbles at low zoom. Unchanged from 2.0.x. */
  clusteringIdentifier?: string
  /** The app's glyph factory. Without one the layer renders nothing. */
  createPinElement?: (item: T, isSelected: boolean) => MapKitPinElement
  /** Injected so a plain-TS test can run against any document. */
  document?: Document
  /**
   * Whether the library-owned host is an interactive control. Default `true`.
   *
   * 2.1.0 had no way to say otherwise (2.1.1, K-8): every host carried
   * `role="button"` and `tabindex="0"`, so a decorative map marked
   * `aria-hidden="true"` was full of focusable descendants -- axe's
   * `aria-hidden-focus` -- and the only way out was `inert` on the consumer's
   * side. `false` builds a plain host: no role, no tabindex, no `aria-pressed`,
   * no click or key listener, and no required `itemLabel`.
   */
  focusable?: boolean
  /** Stable identity per item. Must be non-blank and unique. */
  itemKey: (item: T, index: number) => string
  /**
   * Accessible name of the library-owned host. Required whenever `items` is
   * non-empty AND the host is focusable; a non-interactive host has no
   * accessible name to carry.
   */
  itemLabel?: (item: T) => string
  map: MapKitMapLike
  mapkit: MapKitNamespaceLike
  /**
   * Called when a pin is activated by pointer or keyboard, with the toggled id
   * and which of the two activated it.
   */
  onSelect?: (id: string | null, via: MapKitSelectVia) => void
  pinGeometry?: (item: T) => MapKitPinGeometry
}

interface MapKitPinEntry<T> {
  annotation: MapKitAnnotationLike
  cleanup: (() => void) | undefined
  geometrySignature: string
  host: HTMLElement
  item: T
  selected: boolean
}

function emptyDiff(): MapKitDiff {
  return { added: [], moved: [], removed: [], restyled: [] }
}

/** `item.id` is the default key, so the common case needs no `itemKey` prop. */
export function defaultMapKitItemKey(item: unknown, index: number): string {
  const id = (item as { id?: unknown }).id
  if (typeof id === 'string' && id.trim()) return id
  throw new Error(
    `<AppMapKit>: items[${String(index)}] has no string "id", so it needs an explicit itemKey. ` +
      'A stable key per item is what makes an items change a diff instead of a rebuild.',
  )
}

let itemTokenCounter = 0
const itemTokens = new WeakMap<object, string>()

/**
 * A per-render identity token for the item object.
 *
 * The layer cannot know what inside an app's item affects its glyph, so it uses
 * the object's identity: Vue hands a new object when the data changed and the
 * same object when it did not, which is exactly the question being asked. An
 * item that is not an object falls back to its string form.
 */
function itemToken(item: unknown): string {
  if (typeof item !== 'object' || item === null) return String(item)
  let token = itemTokens.get(item)
  if (!token) {
    itemTokenCounter += 1
    token = `#${String(itemTokenCounter)}`
    itemTokens.set(item, token)
  }
  return token
}

export class MapKitPinLayer<T extends MapKitPinItem> {
  readonly #document: Document
  readonly #entries = new Map<string, MapKitPinEntry<T>>()
  readonly #options: MapKitPinLayerOptions<T>
  readonly #registry: MapKitAnnotationRegistry<MapKitAnnotationLike>
  #destroyed = false
  #lastDiff: MapKitDiff = emptyDiff()
  #selectedId: string | null = null

  constructor(options: MapKitPinLayerOptions<T>) {
    this.#options = options
    this.#document = options.document ?? globalThis.document
    this.#registry = new MapKitAnnotationRegistry<MapKitAnnotationLike>({
      map: {
        addAnnotations: (annotations) => {
          options.map.addAnnotations(annotations)
        },
        removeAnnotations: (annotations) => {
          options.map.removeAnnotations(annotations)
        },
      },
    })
  }

  get selectedId(): string | null {
    return this.#selectedId
  }

  get size(): number {
    return this.#entries.size
  }

  /** `getDiagnostics()` on the component's expose (§c.6). */
  getDiagnostics(): { annotations: number; lastDiff: MapKitDiff } {
    return { annotations: this.#entries.size, lastDiff: this.#lastDiff }
  }

  /** The annotation for a key, for a caller that needs MapKit's own object. */
  annotationFor(key: string): MapKitAnnotationLike | undefined {
    return this.#entries.get(key)?.annotation
  }

  /** The library-owned host element for a key. The `#callout` seam anchors on it. */
  hostFor(key: string): HTMLElement | undefined {
    return this.#entries.get(key)?.host
  }

  itemFor(key: string): T | undefined {
    return this.#entries.get(key)?.item
  }

  keys(): readonly string[] {
    return [...this.#entries.keys()]
  }

  /**
   * Sync the map to exactly `items`.
   *
   * One batched `removeAnnotations` and one batched `addAnnotations` at most;
   * an unchanged key makes neither call, and a moved or restyled key is applied
   * in place rather than recreated.
   */
  setItems(items: readonly T[]): MapKitDiff {
    if (this.#destroyed) return emptyDiff()
    // K-9: raised before anything is reconciled, so a missing `itemLabel`
    // cannot leave the registry and `#entries` disagreeing about what exists.
    this.#assertLabelling(items)

    const diff = emptyDiff()
    const keyFor = this.#options.itemKey
    const descriptors = items.map((item, index) => {
      const key = keyFor(item, index)
      const geometry = this.#options.pinGeometry?.(item) ?? {}
      const geometrySignature = mapKitPinGeometrySignature(geometry)
      const signature = [
        String(item.lat),
        String(item.lng),
        geometrySignature,
        itemToken(item),
      ].join('|')

      return {
        create: () => this.#createAnnotation(key, item, geometry, geometrySignature, diff),
        key,
        signature,
        update: () => {
          this.#updateAnnotation(key, item, geometry, geometrySignature, diff)
        },
      }
    })

    const before = new Set(this.#entries.keys())
    const result = this.#registry.reconcile(descriptors)
    for (const key of before) {
      if (this.#registry.has(key)) continue
      const entry = this.#entries.get(key)
      if (!entry) continue
      entry.cleanup?.()
      this.#entries.delete(key)
      diff.removed.push(key)
    }

    // A key whose selection no longer exists leaves the layer unselected, so a
    // later re-selection of the same id is not swallowed as a no-op.
    if (this.#selectedId !== null && !this.#entries.has(this.#selectedId)) this.#selectedId = null

    // `recreated` means a changed signature reached a key with no update hook.
    // Every descriptor here supplies one, so this is a contract check, not a
    // branch anyone is expected to hit.
    if (result.recreated > 0) {
      throw new Error('MapKitPinLayer: an annotation was recreated instead of updated in place')
    }

    this.#lastDiff = diff
    return diff
  }

  /**
   * Move the selection.
   *
   * Zero adds, zero removes: exactly the outgoing and the incoming glyph are
   * re-rendered inside hosts that are not replaced, so focus survives.
   */
  setSelected(id: string | null): MapKitDiff {
    if (this.#destroyed) return emptyDiff()
    const next = id !== null && this.#entries.has(id) ? id : null
    const diff = emptyDiff()
    if (next === this.#selectedId) {
      this.#lastDiff = diff
      return diff
    }

    const previous = this.#selectedId
    this.#selectedId = next
    if (previous !== null) this.#applySelection(previous, false, diff)
    if (next !== null) this.#applySelection(next, true, diff)
    this.#lastDiff = diff
    return diff
  }

  /** Remove every pin and make the layer inert. Idempotent. */
  destroy(): void {
    if (this.#destroyed) return
    for (const entry of this.#entries.values()) entry.cleanup?.()
    this.#entries.clear()
    this.#registry.destroy()
    this.#destroyed = true
  }

  #applySelection(key: string, selected: boolean, diff: MapKitDiff): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    entry.selected = selected
    this.#renderGlyph(entry)
    diff.restyled.push(key)
  }

  /** Replace the host's single glyph child. The host itself is never replaced. */
  #renderGlyph(entry: MapKitPinEntry<T>): void {
    const create = this.#options.createPinElement
    entry.cleanup?.()
    entry.cleanup = undefined
    entry.host.replaceChildren()
    if (create) {
      const rendered = create(entry.item, entry.selected)
      entry.cleanup = rendered.cleanup
      entry.host.append(rendered.element)
    }
    if (this.#focusable) entry.host.setAttribute('aria-pressed', entry.selected ? 'true' : 'false')
    if (entry.selected) entry.host.setAttribute('data-mapkit-selected', '')
    else entry.host.removeAttribute('data-mapkit-selected')
  }

  /** `false` only when the caller asked for it; every 2.1.0 caller gets `true`. */
  get #focusable(): boolean {
    return this.#options.focusable ?? true
  }

  #assertLabelling(items: readonly T[]): void {
    if (items.length === 0 || !this.#focusable || this.#options.itemLabel) return
    throw new Error(
      '<AppMapKit>: itemLabel is required whenever items is non-empty -- it is the ' +
        'accessible name of the pin, and a pin without one is unreachable by screen reader. ' +
        'Pass itemLabel, or build the layer with focusable: false for pins that are not ' +
        'interactive controls.',
    )
  }

  #buildHost(key: string, item: T): HTMLElement {
    const host = this.#document.createElement('div')
    host.setAttribute('data-map-pin', '')
    host.setAttribute('data-mapkit-pin', key)

    if (!this.#focusable) {
      // K-8: no role, so no `aria-pressed` either -- `aria-pressed` on a
      // roleless element is what axe reports as `aria-allowed-attr`. The label
      // is dropped with the role: `aria-label` on an element with no role names
      // nothing, and assistive technology ignores it.
      return host
    }

    host.setAttribute('role', 'button')
    host.setAttribute('tabindex', '0')
    host.style.cursor = 'pointer'
    // `#assertLabelling` has already refused a focusable layer without one.
    host.setAttribute('aria-label', this.#options.itemLabel?.(item) ?? '')

    const activate = (via: MapKitSelectVia): void => {
      this.#options.onSelect?.(this.#selectedId === key ? null : key, via)
    }
    host.addEventListener('click', (event) => {
      event.stopPropagation()
      activate('pointer')
    })
    host.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
      event.preventDefault()
      event.stopPropagation()
      activate('keyboard')
    })
    return host
  }

  #createAnnotation(
    key: string,
    item: T,
    geometry: MapKitPinGeometry,
    geometrySignature: string,
    diff: MapKitDiff,
  ): MapKitAnnotationLike {
    const { mapkit } = this.#options
    const host = this.#buildHost(key, item)
    const entry: MapKitPinEntry<T> = {
      annotation: undefined as unknown as MapKitAnnotationLike,
      cleanup: undefined,
      geometrySignature,
      host,
      item,
      selected: this.#selectedId === key,
    }
    this.#renderGlyph(entry)

    const offset = mapKitAnchorOffset(geometry)
    const options: MapKitAnnotationOptionsLike = {
      anchorOffset: new DOMPoint(offset.x, offset.y),
      // MapKit's own callout is never used: the `#callout` slot renders the
      // app's Vue tree instead, which is the only way a NuxtLink inside a
      // callout can work at all (buoys#112).
      calloutEnabled: false,
      data: { key },
    }
    if (geometry.size) options.size = { height: geometry.size.height, width: geometry.size.width }
    if (this.#options.clusteringIdentifier !== undefined) {
      options.clusteringIdentifier = this.#options.clusteringIdentifier
    }

    entry.annotation = new mapkit.Annotation(
      new mapkit.Coordinate(item.lat, item.lng),
      () => host,
      options,
    )
    this.#entries.set(key, entry)
    diff.added.push(key)
    return entry.annotation
  }

  #updateAnnotation(
    key: string,
    item: T,
    geometry: MapKitPinGeometry,
    geometrySignature: string,
    diff: MapKitDiff,
  ): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    const { mapkit } = this.#options
    const previous = entry.item
    entry.item = item

    if (previous.lat !== item.lat || previous.lng !== item.lng) {
      entry.annotation.coordinate = new mapkit.Coordinate(item.lat, item.lng)
      diff.moved.push(key)
    }

    if (entry.geometrySignature !== geometrySignature) {
      entry.geometrySignature = geometrySignature
      const offset = mapKitAnchorOffset(geometry)
      entry.annotation.anchorOffset = new DOMPoint(offset.x, offset.y)
      entry.annotation.size = geometry.size
        ? { height: geometry.size.height, width: geometry.size.width }
        : null
      if (!diff.restyled.includes(key)) diff.restyled.push(key)
    }

    // A new item object for the same key means the app's data changed, so the
    // glyph is re-rendered -- in place, inside the same host.
    if (previous !== item) {
      const label = this.#options.itemLabel?.(item)
      if (label !== undefined && this.#focusable) entry.host.setAttribute('aria-label', label)
      this.#renderGlyph(entry)
      if (!diff.restyled.includes(key)) diff.restyled.push(key)
    }
  }
}
