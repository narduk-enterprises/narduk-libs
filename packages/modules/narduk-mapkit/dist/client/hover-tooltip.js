/**
 * A hover tooltip for map markers.
 *
 * MapKit's own annotation `title` shows only in its callout, and a native
 * `title=""` attribute on a marker host is slow, unstyleable and unavailable to
 * touch and keyboard users. This is the small, shared replacement: one element
 * inside the map container, shown after a short delay when a mouse or pen
 * pointer rests on a marker or when a marker takes keyboard focus, and hidden
 * when the pointer leaves, focus leaves, `Escape` is pressed or the map moves.
 *
 * ## Accessibility
 *
 * - WCAG 1.4.13 (content on hover or focus): *dismissible* -- `Escape` hides it
 *   without moving the pointer or focus; *persistent* -- it stays until the
 *   pointer or focus leaves. It is deliberately **not** hoverable
 *   (`pointer-events: none`), because it is text only: anything interactive
 *   belongs in a callout.
 * - It is a `role="tooltip"` element, and the anchor gets `aria-describedby`
 *   while it is visible. It supplements the marker's accessible name; it never
 *   replaces it.
 * - Touch has no hover, so `touch` pointers are ignored by default: a tap
 *   selects the marker (and opens its callout) instead.
 *
 * Framework-free. Position comes from the shared pure callout layout, so it
 * flips below the marker when there is no room above and slides along the edge
 * instead of being cut off by it.
 */
import { layoutMapKitCallout } from './callouts.js';
import { defaultMapKitTimerScheduler } from './timers.js';
export const MAPKIT_TOOLTIP_ATTRIBUTE = 'data-mapkit-tooltip';
let tooltipIdCounter = 0;
export class MapKitHoverTooltip {
    #detachers = new Set();
    #document;
    #element;
    #options;
    #scheduler;
    #anchor = null;
    #destroyed = false;
    #hideTimer;
    #showTimer;
    #visible = false;
    constructor(options) {
        this.#options = options;
        this.#document = options.document ?? globalThis.document;
        this.#scheduler = options.scheduler ?? defaultMapKitTimerScheduler;
        tooltipIdCounter += 1;
        const element = this.#document.createElement('div');
        element.id = `mapkit-tooltip-${String(tooltipIdCounter)}`;
        element.setAttribute('role', 'tooltip');
        element.setAttribute(MAPKIT_TOOLTIP_ATTRIBUTE, '');
        element.hidden = true;
        Object.assign(element.style, {
            left: '0px',
            pointerEvents: 'none',
            position: 'absolute',
            top: '0px',
            visibility: 'hidden',
            zIndex: '13',
        });
        options.container.append(element);
        this.#element = element;
    }
    /** The tooltip element, for styling (`[data-mapkit-tooltip]`). */
    get element() {
        return this.#element;
    }
    get visible() {
        return this.#visible;
    }
    /**
     * Show `content` on `target` while the pointer rests on it or it has focus.
     * Returns the function that detaches those listeners.
     */
    attach(target, content) {
        const types = this.#options.pointerTypes ?? ['mouse', 'pen'];
        const open = () => {
            this.#cancelHide();
            this.#cancelShow();
            this.#showTimer = this.#scheduler.schedule(() => {
                this.#showTimer = undefined;
                const text = content();
                if (text)
                    this.show(target, text);
            }, this.#options.showDelayMs ?? 150);
        };
        const close = () => {
            this.#cancelShow();
            this.#hideTimer = this.#scheduler.schedule(() => {
                this.#hideTimer = undefined;
                if (this.#anchor === target || this.#anchor === null)
                    this.hide();
            }, this.#options.hideDelayMs ?? 0);
        };
        const onPointerEnter = (event) => {
            const type = event.pointerType;
            if (type && !types.includes(type))
                return;
            open();
        };
        const listeners = [
            ['pointerenter', onPointerEnter],
            ['pointerleave', close],
            ['focus', open],
            ['blur', close],
            ['pointerdown', () => this.hide()],
        ];
        for (const [name, listener] of listeners)
            target.addEventListener(name, listener);
        const detach = () => {
            for (const [name, listener] of listeners)
                target.removeEventListener(name, listener);
            this.#detachers.delete(detach);
            if (this.#anchor === target)
                this.hide();
        };
        this.#detachers.add(detach);
        return detach;
    }
    /** Show `text` on `target` now, with no delay. */
    show(target, text) {
        if (this.#destroyed || !text)
            return;
        this.#cancelHide();
        this.#cancelShow();
        if (this.#anchor && this.#anchor !== target)
            this.#anchor.removeAttribute('aria-describedby');
        this.#anchor = target;
        this.#element.textContent = text;
        this.#element.hidden = false;
        target.setAttribute('aria-describedby', this.#element.id);
        this.#visible = true;
        this.#document.addEventListener('keydown', this.#onKeydown);
        this.reposition();
    }
    /** Re-place a visible tooltip against its marker, e.g. after the map moved. */
    reposition() {
        const anchor = this.#anchor;
        if (!this.#visible || !anchor)
            return;
        const container = this.#options.container;
        const box = container.getBoundingClientRect();
        const rect = anchor.getBoundingClientRect();
        const size = { height: this.#element.offsetHeight, width: this.#element.offsetWidth };
        const bounds = { height: container.clientHeight, width: container.clientWidth };
        // Unmeasured (headless DOM): show it at the marker rather than hide it.
        if (bounds.width === 0 || bounds.height === 0 || size.width === 0) {
            this.#element.style.visibility = 'visible';
            return;
        }
        const layout = layoutMapKitCallout({
            anchor: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top },
            bounds,
            caretSize: 0,
            edgePadding: this.#options.edgePadding ?? 4,
            flip: true,
            gap: this.#options.gap ?? 8,
            placement: 'above',
            size,
        });
        this.#element.style.left = `${String(layout.x)}px`;
        this.#element.style.top = `${String(layout.y)}px`;
        this.#element.setAttribute('data-mapkit-tooltip-placement', layout.placement);
        this.#element.style.visibility = 'visible';
    }
    hide() {
        this.#cancelShow();
        this.#cancelHide();
        if (!this.#visible)
            return;
        this.#visible = false;
        this.#element.hidden = true;
        this.#element.style.visibility = 'hidden';
        this.#anchor?.removeAttribute('aria-describedby');
        this.#anchor = null;
        this.#document.removeEventListener('keydown', this.#onKeydown);
    }
    destroy() {
        if (this.#destroyed)
            return;
        for (const detach of [...this.#detachers])
            detach();
        this.hide();
        this.#element.remove();
        this.#destroyed = true;
    }
    #onKeydown = (event) => {
        if (event.key === 'Escape')
            this.hide();
    };
    #cancelShow() {
        if (this.#showTimer === undefined)
            return;
        this.#scheduler.cancel(this.#showTimer);
        this.#showTimer = undefined;
    }
    #cancelHide() {
        if (this.#hideTimer === undefined)
            return;
        this.#scheduler.cancel(this.#hideTimer);
        this.#hideTimer = undefined;
    }
}
export function createMapKitHoverTooltip(options) {
    return new MapKitHoverTooltip(options);
}
//# sourceMappingURL=hover-tooltip.js.map