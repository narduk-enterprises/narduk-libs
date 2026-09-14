/**
 * Keyed annotation reconciliation for MapKit JS maps.
 *
 * MapKit JS does no diffing of its own, so the obvious way to update markers
 * is `map.removeAnnotations(all)` followed by `map.addAnnotations(next)`. That
 * destroys and recreates every marker on every render: a consumer map measured
 * on 2026-08-28 rebuilt ~263 annotations on each pan, hover, date change, and
 * opacity tick, and the markers visibly blinked every time.
 *
 * This registry keeps annotations keyed and compares a caller-supplied
 * `signature` per key, so an unchanged marker is never removed, re-added, or
 * mutated -- the host object identity survives untouched across renders.
 *
 * It is the fine-grained sibling of `MapKitLayerRegistry.reconcile()`. That one
 * fingerprints a whole tile source with `layerSourceIdentity()` and treats any
 * change other than opacity as a full replace. Here the consumer owns the
 * comparison: a `signature` is whatever string distinguishes one rendering of a
 * marker from another, so a change can be applied in place through `update()`
 * instead of forcing a recreate.
 */
function requireAnnotationKey(key) {
    if (!key.trim())
        throw new Error('annotation key is required');
}
export class MapKitAnnotationRegistry {
    #entries = new Map();
    #map;
    #destroyed = false;
    constructor(options) {
        this.#map = options.map;
    }
    get destroyed() {
        return this.#destroyed;
    }
    /** Live annotation count. */
    get size() {
        return this.#entries.size;
    }
    get(key) {
        return this.#entries.get(key)?.annotation;
    }
    has(key) {
        return this.#entries.has(key);
    }
    list() {
        return [...this.#entries.keys()];
    }
    /** Add one annotation outside a reconcile pass. Throws on a duplicate key. */
    register(descriptor) {
        if (this.#destroyed)
            throw new Error('annotation registry is destroyed');
        requireAnnotationKey(descriptor.key);
        if (this.#entries.has(descriptor.key)) {
            throw new Error(`annotation "${descriptor.key}" is already registered`);
        }
        const annotation = descriptor.create();
        this.#entries.set(descriptor.key, { annotation, signature: descriptor.signature });
        this.#map.addAnnotations([annotation]);
        return annotation;
    }
    /** Remove one annotation. A no-op for unknown keys. */
    unregister(key) {
        if (this.#destroyed)
            return;
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        this.#entries.delete(key);
        this.#map.removeAnnotations([entry.annotation]);
    }
    /**
     * Sync the map to exactly `descriptors`, in one batched removal and one
     * batched addition:
     *
     * - key present before and after with an unchanged signature -> untouched;
     * - changed signature -> `update()` in place, else recreate that key alone;
     * - key absent now -> removed;
     * - new key -> created.
     *
     * Reconciling the same descriptors twice makes no host call at all, which is
     * what keeps a re-render that changed nothing from repainting the markers.
     */
    reconcile(descriptors) {
        const result = {
            added: 0,
            recreated: 0,
            removed: 0,
            unchanged: 0,
            updated: 0,
        };
        if (this.#destroyed)
            return result;
        const desiredKeys = new Set();
        for (const descriptor of descriptors) {
            requireAnnotationKey(descriptor.key);
            if (desiredKeys.has(descriptor.key)) {
                throw new Error(`duplicate annotation key "${descriptor.key}" in reconcile()`);
            }
            desiredKeys.add(descriptor.key);
        }
        const removals = [];
        const additions = [];
        for (const [key, entry] of [...this.#entries]) {
            if (desiredKeys.has(key))
                continue;
            this.#entries.delete(key);
            removals.push(entry.annotation);
        }
        for (const descriptor of descriptors) {
            const entry = this.#entries.get(descriptor.key);
            if (!entry) {
                const annotation = descriptor.create();
                this.#entries.set(descriptor.key, { annotation, signature: descriptor.signature });
                additions.push(annotation);
                continue;
            }
            if (entry.signature === descriptor.signature) {
                result.unchanged += 1;
                continue;
            }
            if (descriptor.update) {
                descriptor.update(entry.annotation);
                entry.signature = descriptor.signature;
                result.updated += 1;
                continue;
            }
            removals.push(entry.annotation);
            const annotation = descriptor.create();
            entry.annotation = annotation;
            entry.signature = descriptor.signature;
            additions.push(annotation);
            result.recreated += 1;
        }
        // Removal first, then addition: both land in the same task, and MapKit
        // reads the final annotation set once rather than once per marker.
        if (removals.length > 0)
            this.#map.removeAnnotations(removals);
        if (additions.length > 0)
            this.#map.addAnnotations(additions);
        result.added = additions.length;
        result.removed = removals.length;
        return result;
    }
    /** Remove every annotation in one host call. */
    clear() {
        if (this.#destroyed)
            return;
        if (this.#entries.size === 0)
            return;
        const annotations = [...this.#entries.values()].map((entry) => entry.annotation);
        this.#entries.clear();
        this.#map.removeAnnotations(annotations);
    }
    /**
     * Clear and make the registry inert. Idempotent. Afterwards `reconcile()`,
     * `unregister()`, and `clear()` do nothing, and `register()` throws because
     * it has no annotation to return.
     */
    destroy() {
        if (this.#destroyed)
            return;
        this.clear();
        this.#destroyed = true;
    }
}
//# sourceMappingURL=annotations.js.map