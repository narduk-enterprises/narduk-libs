import { defaultMapKitTimerScheduler } from './timers.js';
const DEFAULT_HOVER_THROTTLE_MS = 90;
const DEFAULT_LONG_PRESS_DURATION_MS = 500;
const DEFAULT_TAP_MAX_DURATION_MS = 500;
const DEFAULT_MOVE_SLOP_PX = 8;
const DEFAULT_HOVER_POINTER_TYPES = ['mouse', 'pen'];
const DEFAULT_LONG_PRESS_POINTER_TYPES = ['touch', 'pen'];
function normalizePointerType(pointerType) {
    if (pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch') {
        return pointerType;
    }
    return pointerType === undefined ? 'mouse' : 'unknown';
}
function distance(from, to) {
    return Math.hypot(to.x - from.x, to.y - from.y);
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
export class MapKitPointerProbe {
    #activePointers = new Set();
    #coordinateForPoint;
    #element;
    #hoverPointerTypes;
    #hoverThrottleMs;
    #isPinHandle;
    #listeners = new Set();
    #longPressDurationMs;
    #longPressPointerTypes;
    #moveSlopPx;
    #suppressHoverWhilePinned;
    #tapMaxDurationMs;
    #timer;
    #destroyed = false;
    #enabled;
    #gesture = null;
    #hoverSample = null;
    #hovering = false;
    #pin = null;
    #pinSample = null;
    #throttleHandle = null;
    #throttleLastAt = Number.NEGATIVE_INFINITY;
    #throttlePending = null;
    #onPointerCancel = (event) => {
        this.#activePointers.delete(event.pointerId ?? 0);
        this.#cancelGesture('pan');
    };
    #onPointerDown = (event) => {
        if (!this.#enabled)
            return;
        if ((event.button ?? 0) > 0)
            return;
        const sample = this.#sample(event);
        this.#activePointers.add(sample.pointerId);
        // A second concurrent pointer is a pinch or a two-finger pan, never a probe.
        if (this.#activePointers.size > 1) {
            this.#cancelGesture('pan');
            return;
        }
        this.#endHover(true);
        const dragging = this.#pin !== null && Boolean(this.#isPinHandle?.(event.target));
        const gesture = this.#startGesture(sample, dragging ? 'pin-drag' : 'candidate');
        if (dragging || !this.#longPressPointerTypes.has(sample.pointerType))
            return;
        gesture.longPressHandle = this.#timer.schedule(() => {
            gesture.longPressHandle = null;
            if (this.#gesture !== gesture || gesture.kind !== 'candidate')
                return;
            gesture.longPressFired = true;
            // Keep the gesture alive as a drag so press-and-slide positions the pin
            // it just placed.
            gesture.kind = 'pin-drag';
            this.#placePin(gesture.start, 'long-press');
        }, this.#longPressDurationMs);
    };
    #onPointerLeave = (event) => {
        this.#activePointers.delete(event.pointerId ?? 0);
        if (this.#gesture)
            return;
        this.#endHover(false);
    };
    #onPointerMove = (event) => {
        if (!this.#enabled)
            return;
        const sample = this.#sample(event);
        const gesture = this.#gesture;
        if (!gesture) {
            this.#hover(sample);
            return;
        }
        if (gesture.pointerId !== sample.pointerId)
            return;
        if (gesture.kind === 'pan')
            return;
        if (distance(gesture.start.point, sample.point) <= this.#moveSlopPx)
            return;
        gesture.moved = true;
        if (gesture.kind === 'candidate') {
            // Past the slop radius the user is panning the map, so the pending
            // long-press must not fire and no tap may be recognized on release.
            gesture.kind = 'pan';
            this.#clearLongPress(gesture);
            this.#emit(sample, this.#mode(), 'cancel', 'pan', null);
            return;
        }
        this.#throttle(() => {
            this.#emit(sample, 'pinned', 'move', 'drag', this.#setPin(sample));
        });
    };
    #onPointerUp = (event) => {
        const sample = this.#sample(event);
        this.#activePointers.delete(sample.pointerId);
        const gesture = this.#gesture;
        if (!gesture || gesture.pointerId !== sample.pointerId)
            return;
        this.#gesture = null;
        this.#clearLongPress(gesture);
        this.#element.releasePointerCapture?.(sample.pointerId);
        if (gesture.kind === 'pan')
            return;
        if (gesture.kind === 'pin-drag') {
            this.#clearThrottle();
            if (gesture.moved) {
                this.#emit(sample, 'pinned', 'end', 'drag', this.#setPin(sample));
                return;
            }
            const settled = this.#pinSample ?? sample;
            const source = gesture.longPressFired ? 'long-press' : 'drag';
            this.#emit(settled, 'pinned', 'end', source, this.#pin?.coordinate ?? null);
            return;
        }
        // Both thresholds are re-checked here: a fling can deliver `pointerup` far
        // from `pointerdown` without an intervening `pointermove`.
        if (distance(gesture.start.point, sample.point) > this.#moveSlopPx)
            return;
        if (this.#timer.now() - gesture.startedAt > this.#tapMaxDurationMs)
            return;
        this.#placePin(sample, sample.pointerType === 'mouse' ? 'click' : 'tap');
    };
    constructor(options) {
        this.#coordinateForPoint = options.coordinateForPoint;
        this.#element = options.element;
        this.#hoverPointerTypes = new Set(options.hoverPointerTypes ?? DEFAULT_HOVER_POINTER_TYPES);
        this.#hoverThrottleMs = Math.max(0, options.hoverThrottleMs ?? DEFAULT_HOVER_THROTTLE_MS);
        this.#isPinHandle = options.isPinHandle;
        this.#longPressDurationMs = Math.max(0, options.longPressDurationMs ?? DEFAULT_LONG_PRESS_DURATION_MS);
        this.#longPressPointerTypes = new Set(options.longPressPointerTypes ?? DEFAULT_LONG_PRESS_POINTER_TYPES);
        this.#moveSlopPx = Math.max(0, options.moveSlopPx ?? DEFAULT_MOVE_SLOP_PX);
        this.#suppressHoverWhilePinned = options.suppressHoverWhilePinned ?? true;
        this.#tapMaxDurationMs = Math.max(0, options.tapMaxDurationMs ?? DEFAULT_TAP_MAX_DURATION_MS);
        this.#timer = options.timer ?? defaultMapKitTimerScheduler;
        this.#enabled = options.enabled ?? true;
        this.#listeners.add(options.onEvent);
        this.#element.addEventListener('pointerdown', this.#onPointerDown);
        this.#element.addEventListener('pointermove', this.#onPointerMove);
        this.#element.addEventListener('pointerup', this.#onPointerUp);
        this.#element.addEventListener('pointercancel', this.#onPointerCancel);
        this.#element.addEventListener('pointerleave', this.#onPointerLeave);
    }
    get destroyed() {
        return this.#destroyed;
    }
    get enabled() {
        return this.#enabled;
    }
    get hovering() {
        return this.#hovering;
    }
    get mode() {
        return this.#mode();
    }
    get pin() {
        return this.#pin;
    }
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    /** Turn probing on or off without detaching. Disabling ends hover and gestures. */
    setEnabled(enabled) {
        if (this.#enabled === enabled)
            return;
        this.#enabled = enabled;
        if (enabled)
            return;
        this.#cancelGesture('programmatic');
        this.#endHover(false);
    }
    /** Place a pin at an element-relative point, as a tap would. */
    pinAtPoint(point, source = 'programmatic') {
        this.#placePin(this.#sampleFromPoint(point), source);
    }
    /**
     * Start a pin drag from the app's own pin element, for consumers that prefer
     * wiring the pin's `pointerdown` over supplying `isPinHandle`.
     */
    beginPinDrag(event) {
        if (!this.#enabled || this.#pin === null)
            return;
        const sample = this.#sample(event);
        this.#activePointers.add(sample.pointerId);
        this.#endHover(true);
        this.#startGesture(sample, 'pin-drag');
    }
    /** Remove the pin and return to hover mode. No-op when nothing is pinned. */
    dismiss() {
        const pin = this.#pin;
        const sample = this.#pinSample;
        if (!pin || !sample)
            return;
        this.#pin = null;
        this.#pinSample = null;
        this.#emit(sample, 'pinned', 'dismiss', 'programmatic', pin.coordinate);
    }
    /** Detach every listener and cancel pending timers. */
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#clearThrottle();
        if (this.#gesture)
            this.#clearLongPress(this.#gesture);
        this.#gesture = null;
        this.#element.removeEventListener('pointerdown', this.#onPointerDown);
        this.#element.removeEventListener('pointermove', this.#onPointerMove);
        this.#element.removeEventListener('pointerup', this.#onPointerUp);
        this.#element.removeEventListener('pointercancel', this.#onPointerCancel);
        this.#element.removeEventListener('pointerleave', this.#onPointerLeave);
        this.#listeners.clear();
    }
    #startGesture(sample, kind) {
        const gesture = {
            kind,
            longPressFired: false,
            longPressHandle: null,
            moved: false,
            pointerId: sample.pointerId,
            pointerType: sample.pointerType,
            start: sample,
            startedAt: this.#timer.now(),
        };
        this.#gesture = gesture;
        this.#element.setPointerCapture?.(sample.pointerId);
        return gesture;
    }
    #mode() {
        return this.#pin ? 'pinned' : 'hover';
    }
    #sample(event) {
        const rect = this.#element.getBoundingClientRect?.();
        const left = rect?.left ?? 0;
        const top = rect?.top ?? 0;
        return {
            client: { x: event.clientX, y: event.clientY },
            page: { x: event.pageX ?? event.clientX, y: event.pageY ?? event.clientY },
            point: { x: event.clientX - left, y: event.clientY - top },
            pointerId: event.pointerId ?? 0,
            pointerType: normalizePointerType(event.pointerType),
        };
    }
    #sampleFromPoint(point) {
        const rect = this.#element.getBoundingClientRect?.();
        const client = { x: point.x + (rect?.left ?? 0), y: point.y + (rect?.top ?? 0) };
        return {
            client,
            page: client,
            point,
            pointerId: -1,
            pointerType: 'unknown',
        };
    }
    #hover(sample) {
        if (!this.#hoverPointerTypes.has(sample.pointerType))
            return;
        if (this.#pin && this.#suppressHoverWhilePinned)
            return;
        this.#hoverSample = sample;
        if (!this.#hovering) {
            this.#hovering = true;
            this.#clearThrottle();
            this.#throttleLastAt = this.#timer.now();
            this.#emit(sample, 'hover', 'begin', 'hover', this.#coordinateForPoint(sample));
            return;
        }
        this.#throttle(() => {
            this.#emit(sample, 'hover', 'move', 'hover', this.#coordinateForPoint(sample));
        });
    }
    #endHover(silent) {
        this.#clearThrottle();
        if (!this.#hovering)
            return;
        this.#hovering = false;
        const sample = this.#hoverSample;
        this.#hoverSample = null;
        if (silent || !sample)
            return;
        this.#emit(sample, 'hover', 'end', 'hover', null);
    }
    /** Leading-edge emit with a trailing emit, so the last sample is never lost. */
    #throttle(emit) {
        const now = this.#timer.now();
        const elapsed = now - this.#throttleLastAt;
        if (elapsed >= this.#hoverThrottleMs) {
            this.#clearThrottle();
            this.#throttleLastAt = now;
            emit();
            return;
        }
        this.#throttlePending = emit;
        if (this.#throttleHandle !== null)
            return;
        this.#throttleHandle = this.#timer.schedule(() => {
            this.#throttleHandle = null;
            const pending = this.#throttlePending;
            this.#throttlePending = null;
            if (!pending)
                return;
            this.#throttleLastAt = this.#timer.now();
            pending();
        }, this.#hoverThrottleMs - elapsed);
    }
    #clearThrottle() {
        if (this.#throttleHandle !== null)
            this.#timer.cancel(this.#throttleHandle);
        this.#throttleHandle = null;
        this.#throttlePending = null;
    }
    #clearLongPress(gesture) {
        if (gesture.longPressHandle === null)
            return;
        this.#timer.cancel(gesture.longPressHandle);
        gesture.longPressHandle = null;
    }
    #cancelGesture(source) {
        const gesture = this.#gesture;
        this.#clearThrottle();
        if (!gesture)
            return;
        this.#gesture = null;
        this.#clearLongPress(gesture);
        this.#element.releasePointerCapture?.(gesture.pointerId);
        this.#emit(gesture.start, this.#mode(), 'cancel', source, null);
    }
    /** Move the pin to `sample`, keeping the last resolvable coordinate. */
    #setPin(sample) {
        const coordinate = this.#coordinateForPoint(sample);
        if (coordinate === null)
            return this.#pin?.coordinate ?? null;
        this.#pin = { coordinate, point: sample.point };
        this.#pinSample = sample;
        return coordinate;
    }
    #placePin(sample, source) {
        const coordinate = this.#coordinateForPoint(sample);
        if (coordinate === null) {
            // A refused point is not a pin; report the attempt so the consumer can
            // explain why nothing happened.
            this.#emit(sample, 'pinned', 'cancel', source, null);
            return;
        }
        this.#pin = { coordinate, point: sample.point };
        this.#pinSample = sample;
        this.#endHover(true);
        this.#emit(sample, 'pinned', 'begin', source, coordinate);
    }
    #emit(sample, mode, phase, source, coordinate) {
        const event = {
            coordinate,
            mode,
            phase,
            point: sample.point,
            pointer: sample,
            source,
        };
        for (const listener of [...this.#listeners])
            listener(event);
    }
}
/** Attach a {@link MapKitPointerProbe} to an element. */
export function attachMapKitPointerProbe(options) {
    return new MapKitPointerProbe(options);
}
//# sourceMappingURL=probe.js.map