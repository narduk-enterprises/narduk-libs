import { defaultMapKitTimerScheduler } from './timers.js'

import type { MapKitTimerHandle, MapKitTimerScheduler } from './timers.js'
import type { MapKitPoint } from '../types.js'

const DEFAULT_HOVER_THROTTLE_MS = 90
const DEFAULT_LONG_PRESS_DURATION_MS = 500
const DEFAULT_TAP_MAX_DURATION_MS = 500
const DEFAULT_MOVE_SLOP_PX = 8
const DEFAULT_HOVER_POINTER_TYPES: readonly MapKitProbePointerType[] = ['mouse', 'pen']
const DEFAULT_LONG_PRESS_POINTER_TYPES: readonly MapKitProbePointerType[] = ['touch', 'pen']

/** A 2D point in CSS pixels. */
export interface MapKitProbePoint {
  x: number
  y: number
}

export type MapKitProbePointerType = 'mouse' | 'pen' | 'touch' | 'unknown'

/** Hover readouts follow the pointer; a pin is sticky until dismissed. */
export type MapKitProbeMode = 'hover' | 'pinned'

/**
 * - `begin`: hover started, or a pin was placed.
 * - `move`: throttled hover sample, or a throttled pin-drag sample.
 * - `end`: hover ended, or a pin drag was released.
 * - `cancel`: the gesture became a pan/pinch, or a pin could not be placed.
 * - `dismiss`: the pin was removed.
 */
export type MapKitProbePhase = 'begin' | 'move' | 'end' | 'cancel' | 'dismiss'

/** What produced the event. `pan` marks a gesture reclassified as a map pan. */
export type MapKitProbeSource =
  'hover' | 'click' | 'tap' | 'long-press' | 'drag' | 'pan' | 'programmatic'

/** One normalized pointer reading, in three coordinate spaces. */
export interface MapKitProbePointerSample {
  /** Viewport-relative (`clientX`/`clientY`). */
  readonly client: MapKitProbePoint
  /** Document-relative (`pageX`/`pageY`, falling back to client). */
  readonly page: MapKitProbePoint
  /** Element-relative; the origin is the probe element's top-left corner. */
  readonly point: MapKitProbePoint
  readonly pointerId: number
  readonly pointerType: MapKitProbePointerType
}

/** The single event shape a probe consumer renders from. */
export interface MapKitProbeEvent<TCoordinate = MapKitPoint> {
  /** `null` when the point was refused, or when nothing is being read. */
  readonly coordinate: TCoordinate | null
  readonly mode: MapKitProbeMode
  readonly phase: MapKitProbePhase
  /** Element-relative point; the same value as `pointer.point`. */
  readonly point: MapKitProbePoint
  readonly pointer: MapKitProbePointerSample
  readonly source: MapKitProbeSource
}

export type MapKitProbeListener<TCoordinate = MapKitPoint> = (
  event: MapKitProbeEvent<TCoordinate>,
) => void

/**
 * The structural subset of a `PointerEvent` the recognizer reads.
 *
 * Declared structurally so the state machine can be exercised in Node with
 * plain objects — no jsdom, no MapKit JS, no pointer hardware.
 */
export interface MapKitProbePointerEventLike {
  readonly button?: number
  readonly buttons?: number
  readonly clientX: number
  readonly clientY: number
  readonly isPrimary?: boolean
  readonly pageX?: number
  readonly pageY?: number
  readonly pointerId?: number
  readonly pointerType?: string
  readonly target?: unknown
}

/**
 * The structural subset of an `HTMLElement` the probe attaches to. A real
 * `HTMLElement` satisfies it, and so does a plain test double.
 *
 * The listener parameter is `any` deliberately (narduk-libs#138, working as
 * intended): `lib.dom`'s `addEventListener` takes
 * `EventListenerOrEventListenerObject`, and only `any` stays assignable in
 * both directions so that passing a real element still typechecks.
 */
export interface MapKitProbeElement {
  addEventListener: (type: string, listener: (event: any) => void, options?: any) => void
  getBoundingClientRect?: () => { left: number; top: number }
  releasePointerCapture?: (pointerId: number) => void
  removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void
  setPointerCapture?: (pointerId: number) => void
}

export interface MapKitPointerProbeOptions<TCoordinate = MapKitPoint> {
  /**
   * Convert a pointer sample to a map coordinate. Injected by the consumer, so
   * the core never imports MapKit JS. Return `null` to refuse the point (off
   * the map, over chrome, over land); a refused point never places a pin.
   *
   * With MapKit JS this is usually
   * `(sample) => map.convertPointOnPageToCoordinate(new DOMPoint(sample.page.x, sample.page.y))`.
   */
  coordinateForPoint: (sample: MapKitProbePointerSample) => TCoordinate | null
  element: MapKitProbeElement
  /** Start attached but inert when `false`. Default `true`. */
  enabled?: boolean
  /** Pointer types that produce hover readouts. Default `['mouse', 'pen']`. */
  hoverPointerTypes?: readonly MapKitProbePointerType[]
  /** Minimum milliseconds between hover and pin-drag samples. Default `90`. */
  hoverThrottleMs?: number
  /**
   * Recognize a pointerdown as the start of a pin drag, typically by testing
   * whether the event target is inside the app's pin element. Pin markup is
   * app-owned, so the core cannot hit-test it.
   */
  isPinHandle?: (target: unknown) => boolean
  /** Hold duration that places a pin. Default `500`. */
  longPressDurationMs?: number
  /** Pointer types eligible for long-press. Default `['touch', 'pen']`. */
  longPressPointerTypes?: readonly MapKitProbePointerType[]
  /** Movement past this radius reclassifies a press as a pan. Default `8`. */
  moveSlopPx?: number
  onEvent: MapKitProbeListener<TCoordinate>
  /** Suppress hover readouts while a pin is placed. Default `true`. */
  suppressHoverWhilePinned?: boolean
  /** Longest press still treated as a tap/click. Default `500`. */
  tapMaxDurationMs?: number
  /** Injectable clock/timers. Default: `globalThis` timers and `Date.now()`. */
  timer?: MapKitTimerScheduler
}

/** The placed pin, in both screen and map space. */
export interface MapKitProbePin<TCoordinate = MapKitPoint> {
  readonly coordinate: TCoordinate
  readonly point: MapKitProbePoint
}

type GestureKind = 'candidate' | 'pan' | 'pin-drag'

interface Gesture {
  kind: GestureKind
  longPressFired: boolean
  longPressHandle: MapKitTimerHandle | null
  moved: boolean
  pointerId: number
  pointerType: MapKitProbePointerType
  start: MapKitProbePointerSample
  startedAt: number
}

function normalizePointerType(pointerType: string | undefined): MapKitProbePointerType {
  if (pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch') {
    return pointerType
  }
  return pointerType === undefined ? 'mouse' : 'unknown'
}

function distance(from: MapKitProbePoint, to: MapKitProbePoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * Unified pointer plumbing for map probing.
 *
 * One recognizer covers desktop hover (throttled), click-to-pin, touch
 * tap-to-pin, long-press-to-pin, pin-drag repositioning, and dismissal, and
 * separates every one of those from a map pan by movement slop and press
 * duration. It knows nothing about MapKit, about the DOM beyond
 * `addEventListener`, or about what a readout looks like.
 *
 * The element should set `touch-action: none` so the browser does not consume
 * the gesture as a scroll before the recognizer sees it.
 *
 * @example
 * ```ts
 * const probe = attachMapKitPointerProbe({
 *   element: mapElement,
 *   coordinateForPoint: (sample) =>
 *     map.convertPointOnPageToCoordinate(new DOMPoint(sample.page.x, sample.page.y)),
 *   isPinHandle: (target) => target instanceof Element && target.closest('.probe-pin') !== null,
 *   onEvent: (event) => {
 *     if (event.phase === 'dismiss') return clearReadout()
 *     if (event.coordinate) renderReadout(event.mode, event.coordinate)
 *   },
 * })
 * ```
 */
export class MapKitPointerProbe<TCoordinate = MapKitPoint> {
  readonly #activePointers = new Set<number>()
  readonly #coordinateForPoint: (sample: MapKitProbePointerSample) => TCoordinate | null
  readonly #element: MapKitProbeElement
  readonly #hoverPointerTypes: ReadonlySet<MapKitProbePointerType>
  readonly #hoverThrottleMs: number
  readonly #isPinHandle: ((target: unknown) => boolean) | undefined
  readonly #listeners = new Set<MapKitProbeListener<TCoordinate>>()
  readonly #longPressDurationMs: number
  readonly #longPressPointerTypes: ReadonlySet<MapKitProbePointerType>
  readonly #moveSlopPx: number
  readonly #suppressHoverWhilePinned: boolean
  readonly #tapMaxDurationMs: number
  readonly #timer: MapKitTimerScheduler

  #destroyed = false
  #enabled: boolean
  #gesture: Gesture | null = null
  #hoverSample: MapKitProbePointerSample | null = null
  #hovering = false
  #pin: MapKitProbePin<TCoordinate> | null = null
  #pinSample: MapKitProbePointerSample | null = null
  #throttleHandle: MapKitTimerHandle | null = null
  #throttleLastAt = Number.NEGATIVE_INFINITY
  #throttlePending: (() => void) | null = null

  readonly #onPointerCancel = (event: MapKitProbePointerEventLike): void => {
    this.#activePointers.delete(event.pointerId ?? 0)
    this.#cancelGesture('pan')
  }

  readonly #onPointerDown = (event: MapKitProbePointerEventLike): void => {
    if (!this.#enabled) return
    if ((event.button ?? 0) > 0) return

    const sample = this.#sample(event)
    this.#activePointers.add(sample.pointerId)
    // A second concurrent pointer is a pinch or a two-finger pan, never a probe.
    if (this.#activePointers.size > 1) {
      this.#cancelGesture('pan')
      return
    }

    this.#endHover(true)
    const dragging = this.#pin !== null && Boolean(this.#isPinHandle?.(event.target))
    const gesture = this.#startGesture(sample, dragging ? 'pin-drag' : 'candidate')
    if (dragging || !this.#longPressPointerTypes.has(sample.pointerType)) return

    gesture.longPressHandle = this.#timer.schedule(() => {
      gesture.longPressHandle = null
      if (this.#gesture !== gesture || gesture.kind !== 'candidate') return
      gesture.longPressFired = true
      // Keep the gesture alive as a drag so press-and-slide positions the pin
      // it just placed.
      gesture.kind = 'pin-drag'
      this.#placePin(gesture.start, 'long-press')
    }, this.#longPressDurationMs)
  }

  readonly #onPointerLeave = (event: MapKitProbePointerEventLike): void => {
    this.#activePointers.delete(event.pointerId ?? 0)
    if (this.#gesture) return
    this.#endHover(false)
  }

  readonly #onPointerMove = (event: MapKitProbePointerEventLike): void => {
    if (!this.#enabled) return
    const sample = this.#sample(event)
    const gesture = this.#gesture

    if (!gesture) {
      this.#hover(sample)
      return
    }
    if (gesture.pointerId !== sample.pointerId) return
    if (gesture.kind === 'pan') return
    if (distance(gesture.start.point, sample.point) <= this.#moveSlopPx) return

    gesture.moved = true
    if (gesture.kind === 'candidate') {
      // Past the slop radius the user is panning the map, so the pending
      // long-press must not fire and no tap may be recognized on release.
      gesture.kind = 'pan'
      this.#clearLongPress(gesture)
      this.#emit(sample, this.#mode(), 'cancel', 'pan', null)
      return
    }

    this.#throttle(() => {
      this.#emit(sample, 'pinned', 'move', 'drag', this.#setPin(sample))
    })
  }

  readonly #onPointerUp = (event: MapKitProbePointerEventLike): void => {
    const sample = this.#sample(event)
    this.#activePointers.delete(sample.pointerId)
    const gesture = this.#gesture
    if (!gesture || gesture.pointerId !== sample.pointerId) return

    this.#gesture = null
    this.#clearLongPress(gesture)
    this.#element.releasePointerCapture?.(sample.pointerId)

    if (gesture.kind === 'pan') return

    if (gesture.kind === 'pin-drag') {
      this.#clearThrottle()
      if (gesture.moved) {
        this.#emit(sample, 'pinned', 'end', 'drag', this.#setPin(sample))
        return
      }
      const settled = this.#pinSample ?? sample
      const source: MapKitProbeSource = gesture.longPressFired ? 'long-press' : 'drag'
      this.#emit(settled, 'pinned', 'end', source, this.#pin?.coordinate ?? null)
      return
    }

    // Both thresholds are re-checked here: a fling can deliver `pointerup` far
    // from `pointerdown` without an intervening `pointermove`.
    if (distance(gesture.start.point, sample.point) > this.#moveSlopPx) return
    if (this.#timer.now() - gesture.startedAt > this.#tapMaxDurationMs) return
    this.#placePin(sample, sample.pointerType === 'mouse' ? 'click' : 'tap')
  }

  constructor(options: MapKitPointerProbeOptions<TCoordinate>) {
    this.#coordinateForPoint = options.coordinateForPoint
    this.#element = options.element
    this.#hoverPointerTypes = new Set(options.hoverPointerTypes ?? DEFAULT_HOVER_POINTER_TYPES)
    this.#hoverThrottleMs = Math.max(0, options.hoverThrottleMs ?? DEFAULT_HOVER_THROTTLE_MS)
    this.#isPinHandle = options.isPinHandle
    this.#longPressDurationMs = Math.max(
      0,
      options.longPressDurationMs ?? DEFAULT_LONG_PRESS_DURATION_MS,
    )
    this.#longPressPointerTypes = new Set(
      options.longPressPointerTypes ?? DEFAULT_LONG_PRESS_POINTER_TYPES,
    )
    this.#moveSlopPx = Math.max(0, options.moveSlopPx ?? DEFAULT_MOVE_SLOP_PX)
    this.#suppressHoverWhilePinned = options.suppressHoverWhilePinned ?? true
    this.#tapMaxDurationMs = Math.max(0, options.tapMaxDurationMs ?? DEFAULT_TAP_MAX_DURATION_MS)
    this.#timer = options.timer ?? defaultMapKitTimerScheduler
    this.#enabled = options.enabled ?? true
    this.#listeners.add(options.onEvent)

    this.#element.addEventListener('pointerdown', this.#onPointerDown)
    this.#element.addEventListener('pointermove', this.#onPointerMove)
    this.#element.addEventListener('pointerup', this.#onPointerUp)
    this.#element.addEventListener('pointercancel', this.#onPointerCancel)
    this.#element.addEventListener('pointerleave', this.#onPointerLeave)
  }

  get destroyed(): boolean {
    return this.#destroyed
  }

  get enabled(): boolean {
    return this.#enabled
  }

  get hovering(): boolean {
    return this.#hovering
  }

  get mode(): MapKitProbeMode {
    return this.#mode()
  }

  get pin(): MapKitProbePin<TCoordinate> | null {
    return this.#pin
  }

  subscribe(listener: MapKitProbeListener<TCoordinate>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Turn probing on or off without detaching. Disabling ends hover and gestures. */
  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return
    this.#enabled = enabled
    if (enabled) return
    this.#cancelGesture('programmatic')
    this.#endHover(false)
  }

  /** Place a pin at an element-relative point, as a tap would. */
  pinAtPoint(point: MapKitProbePoint, source: MapKitProbeSource = 'programmatic'): void {
    this.#placePin(this.#sampleFromPoint(point), source)
  }

  /**
   * Start a pin drag from the app's own pin element, for consumers that prefer
   * wiring the pin's `pointerdown` over supplying `isPinHandle`.
   */
  beginPinDrag(event: MapKitProbePointerEventLike): void {
    if (!this.#enabled || this.#pin === null) return
    const sample = this.#sample(event)
    this.#activePointers.add(sample.pointerId)
    this.#endHover(true)
    this.#startGesture(sample, 'pin-drag')
  }

  /** Remove the pin and return to hover mode. No-op when nothing is pinned. */
  dismiss(): void {
    const pin = this.#pin
    const sample = this.#pinSample
    if (!pin || !sample) return
    this.#pin = null
    this.#pinSample = null
    this.#emit(sample, 'pinned', 'dismiss', 'programmatic', pin.coordinate)
  }

  /** Detach every listener and cancel pending timers. */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#clearThrottle()
    if (this.#gesture) this.#clearLongPress(this.#gesture)
    this.#gesture = null
    this.#element.removeEventListener('pointerdown', this.#onPointerDown)
    this.#element.removeEventListener('pointermove', this.#onPointerMove)
    this.#element.removeEventListener('pointerup', this.#onPointerUp)
    this.#element.removeEventListener('pointercancel', this.#onPointerCancel)
    this.#element.removeEventListener('pointerleave', this.#onPointerLeave)
    this.#listeners.clear()
  }

  #startGesture(sample: MapKitProbePointerSample, kind: GestureKind): Gesture {
    const gesture: Gesture = {
      kind,
      longPressFired: false,
      longPressHandle: null,
      moved: false,
      pointerId: sample.pointerId,
      pointerType: sample.pointerType,
      start: sample,
      startedAt: this.#timer.now(),
    }
    this.#gesture = gesture
    this.#element.setPointerCapture?.(sample.pointerId)
    return gesture
  }

  #mode(): MapKitProbeMode {
    return this.#pin ? 'pinned' : 'hover'
  }

  #sample(event: MapKitProbePointerEventLike): MapKitProbePointerSample {
    const rect = this.#element.getBoundingClientRect?.()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return {
      client: { x: event.clientX, y: event.clientY },
      page: { x: event.pageX ?? event.clientX, y: event.pageY ?? event.clientY },
      point: { x: event.clientX - left, y: event.clientY - top },
      pointerId: event.pointerId ?? 0,
      pointerType: normalizePointerType(event.pointerType),
    }
  }

  #sampleFromPoint(point: MapKitProbePoint): MapKitProbePointerSample {
    const rect = this.#element.getBoundingClientRect?.()
    const client = { x: point.x + (rect?.left ?? 0), y: point.y + (rect?.top ?? 0) }
    return {
      client,
      page: client,
      point,
      pointerId: -1,
      pointerType: 'unknown',
    }
  }

  #hover(sample: MapKitProbePointerSample): void {
    if (!this.#hoverPointerTypes.has(sample.pointerType)) return
    if (this.#pin && this.#suppressHoverWhilePinned) return

    this.#hoverSample = sample
    if (!this.#hovering) {
      this.#hovering = true
      this.#clearThrottle()
      this.#throttleLastAt = this.#timer.now()
      this.#emit(sample, 'hover', 'begin', 'hover', this.#coordinateForPoint(sample))
      return
    }
    this.#throttle(() => {
      this.#emit(sample, 'hover', 'move', 'hover', this.#coordinateForPoint(sample))
    })
  }

  #endHover(silent: boolean): void {
    this.#clearThrottle()
    if (!this.#hovering) return
    this.#hovering = false
    const sample = this.#hoverSample
    this.#hoverSample = null
    if (silent || !sample) return
    this.#emit(sample, 'hover', 'end', 'hover', null)
  }

  /** Leading-edge emit with a trailing emit, so the last sample is never lost. */
  #throttle(emit: () => void): void {
    const now = this.#timer.now()
    const elapsed = now - this.#throttleLastAt
    if (elapsed >= this.#hoverThrottleMs) {
      this.#clearThrottle()
      this.#throttleLastAt = now
      emit()
      return
    }

    this.#throttlePending = emit
    if (this.#throttleHandle !== null) return
    this.#throttleHandle = this.#timer.schedule(() => {
      this.#throttleHandle = null
      const pending = this.#throttlePending
      this.#throttlePending = null
      if (!pending) return
      this.#throttleLastAt = this.#timer.now()
      pending()
    }, this.#hoverThrottleMs - elapsed)
  }

  #clearThrottle(): void {
    if (this.#throttleHandle !== null) this.#timer.cancel(this.#throttleHandle)
    this.#throttleHandle = null
    this.#throttlePending = null
  }

  #clearLongPress(gesture: Gesture): void {
    if (gesture.longPressHandle === null) return
    this.#timer.cancel(gesture.longPressHandle)
    gesture.longPressHandle = null
  }

  #cancelGesture(source: MapKitProbeSource): void {
    const gesture = this.#gesture
    this.#clearThrottle()
    if (!gesture) return
    this.#gesture = null
    this.#clearLongPress(gesture)
    this.#element.releasePointerCapture?.(gesture.pointerId)
    this.#emit(gesture.start, this.#mode(), 'cancel', source, null)
  }

  /** Move the pin to `sample`, keeping the last resolvable coordinate. */
  #setPin(sample: MapKitProbePointerSample): TCoordinate | null {
    const coordinate = this.#coordinateForPoint(sample)
    if (coordinate === null) return this.#pin?.coordinate ?? null
    this.#pin = { coordinate, point: sample.point }
    this.#pinSample = sample
    return coordinate
  }

  #placePin(sample: MapKitProbePointerSample, source: MapKitProbeSource): void {
    const coordinate = this.#coordinateForPoint(sample)
    if (coordinate === null) {
      // A refused point is not a pin; report the attempt so the consumer can
      // explain why nothing happened.
      this.#emit(sample, 'pinned', 'cancel', source, null)
      return
    }
    this.#pin = { coordinate, point: sample.point }
    this.#pinSample = sample
    this.#endHover(true)
    this.#emit(sample, 'pinned', 'begin', source, coordinate)
  }

  #emit(
    sample: MapKitProbePointerSample,
    mode: MapKitProbeMode,
    phase: MapKitProbePhase,
    source: MapKitProbeSource,
    coordinate: TCoordinate | null,
  ): void {
    const event: MapKitProbeEvent<TCoordinate> = {
      coordinate,
      mode,
      phase,
      point: sample.point,
      pointer: sample,
      source,
    }
    for (const listener of [...this.#listeners]) listener(event)
  }
}

/** Attach a {@link MapKitPointerProbe} to an element. */
export function attachMapKitPointerProbe<TCoordinate = MapKitPoint>(
  options: MapKitPointerProbeOptions<TCoordinate>,
): MapKitPointerProbe<TCoordinate> {
  return new MapKitPointerProbe(options)
}
