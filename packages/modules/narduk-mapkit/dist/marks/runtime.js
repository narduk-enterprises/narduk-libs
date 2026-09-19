/**
 * Structural types for the parts of the MapKit JS runtime the map kit uses,
 * plus narrowing helpers for the namespace and map a host hands over.
 *
 * The namespace is NOT `globalThis.mapkit`. `@apple/mapkit-loader` returns
 * `mapkit.load(libraries)`, and MapKit JS 6 resolves that to a scoped namespace
 * of its own: the map `<AppMapKit>` builds belongs to that scoped one, while
 * `window.mapkit` stays a separate object whose `maps` list is empty. An
 * `Annotation`, `MapRect` or `MapType` value taken off the global therefore
 * fails the map's own instanceof checks -- live MapKit 6 answers
 * `Map.addAnnotations expected an annotation at index 0, but got
 * [object EventTarget]` and draws nothing. So the host passes the namespace
 * from the kit's own handle, the module singleton `<AppMapKit>` builds from
 * (KIT DEFECT K-10: `map-ready` hands over the map without it).
 */
/**
 * Narrows the scoped namespace a host reads from its kit handle -- in Nuxt,
 * `useMapKit().mapkit.value` -- to the parts the marks use. Read it lazily at
 * `map-ready`, never at setup, so the page's own loader decides the libraries.
 */
export function asMkRuntime(value) {
    return typeof value === 'object' && value !== null && 'MapRect' in value
        ? value
        : null;
}
/** Narrows the untyped map instance AppMapKit emits from map-ready. */
export function asMkMap(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    return 'visibleMapRect' in value && 'addAnnotations' in value ? value : null;
}
//# sourceMappingURL=runtime.js.map