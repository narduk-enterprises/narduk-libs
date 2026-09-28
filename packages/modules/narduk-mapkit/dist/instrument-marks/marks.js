/**
 * DOM builders for map marks. MapKit places each element as an annotation, so the
 * root is a zero-size anchor on the coordinate and the visible parts hang off it.
 * Styles are exported as MAPKIT_INSTRUMENT_MARKS_CSS. Callers supply every word of copy and
 * every path: the drawing is a stack of SVG layers whose geometry, colours and
 * dash patterns are all inputs, never NOAA/Buoys vocabulary, so products can share the renderer without sharing their domain rules. A crowd is drawn one
 * way only -- a second dot behind the mark (`PinStack`); there is no count ring
 * and no `+n` badge.
 */
const NAME_PILL_CHAR_WIDTH = 7.4;
const NAME_PILL_PADDING = 20;
/** The selection ring's reach past the drawing: a 3 px white halo gap plus a 2 px ring. */
const SELECTED_RING = 5;
/** The leader line between the selection ring and the name pill. */
const NAME_LEADER = 10;
/** The name pill's height. */
export const NAME_PILL_HEIGHT = 22;
/** How far the stack dot is nudged right and up from the mark's own dot. */
export const STACK_OFFSET = 4;
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function anchor(data) {
    const root = el('div', 'mk-mark');
    root.dataset.mapPin = '';
    for (const [key, value] of Object.entries(data ?? {}))
        root.dataset[key] = value;
    return root;
}
function hit(target, className) {
    const button = el('button', `mk-hit ${className}`);
    button.type = 'button';
    button.setAttribute('aria-label', target.ariaLabel);
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        target.onSelect();
    });
    return button;
}
/** Places a name pill `offset` px out from the anchor centre, right or left of it. */
function sideOf(node, flip, offset) {
    node.style.left = flip ? 'auto' : `${offset}px`;
    node.style.right = flip ? `${offset}px` : 'auto';
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs))
        node.setAttribute(name, value);
    return node;
}
/** The selection ring's radius: the paint's own, or one clear of the dot. */
export function selectionRadius(paint) {
    return paint.selRadius || paint.dotRadius + SELECTED_RING;
}
/** Half the drawing canvas: everything the mark paints, plus room for a selection ring. */
function paintExtent(paint, selected) {
    const reach = Math.max(paint.extent, selected ? selectionRadius(paint) + 3.5 : 0);
    return Math.ceil(reach + 1);
}
function path(className, d, attrs) {
    return svgNode('path', { ...attrs, class: className, d });
}
/**
 * The layer stack, bottom to top. Empty paths and zero radii are skipped
 * rather than drawn as no-ops, so a plain status dot is four nodes, not
 * twelve, and the signature-driven repaint has less to build.
 */
function paintParts(paint, selected, stack) {
    const parts = [];
    if (paint.halo) {
        parts.push(path('mk-pin-halo', paint.halo, { 'stroke-width': String(paint.haloWidth) }));
    }
    if (paint.ghost)
        parts.push(path('mk-pin-ghost', paint.ghost, { fill: paint.fill }));
    if (paint.track)
        parts.push(path('mk-pin-track', paint.track, {}));
    if (paint.body) {
        parts.push(path('mk-pin-body', paint.body, {
            fill: paint.bodyFill,
            stroke: paint.bodyStroke,
            'stroke-dasharray': paint.bodyDash,
            'stroke-width': String(paint.bodyWidth),
        }));
    }
    if (paint.calm)
        parts.push(path('mk-pin-calm', paint.calm, { stroke: paint.calmStroke }));
    if (stack) {
        parts.push(svgNode('circle', {
            class: 'mk-pin-stack',
            cx: String(stack.offset),
            cy: String(-stack.offset),
            fill: stack.color,
            r: String(paint.dotRadius),
        }));
    }
    if (selected) {
        const r = String(selectionRadius(paint));
        parts.push(svgNode('circle', { class: 'mk-pin-sel-halo', r }));
        parts.push(svgNode('circle', { class: 'mk-pin-sel', r }));
    }
    if (paint.dotRadius > 0) {
        parts.push(svgNode('circle', {
            class: 'mk-pin-dot',
            fill: paint.dotFill,
            r: String(paint.dotRadius),
            stroke: paint.dotStroke,
            'stroke-dasharray': paint.dotDash,
            'stroke-width': String(paint.dotWidth),
        }));
    }
    if (paint.text) {
        const text = svgNode('text', {
            class: 'mk-pin-num',
            'dominant-baseline': 'central',
            fill: paint.ink,
            'font-size': String(paint.fontSize),
            'text-anchor': 'middle',
        });
        text.textContent = paint.text;
        parts.push(text);
    }
    return parts;
}
/** The mark's drawing: one SVG centred on the anchor, wide enough for every layer. */
function drawing(paint, selected, stack) {
    const extent = paintExtent(paint, selected);
    const size = String(extent * 2);
    const svg = svgNode('svg', {
        'aria-hidden': 'true',
        class: 'mk-pin-svg',
        height: size,
        viewBox: `${-extent} ${-extent} ${size} ${size}`,
        width: size,
    });
    for (const part of paintParts(paint, selected, stack))
        svg.appendChild(part);
    return svg;
}
/**
 * A single pin: a `.mk-pin` hit target sized to at least `hitSize` (a
 * transparent halo keeps touch targets >= 44 px without growing the drawing),
 * the drawing itself, and optionally a value tab beside it and a station name
 * below it. The aria-label doubles as the hover tooltip, so the hidden count
 * reads the same both ways.
 */
export function createPinMark(target) {
    const root = anchor(target.data);
    const classes = ['mk-pin', target.selected ? 'is-sel' : ''];
    const button = hit(target, classes.filter(Boolean).join(' '));
    button.title = target.ariaLabel;
    const hitSize = Math.max(target.hitSize, target.paint.dotRadius * 2);
    button.style.width = `${hitSize}px`;
    button.style.height = `${hitSize}px`;
    button.style.margin = `${-hitSize / 2}px 0 0 ${-hitSize / 2}px`;
    if (target.selected)
        button.setAttribute('aria-pressed', 'true');
    button.appendChild(drawing(target.paint, target.selected, target.stack));
    root.appendChild(button);
    if (target.tab)
        root.appendChild(valueTab(target.tab, target.paint));
    if (target.name)
        root.appendChild(pinName(target.name, target.paint.footprint));
    return root;
}
/**
 * A reading beside its drawing, on whichever side the instrument does not
 * reach: a bearing pointing west (sin <= 0) leaves the east side clear.
 */
function valueTab(text, paint) {
    const tab = el('span', 'mk-tab', text);
    tab.setAttribute('aria-hidden', 'true');
    const right = paint.bearing === null || Math.sin((paint.bearing * Math.PI) / 180) <= 0;
    sideOf(tab, !right, paint.footprint + 3);
    return tab;
}
/** A name centred below its drawing; decorative, as the button's label already names it. */
function pinName(name, footprint) {
    const label = el('span', 'mk-pin-name', name);
    label.setAttribute('aria-hidden', 'true');
    label.style.top = `${footprint + 2}px`;
    return label;
}
/**
 * A selected pin plus its name callout, sharing one zero-size anchor: the pin
 * keeps its ink selection ring and the name is a solid ink pill joined to that
 * ring by a leader line (#239).
 */
export function createSelectedMark(target) {
    // The name goes in the callout pill only: `createPinMark` would otherwise
    // also hang a close-tier `.mk-pin-name` under the drawing and print it twice.
    const root = createPinMark({ ...target, name: null, selected: true, stack: null });
    const label = el('span', target.flip ? 'mk-name is-flip' : 'mk-name', target.name);
    label.setAttribute('aria-hidden', 'true');
    label.style.setProperty('--mk-leader', `${NAME_LEADER}px`);
    sideOf(label, target.flip, selectedReach(target.paint));
    root.appendChild(label);
    return root;
}
/** How far out from the anchor a selected pin's name pill starts. */
export function selectedReach(paint) {
    return Math.max(selectionRadius(paint), paint.footprint) + NAME_LEADER;
}
export function createBackgroundMark(kind, size) {
    const root = el('div', 'mk-mark');
    root.setAttribute('aria-hidden', 'true');
    const mark = el('span', kind === 'pip' ? 'mk-pip' : 'mk-void');
    mark.style.width = `${size}px`;
    mark.style.height = `${size}px`;
    mark.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    root.appendChild(mark);
    return root;
}
/** Rough rendered width of the name pill alone. */
export function namePillWidth(name) {
    return Math.ceil(name.length * NAME_PILL_CHAR_WIDTH) + NAME_PILL_PADDING;
}
/** Rough rendered width of a selected pin plus its name pill, to pick which side it opens. */
export function selectedMarkWidth(paint, name) {
    return selectedReach(paint) * 2 + namePillWidth(name);
}
//# sourceMappingURL=marks.js.map