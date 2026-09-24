/**
 * A line from an annotation's screen point to an anchor element.
 *
 * Follows the point on every `refresh()` (the host calls that on region
 * change and after the selected item moves), draws in an SVG overlay, and
 * reports when the point is off the map frame. `<AppMapKit>` wires this from
 * its `leader` prop; a consumer that draws its own pins on `./client` calls
 * the same class (narduk-libs#517).
 */

export const MAPKIT_LEADER_ATTRIBUTE = 'data-mapkit-leader'
export const MAPKIT_LEADER_LINE_ATTRIBUTE = 'data-mapkit-leader-line'
export const MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE = 'data-mapkit-leader-offscreen'

export interface MapKitLeaderPoint {
  x: number
  y: number
}

export interface MapKitLeaderOverlayOptions {
  /** The positioned map host the SVG is appended to. */
  container: HTMLElement
  /** Injected so a Node test can supply a document. */
  document?: Document
  /** The card notch, caret or other element the line ends at. */
  getAnchor: () => HTMLElement | null
  /**
   * The annotation's current position in the container's CSS pixels, or
   * `null` when there is no selection or it cannot be projected.
   */
  getPoint: () => MapKitLeaderPoint | null
  /** Fires when the point's on-screen state changes, including the first paint. */
  onOffscreen?: (offscreen: boolean) => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function inFrame(container: HTMLElement, point: MapKitLeaderPoint): boolean {
  const width = container.clientWidth
  const height = container.clientHeight
  return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height
}

export class MapKitLeaderOverlay {
  readonly #container: HTMLElement
  readonly #document: Document
  readonly #line: SVGLineElement
  readonly #options: MapKitLeaderOverlayOptions
  readonly #svg: SVGSVGElement
  #destroyed = false
  #offscreen = false
  #offscreenKnown = false

  constructor(options: MapKitLeaderOverlayOptions) {
    this.#options = options
    this.#container = options.container
    this.#document = options.document ?? this.#container.ownerDocument ?? globalThis.document
    this.#svg = this.#document.createElementNS(SVG_NS, 'svg')
    this.#svg.setAttribute(MAPKIT_LEADER_ATTRIBUTE, '')
    this.#svg.setAttribute('aria-hidden', 'true')
    this.#svg.setAttribute('class', 'mapkit-leader')
    this.#line = this.#document.createElementNS(SVG_NS, 'line')
    this.#line.setAttribute(MAPKIT_LEADER_LINE_ATTRIBUTE, '')
    this.#line.setAttribute('class', 'mapkit-leader-line')
    this.#line.setAttribute('fill', 'none')
    this.#line.setAttribute('stroke', 'currentColor')
    this.#line.setAttribute('stroke-width', '1.5')
    this.#svg.append(this.#line)
    this.#container.append(this.#svg)
    this.refresh()
  }

  get offscreen(): boolean {
    return this.#offscreen
  }

  /** Re-read the point and the anchor. Call on region change and after items move. */
  refresh(): void {
    if (this.#destroyed) return

    const width = this.#container.clientWidth
    const height = this.#container.clientHeight
    this.#svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`)
    this.#svg.setAttribute('width', String(width))
    this.#svg.setAttribute('height', String(height))

    const point = this.#options.getPoint()
    if (!point) {
      this.#hide(false)
      this.#report(false)
      return
    }

    const offscreen = !inFrame(this.#container, point)
    this.#report(offscreen)
    const anchor = this.#options.getAnchor()
    if (offscreen || !anchor) {
      this.#hide(offscreen)
      return
    }

    const containerBox = this.#container.getBoundingClientRect()
    const anchorBox = anchor.getBoundingClientRect()
    this.#line.setAttribute('x1', String(point.x))
    this.#line.setAttribute('y1', String(point.y))
    this.#line.setAttribute('x2', String(anchorBox.left + anchorBox.width / 2 - containerBox.left))
    this.#line.setAttribute('y2', String(anchorBox.top + anchorBox.height / 2 - containerBox.top))
    this.#line.removeAttribute('hidden')
    this.#svg.removeAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#svg.remove()
  }

  /**
   * Hide the line. `offscreen` is only the pin-left-the-frame case; a missing
   * point or anchor hides the line without claiming the pin is off-screen.
   */
  #hide(offscreen: boolean): void {
    this.#line.setAttribute('hidden', '')
    if (offscreen) this.#svg.setAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE, '')
    else this.#svg.removeAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE)
  }

  #report(offscreen: boolean): void {
    if (this.#offscreenKnown && this.#offscreen === offscreen) return
    this.#offscreenKnown = true
    this.#offscreen = offscreen
    this.#options.onOffscreen?.(offscreen)
  }
}
