/**
 * The `#callout` seam (spec §c.4): a positioned host inside the map container
 * that an application fills with its own Vue tree.
 *
 * ## Why the library positions a host instead of rendering a callout
 *
 * MapKit's own callout takes an `HTMLElement`. Buoys' callout is a
 * `StationMapPopover` containing a `NuxtLink` -- a Vue component with a router
 * dependency -- so handing MapKit a detached, imperatively built element loses
 * the application's entire render tree. The library therefore owns only
 * *placement*: it creates and positions the host, and `<AppMapKit>` teleports
 * the slot's content into it. That is why `calloutEnabled` is `false` on every
 * annotation the pin layer builds.
 *
 * This is a **callout** seam: one host, scoped to the opened item. It is not the
 * general overlay-host seam, which stays a 2.2 candidate on its own evidence.
 *
 * ## Projection
 *
 * `projectCoordinate` is injected rather than read off the map, for two reasons:
 * the deterministic fake at `./testing` deliberately does not model
 * `convertCoordinateToPointOnPage` (reading it throws rather than answering
 * `undefined`), and injecting it is what lets a plain-TypeScript test assert
 * that a `region-change` actually re-projects every open callout.
 */

export type MapKitCalloutPlacement = 'above' | 'below'

export interface MapKitCalloutPoint {
  x: number
  y: number
}

export interface MapKitCalloutEntry<T> {
  host: HTMLElement
  id: string
  item: T
  placement: MapKitCalloutPlacement
  position: MapKitCalloutPoint
}

export interface MapKitCalloutOpenRequest<T> {
  /** CSS px added to the projected point, normally the pin's own anchor. */
  anchorOffset?: MapKitCalloutPoint
  coordinate: { lat: number; lng: number }
  id: string
  item: T
}

export interface MapKitCalloutHostOptions<T> {
  container: HTMLElement
  document?: Document
  /** Fires after every open, close and reposition, with the live entry list. */
  onChange?: (entries: ReadonlyArray<MapKitCalloutEntry<T>>) => void
  /** Preferred side. Flips when the callout would leave the container. */
  placement?: MapKitCalloutPlacement
  /**
   * Container-relative point for a coordinate, or `null` when it cannot be
   * projected. The open callout's id comes along so a caller whose map cannot
   * project (see the class comment) can fall back to the pin's own position.
   */
  projectCoordinate: (
    coordinate: { lat: number; lng: number },
    id: string,
  ) => MapKitCalloutPoint | null
}

interface MapKitCalloutRecord<T> extends MapKitCalloutEntry<T> {
  anchorOffset: MapKitCalloutPoint
  coordinate: { lat: number; lng: number }
}

export class MapKitCalloutHostLayer<T> {
  readonly #document: Document
  readonly #options: MapKitCalloutHostOptions<T>
  readonly #records = new Map<string, MapKitCalloutRecord<T>>()
  #destroyed = false

  constructor(options: MapKitCalloutHostOptions<T>) {
    this.#options = options
    this.#document = options.document ?? globalThis.document
  }

  get openIds(): readonly string[] {
    return [...this.#records.keys()]
  }

  entries(): ReadonlyArray<MapKitCalloutEntry<T>> {
    return [...this.#records.values()]
  }

  /**
   * Open, or re-open with fresh data.
   *
   * Re-opening the same id keeps the same host element, so the teleported Vue
   * subtree is updated rather than torn down and rebuilt.
   */
  open(request: MapKitCalloutOpenRequest<T>): MapKitCalloutEntry<T> | null {
    if (this.#destroyed) return null
    const existing = this.#records.get(request.id)
    const host = existing?.host ?? this.#createHost(request.id)
    const record: MapKitCalloutRecord<T> = {
      anchorOffset: request.anchorOffset ?? { x: 0, y: 0 },
      coordinate: request.coordinate,
      host,
      id: request.id,
      item: request.item,
      placement: this.#options.placement ?? 'above',
      position: existing?.position ?? { x: 0, y: 0 },
    }
    this.#records.set(request.id, record)
    this.#place(record)
    this.#emit()
    return record
  }

  close(id: string): boolean {
    const record = this.#records.get(id)
    if (!record) return false
    this.#records.delete(id)
    record.host.remove()
    this.#emit()
    return true
  }

  closeAll(): void {
    if (this.#records.size === 0) return
    for (const record of this.#records.values()) record.host.remove()
    this.#records.clear()
    this.#emit()
  }

  /** Re-project every open callout. Called on every `region-change`. */
  reposition(): void {
    if (this.#destroyed || this.#records.size === 0) return
    for (const record of this.#records.values()) this.#place(record)
    this.#emit()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.closeAll()
    this.#destroyed = true
  }

  #createHost(id: string): HTMLElement {
    const host = this.#document.createElement('div')
    host.setAttribute('data-mapkit-callout', id)
    host.style.position = 'absolute'
    host.style.zIndex = '12'
    this.#options.container.append(host)
    return host
  }

  #place(record: MapKitCalloutRecord<T>): void {
    const projected = this.#options.projectCoordinate(record.coordinate, record.id)
    if (!projected) {
      // Off-projection is not a reason to strand a stale position on screen.
      record.host.hidden = true
      return
    }
    record.host.hidden = false
    const x = projected.x + record.anchorOffset.x
    const y = projected.y + record.anchorOffset.y
    const preferred = this.#options.placement ?? 'above'
    // `offsetHeight` is 0 in a headless DOM, which simply means the preferred
    // placement stands -- the flip is a browser affordance, not a contract.
    const height = record.host.offsetHeight
    record.placement = preferred === 'above' && y - height < 0 ? 'below' : preferred
    record.position = { x, y }
    record.host.style.left = `${String(x)}px`
    record.host.style.top = `${String(y)}px`
    record.host.setAttribute('data-mapkit-callout-placement', record.placement)
    record.host.style.transform =
      record.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
  }

  #emit(): void {
    this.#options.onChange?.(this.entries())
  }
}
