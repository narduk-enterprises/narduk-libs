/**
 * A line from an annotation's screen point to an anchor element.
 *
 * Follows the point on every `refresh()` (the host calls that on region
 * change), draws in an SVG overlay, and reports when the point is off the
 * map frame. `<AppMapKit>` wires this from its `leader` prop; a consumer
 * that draws its own pins on `./client` calls the same class (narduk-libs#517).
 */
export const MAPKIT_LEADER_ATTRIBUTE = 'data-mapkit-leader';
export const MAPKIT_LEADER_LINE_ATTRIBUTE = 'data-mapkit-leader-line';
export const MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE = 'data-mapkit-leader-offscreen';
const SVG_NS = 'http://www.w3.org/2000/svg';
function inFrame(container, point) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}
export class MapKitLeaderOverlay {
    #container;
    #document;
    #line;
    #options;
    #svg;
    #destroyed = false;
    #offscreen = false;
    #offscreenKnown = false;
    constructor(options) {
        this.#options = options;
        this.#container = options.container;
        this.#document = options.document ?? this.#container.ownerDocument ?? globalThis.document;
        this.#svg = this.#document.createElementNS(SVG_NS, 'svg');
        this.#svg.setAttribute(MAPKIT_LEADER_ATTRIBUTE, '');
        this.#svg.setAttribute('aria-hidden', 'true');
        this.#svg.setAttribute('class', 'mapkit-leader');
        this.#line = this.#document.createElementNS(SVG_NS, 'line');
        this.#line.setAttribute(MAPKIT_LEADER_LINE_ATTRIBUTE, '');
        this.#line.setAttribute('class', 'mapkit-leader-line');
        this.#line.setAttribute('fill', 'none');
        this.#line.setAttribute('stroke', 'currentColor');
        this.#line.setAttribute('stroke-width', '1.5');
        this.#svg.append(this.#line);
        this.#container.append(this.#svg);
        this.refresh();
    }
    get offscreen() {
        return this.#offscreen;
    }
    /** Re-read the point and the anchor. Call on every region change. */
    refresh() {
        if (this.#destroyed)
            return;
        const width = this.#container.clientWidth;
        const height = this.#container.clientHeight;
        this.#svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
        this.#svg.setAttribute('width', String(width));
        this.#svg.setAttribute('height', String(height));
        const point = this.#options.getPoint();
        if (!point) {
            this.#hide();
            this.#report(false);
            return;
        }
        const offscreen = !inFrame(this.#container, point);
        this.#report(offscreen);
        const anchor = this.#options.getAnchor();
        if (offscreen || !anchor) {
            this.#hide();
            return;
        }
        const containerBox = this.#container.getBoundingClientRect();
        const anchorBox = anchor.getBoundingClientRect();
        this.#line.setAttribute('x1', String(point.x));
        this.#line.setAttribute('y1', String(point.y));
        this.#line.setAttribute('x2', String(anchorBox.left + anchorBox.width / 2 - containerBox.left));
        this.#line.setAttribute('y2', String(anchorBox.top + anchorBox.height / 2 - containerBox.top));
        this.#line.removeAttribute('hidden');
        this.#svg.removeAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE);
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#svg.remove();
    }
    #hide() {
        this.#line.setAttribute('hidden', '');
        this.#svg.setAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE, '');
    }
    #report(offscreen) {
        if (this.#offscreenKnown && this.#offscreen === offscreen)
            return;
        this.#offscreenKnown = true;
        this.#offscreen = offscreen;
        this.#options.onOffscreen?.(offscreen);
    }
}
//# sourceMappingURL=leader-overlay.js.map