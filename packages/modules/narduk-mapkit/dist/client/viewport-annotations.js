/**
 * Viewport-bounded annotation management: keep only the markers near what the
 * map shows in the DOM, however many there are in the data.
 *
 * A city has thousands of stops, but a phone shows forty. Every annotation
 * MapKit holds costs a DOM node and a layout pass on every pan, so a layer that
 * adds all of them is slow exactly when it matters (a pan on a mid-range
 * phone). This wraps `MapKitAnnotationRegistry`: `sync(items, region)` adds the
 * items inside the region (plus a margin so a small pan reveals nothing late),
 * removes those well outside it, and leaves the rest untouched.
 *
 * The margin has hysteresis, so a marker on the boundary does not flicker in
 * and out: an item enters at `enterPadding` of the region's size beyond each
 * edge, but is only removed once it is `keepPadding` beyond. Items the consumer
 * names in `pinned` (the selected one, the followed one) are always kept.
 *
 * Call `sync` from the map's region-change-end (or the `region-change` event
 * of `<AppMapKit>`), and again when the data changes.
 */
import { isInVisibleRegion } from '../geometry/declutter.js';
import { MapKitAnnotationRegistry } from './annotations.js';
export class MapKitViewportAnnotations {
    #options;
    #registry;
    constructor(options) {
        const enter = options.enterPadding ?? 0.25;
        const keep = options.keepPadding ?? 0.6;
        if (enter > keep)
            throw new Error('enterPadding must not exceed keepPadding');
        this.#options = options;
        this.#registry = new MapKitAnnotationRegistry({ map: options.map });
    }
    /** Annotations on the map now. */
    get size() {
        return this.#registry.size;
    }
    has(key) {
        return this.#registry.has(key);
    }
    get(key) {
        return this.#registry.get(key);
    }
    keys() {
        return this.#registry.list();
    }
    /**
     * Make the map hold the items near `region`. Pass `null` for a region not yet
     * known: every item is held back, because adding thousands before the first
     * region report is the stall this exists to avoid.
     */
    sync(items, region) {
        const { create, key, pinned, signature, update } = this.#options;
        const enter = this.#options.enterPadding ?? 0.25;
        const keep = this.#options.keepPadding ?? 0.6;
        const pins = new Set(pinned?.() ?? []);
        const descriptors = [];
        for (const item of items) {
            const id = key(item);
            const wanted = pins.has(id) ||
                (region !== null && isInVisibleRegion(item, region, this.#registry.has(id) ? keep : enter));
            if (!wanted)
                continue;
            descriptors.push({
                create: () => create(item),
                key: id,
                signature: signature?.(item) ?? '',
                ...(update ? { update: (annotation) => update(annotation, item) } : {}),
            });
        }
        return this.#registry.reconcile(descriptors);
    }
    /** Remove everything and refuse further syncs. */
    destroy() {
        this.#registry.destroy();
    }
}
//# sourceMappingURL=viewport-annotations.js.map