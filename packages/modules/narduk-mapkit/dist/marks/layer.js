import { MapKitAnnotationRegistry } from '../client/index.js';
const REQUIRED_PRIORITY = 1000;
/** Attributes MapKit writes on the element it positions (`slot` for its shadow root); a repaint keeps them. */
const HOST_ATTRIBUTES = new Set(['slot', 'style']);
/**
 * Swaps a mark's contents and root attributes for a fresh build, keeping the
 * element MapKit already positions. Reusing the element is the point: adding
 * an annotation makes MapKit measure it with a forced layout, which is what a
 * lens switch paid once per station when a pin became a background dot.
 */
function repaint(annotation, next) {
    const { element } = annotation;
    for (const name of element.getAttributeNames()) {
        if (!HOST_ATTRIBUTES.has(name) && !next.hasAttribute(name))
            element.removeAttribute(name);
    }
    for (const name of next.getAttributeNames()) {
        const value = next.getAttribute(name);
        if (!HOST_ATTRIBUTES.has(name) && value !== null && element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }
    element.textContent = '';
    while (next.firstChild)
        element.appendChild(next.firstChild);
}
function descriptorSignature(spec) {
    return `${spec.key}|${spec.signature}@${spec.lat.toFixed(5)},${spec.lon.toFixed(5)}`;
}
/**
 * Keeps the map's annotations in step with a list of mark specs, touching only
 * what changed. Non-selected marks share a pool of `slot:<n>` keys so a lens
 * that shows a different station set can move and repaint existing annotations
 * instead of paying MapKit's add-and-measure cost for every new spec key.
 * Selected marks keep their own key: MapKit's `selected` flag is only applied
 * at create, so they must never take a pooled slot (and a pooled slot must
 * never be handed to them).
 */
export function createMarkLayer(map, runtime) {
    const registry = new MapKitAnnotationRegistry({ map });
    const slotOf = new Map();
    let minted = 0;
    function mintSlot() {
        minted += 1;
        return `slot:${minted}`;
    }
    function assignKey(spec, freed) {
        if (spec.selected)
            return spec.key;
        const held = slotOf.get(spec.key);
        if (held)
            return held;
        return freed.shift() ?? mintSlot();
    }
    return {
        destroy: () => {
            slotOf.clear();
            registry.destroy();
        },
        render: (specs) => {
            const present = new Set(specs.map((spec) => spec.key));
            const freed = [];
            for (const [specKey, slotKey] of slotOf) {
                if (!present.has(specKey))
                    freed.push(slotKey);
            }
            const nextSlotOf = new Map();
            registry.reconcile(specs.map((spec) => {
                const key = assignKey(spec, freed);
                if (!spec.selected)
                    nextSlotOf.set(spec.key, key);
                return {
                    create: () => new runtime.Annotation(new runtime.Coordinate(spec.lat, spec.lon), spec.build, {
                        anchorOffset: new DOMPoint(0, 0),
                        animates: false,
                        calloutEnabled: false,
                        displayPriority: REQUIRED_PRIORITY,
                        selected: spec.selected ?? false,
                    }),
                    key,
                    signature: descriptorSignature(spec),
                    update: (annotation) => {
                        const { latitude, longitude } = annotation.coordinate;
                        if (latitude !== spec.lat || longitude !== spec.lon) {
                            annotation.coordinate = new runtime.Coordinate(spec.lat, spec.lon);
                        }
                        repaint(annotation, spec.build());
                    },
                };
            }));
            slotOf.clear();
            for (const [specKey, slotKey] of nextSlotOf)
                slotOf.set(specKey, slotKey);
        },
    };
}
//# sourceMappingURL=layer.js.map