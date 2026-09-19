/**
 * DOM builders for map marks. MapKit places each element as an annotation, so the
 * root is a zero-size anchor on the coordinate and the visible parts hang off it.
 * Styles live in assets/css/mapkit.css. Callers supply every word of copy and
 * every colour: size, colour and stack rims are inputs, never NOAA/Buoys
 * vocabulary, so this file can move into `@narduk-enterprises/narduk-mapkit`
 * unchanged. A crowd is drawn one way only -- a second rim behind the pin
 * (`PinStack`); there is no count ring and no `+n` badge.
 */
const NAME_PILL_CHAR_WIDTH = 7.4;
const NAME_PILL_PADDING = 20;
/** The selection ring's reach past the disc: a 3 px white halo gap plus a 2 px ring. */
export const SELECTED_RING = 5;
/** The leader line between the selection ring and the name pill. */
export const NAME_LEADER = 10;
/** The name pill's height. */
export const NAME_PILL_HEIGHT = 22;
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
/** The disc a pin (or its selected/cluster variants) paints inside the hit target. */
function paintDisc(disc, paint) {
    const d = paint.radius * 2;
    disc.style.width = `${d}px`;
    disc.style.height = `${d}px`;
    disc.style.background = paint.fill;
    disc.style.color = paint.ink;
    disc.style.border = paint.ring;
    disc.style.fontSize = `${paint.fontSize}px`;
    if (paint.glyph !== null)
        drawGlyph(disc, paint.glyph, paint);
    disc.appendChild(el('span', 'mk-pin-text', paint.text));
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs))
        node.setAttribute(name, value);
    return node;
}
/** Arrowhead corners for a disc of radius `r`, pointing up, its base just inside the rim. */
function notchPoints(r) {
    const length = 2.5 + r * 0.25;
    const half = 1.2 + r * 0.2;
    const inset = r - 1;
    return { left: `${-half},${-inset}`, right: `${half},${-inset}`, tip: `0,${-(r + length)}` };
}
function glyphParts(glyph, paint) {
    if (glyph.kind === 'path') {
        return [
            svgNode('path', { class: 'mk-glyph-halo', d: glyph.stroke + glyph.fill }),
            svgNode('path', { class: 'mk-glyph-ink', d: glyph.stroke }),
            svgNode('path', { class: 'mk-glyph-fill', d: glyph.fill }),
        ];
    }
    const { left, right, tip } = notchPoints(paint.radius);
    // A hollow (white) disc edges its notch in ink so it still reads.
    const edge = paint.fill === '#ffffff' ? paint.ink : '#ffffff';
    return [
        svgNode('polygon', { fill: paint.fill, points: `${left} ${right} ${tip}` }),
        svgNode('polyline', {
            class: 'mk-glyph-edge',
            points: `${right} ${tip} ${left}`,
            stroke: edge,
        }),
    ];
}
function drawGlyph(disc, glyph, paint) {
    const extent = glyph.kind === 'notch' ? paint.radius * 1.4 + 6 : glyph.extent;
    const size = String(extent * 2);
    const svg = svgNode('svg', {
        'aria-hidden': 'true',
        class: 'mk-pin-glyph',
        height: size,
        viewBox: `${-extent} ${-extent} ${size} ${size}`,
        width: size,
    });
    svg.style.margin = `${-extent}px 0 0 ${-extent}px`;
    svg.style.transform = `rotate(${glyph.bearing}deg)`;
    for (const part of glyphParts(glyph, paint))
        svg.appendChild(part);
    disc.appendChild(svg);
}
function stackRim(stack, radius) {
    const rim = el('span', 'mk-stack');
    const d = radius * 2;
    rim.style.width = `${d}px`;
    rim.style.height = `${d}px`;
    rim.style.background = stack.color;
    rim.style.transform = `translate(${stack.offset}px, ${-stack.offset}px)`;
    return rim;
}
/**
 * A single dynamic pin: a `.mk-pin` hit target sized to at least `hitSize`
 * (a transparent halo keeps touch targets >= 44 px without growing the
 * visible disc), an inner disc painted per `paint`, and an optional stack
 * rim behind it for hidden neighbours. The aria-label doubles as the hover
 * tooltip, so the hidden count reads the same both ways.
 */
export function createPinMark(target) {
    const root = anchor(target.data);
    const classes = ['mk-pin', target.selected ? 'is-sel' : ''];
    const button = hit(target, classes.filter(Boolean).join(' '));
    button.title = target.ariaLabel;
    const hitSize = Math.max(target.hitSize, target.paint.radius * 2);
    button.style.width = `${hitSize}px`;
    button.style.height = `${hitSize}px`;
    button.style.margin = `${-hitSize / 2}px 0 0 ${-hitSize / 2}px`;
    if (target.selected)
        button.setAttribute('aria-pressed', 'true');
    if (target.stack)
        button.appendChild(stackRim(target.stack, target.paint.radius));
    const disc = el('span', 'mk-pin-disc');
    paintDisc(disc, target.paint);
    button.appendChild(disc);
    root.appendChild(button);
    if (target.name)
        root.appendChild(pinName(target.name, target.paint.radius));
    return root;
}
/** A name centred below its disc; decorative, as the button's label already names it. */
function pinName(name, radius) {
    const label = el('span', 'mk-pin-name', name);
    label.setAttribute('aria-hidden', 'true');
    label.style.top = `${radius + 2}px`;
    return label;
}
/**
 * A selected pin plus its name callout, sharing one zero-size anchor: the pin
 * keeps its numeral inside a white halo gap and ring, and the name is a solid
 * ink pill joined to the ring by a leader line (#239).
 */
export function createSelectedMark(target) {
    // The name goes in the callout pill only: `createPinMark` would otherwise
    // also hang a close-tier `.mk-pin-name` under the disc and print it twice.
    const root = createPinMark({ ...target, name: null, selected: true, stack: null });
    const label = el('span', target.flip ? 'mk-name is-flip' : 'mk-name', target.name);
    label.setAttribute('aria-hidden', 'true');
    label.style.setProperty('--mk-leader', `${NAME_LEADER}px`);
    sideOf(label, target.flip, target.paint.radius + SELECTED_RING + NAME_LEADER);
    root.appendChild(label);
    return root;
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
    return (paint.radius + SELECTED_RING) * 2 + NAME_LEADER + namePillWidth(name);
}
//# sourceMappingURL=marks.js.map