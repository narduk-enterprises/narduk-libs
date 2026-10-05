/**
 * A quiet name for the area under a desktop pointer.
 *
 * Hover over Ohio and "OH" shows, faint and large, near the middle of the
 * state; leave and it fades. One element, positioned from the same view the
 * label layer and the dot layer use, and told nothing about what an area is:
 * the caller hit-tests, picks the text and the anchor, and styles the
 * element. It takes no pointer events and is hidden from assistive
 * technology: the name is a courtesy, not the only way to learn it.
 *
 * Where the anchor lies off the screen (zoomed in on a corner of a large
 * state, say) the text sits beside the pointer instead, so a hover is never
 * answered by nothing.
 */
import { projectToWorldFraction, requirePointLayerView, worldFractionDelta } from './point-layer.js';
/** Where the text sits relative to a pointer when the anchor is off the screen. */
const POINTER_OFFSET = { x: 0, y: -28 };
export function createAreaHoverLabel(options) {
    const { container, insetPx = 48 } = options;
    const reduced = options.reducedMotion ??
        (typeof matchMedia === 'function'
            ? matchMedia('(prefers-reduced-motion: reduce)').matches
            : false);
    const fadeMs = reduced ? 0 : (options.fadeMs ?? 140);
    const created = options.createElement?.() ??
        (container.ownerDocument ?? globalThis.document)?.createElement('div');
    if (!created)
        throw new Error('createAreaHoverLabel needs a document or createElement');
    const element = created;
    if (options.className)
        element.setAttribute('class', options.className);
    element.setAttribute('aria-hidden', 'true');
    element.dataset.testid = 'map-area-hover-label';
    element.style.cssText =
        `position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;` +
            `will-change:transform,opacity;${options.style ?? ''}`;
    element.style.opacity = '0';
    element.style.transition = fadeMs > 0 ? `opacity ${fadeMs}ms ease-out` : 'none';
    element.dataset.visible = 'false';
    container.appendChild(element);
    let target = null;
    let pointer = null;
    let view = null;
    let placement = 'hidden';
    let destroyed = false;
    function conceal() {
        placement = 'hidden';
        element.style.opacity = '0';
        element.dataset.visible = 'false';
    }
    function place() {
        if (destroyed || !target || !view) {
            if (element.dataset.visible !== 'false')
                conceal();
            return;
        }
        const { halfHeight, halfWidth, pixelsPerWorld } = requirePointLayerView(view);
        const center = projectToWorldFraction(view.longitude, view.latitude);
        const anchor = projectToWorldFraction(target.longitude, target.latitude);
        const x = halfWidth + worldFractionDelta(anchor.x, center.x) * pixelsPerWorld;
        const y = halfHeight + (anchor.y - center.y) * pixelsPerWorld;
        let at = null;
        if (x >= insetPx && x <= view.width - insetPx && y >= insetPx && y <= view.height - insetPx) {
            at = { x, y };
            placement = 'anchor';
        }
        else if (pointer) {
            at = { x: pointer.x + POINTER_OFFSET.x, y: pointer.y + POINTER_OFFSET.y };
            placement = 'pointer';
        }
        if (!at) {
            conceal();
            return;
        }
        element.textContent = target.text;
        element.dataset.placement = placement;
        element.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
        element.style.opacity = '1';
        element.dataset.visible = 'true';
    }
    return {
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            element.remove();
        },
        element,
        hide() {
            target = null;
            pointer = null;
            conceal();
        },
        get placement() {
            return placement;
        },
        show(next, at = null) {
            target = next;
            pointer = at;
            place();
        },
        get text() {
            return target?.text ?? '';
        },
        update(next) {
            view = next;
            place();
        },
    };
}
//# sourceMappingURL=area-hover-label.js.map