/**
 * `<AppMapKit>` -- the 2.1.0 map component at
 * `@narduk-enterprises/narduk-mapkit/nuxt`.
 *
 * ## Why this is a render function and not a `.vue` file
 *
 * Everything else this package publishes is framework-free and its `dist/` is
 * committed and built by plain `tsc`. An SFC would mean adding an SFC compiler
 * to a package whose other nine entry points have no use for one, and a second
 * build output to keep in sync with the committed one. A render function costs
 * one import of `vue` and compiles with the rest of the package.
 *
 * ## What the component itself owns
 *
 * Almost nothing. The decisions -- keyed reconciliation, per-pin anchor
 * geometry, callout placement, overlay lifecycle -- live in the framework-free
 * controllers beside this file, because two consumers drive MapKit from plain
 * TypeScript and the seam has to hold without Vue (narduk-libs#422). This file
 * turns props into calls on those controllers and renders the slots.
 */
import { Teleport, computed, defineComponent, h, inject, onBeforeUnmount, ref, shallowRef, watch, } from 'vue';
import { applyMapKitBasemap, resolveMapKitMapType } from '../basemap.js';
import { MapKitCalloutHostLayer } from '../callout-host.js';
import { useMapKitPreload } from '../preload.js';
import { MapKitOverlayLayer } from '../overlay-layer.js';
import { mapKitAnchorOffset } from '../pin-geometry.js';
import { MapKitPinLayer, defaultMapKitItemKey } from '../pin-layer.js';
import { mapKitBoundingRegion, mapKitGeometryPoints } from '../region.js';
import { mapKitColorModeInjectionKey, mapKitNonceInjectionKey } from '../injection-keys.js';
import { useMapKit } from '../composables/useMapKit.js';
const props = {
    ariaLabel: { default: 'Map', type: String },
    boundingPadding: { default: 0.05, type: Number },
    /** Open the callout for the selected item. Off hands control to `openCallout`. */
    calloutFollowSelection: { default: true, type: Boolean },
    circleScaleFactor: { default: 0.004, type: Number },
    circles: { default: () => [], type: Array },
    clusteringIdentifier: { default: undefined, type: String },
    colorScheme: { default: 'auto', type: String },
    createClusterElement: {
        default: undefined,
        type: Function,
    },
    /** Returns ONLY the glyph. The focusable, labelled host is the library's. */
    createPinElement: {
        default: undefined,
        type: Function,
    },
    dynamicCircleRadius: { default: false, type: Boolean },
    fallbackCenter: { default: undefined, type: Object },
    geojson: { default: null, type: Object },
    isRotationEnabled: { default: false, type: Boolean },
    isScrollEnabled: { default: true, type: Boolean },
    isZoomEnabled: { default: true, type: Boolean },
    items: { default: () => [], type: Array },
    /**
     * The buoys#112 root-cause fix: a stable key per item is what makes an
     * `items` change a diff instead of a rebuild.
     */
    itemKey: {
        default: defaultMapKitItemKey,
        type: Function,
    },
    /** REQUIRED when `items` is non-empty: the accessible name of the pin. */
    itemLabel: { default: undefined, type: Function },
    language: { default: undefined, type: String },
    /** REQUIRED: MapKit JS 6 loads no map library by default. */
    libraries: { default: undefined, type: Array },
    mapType: { default: 'standard', type: String },
    maxCircleRadius: { default: 6000, type: Number },
    minCircleRadius: { default: 200, type: Number },
    minSpanDelta: { default: 0, type: Number },
    nonce: { default: undefined, type: String },
    overlayStyleFn: {
        default: undefined,
        type: Function,
    },
    /** Per-pin size and anchor. Replaces 2.0.x's one global `annotationSize`. */
    pinGeometry: {
        default: undefined,
        type: Function,
    },
    /**
     * Whether a pin is an interactive control (2.1.1, K-8).
     *
     * `true` -- the default and 2.1.0's only behaviour -- gives every pin host
     * `role="button"`, `tabindex="0"`, an `aria-label` and the click/Enter/Space
     * handlers. `false` is for a decorative map: the host carries no role, no
     * tabindex, no `aria-pressed` and no listeners, so an `aria-hidden` map no
     * longer contains focusable descendants (axe `aria-hidden-focus`) and
     * `itemLabel` stops being required.
     */
    pinsFocusable: { default: true, type: Boolean },
    /** 7 of 7 consumers set this, so 2.1.0 flips the default. */
    preserveRegion: { default: true, type: Boolean },
    selectedId: { default: null, type: String },
    /** Six observed consumer values, all `false`, riverstatus included. */
    showsPointsOfInterest: { default: false, type: Boolean },
    /** 4 of 5 selection users set this, so 2.1.0 flips the default. */
    suppressSelectionZoom: { default: true, type: Boolean },
    zoomSpan: {
        default: () => ({ lat: 0.002, lng: 0.0025 }),
        type: Object,
    },
};
const AppMapKitImpl = defineComponent({
    name: 'AppMapKit',
    props,
    emits: {
        'callout-close': (payload) => Boolean(payload),
        'callout-open': (payload) => Boolean(payload),
        'feature-select': (feature) => Boolean(feature),
        'map-click': (coordinate) => Boolean(coordinate),
        /**
         * The map, and the namespace that built it (2.1.1, K-10).
         *
         * The second argument is `useMapKit().mapkit`, NOT `globalThis.mapkit`:
         * MapKit JS 6 resolves `mapkit.load(libraries)` to a scoped namespace, and a
         * value built from the global one fails this map's own instanceof checks.
         */
        'map-ready': (map, mapkit) => Boolean(map) && Boolean(mapkit),
        'mapkit-error': (failure) => Boolean(failure),
        'region-change': (region) => Boolean(region),
        'update:selectedId': (id) => id === null || typeof id === 'string',
    },
    slots: Object,
    setup(componentProps, { emit, expose, slots }) {
        /**
         * K-9. 2.1.0 threw from inside the pin layer on the first non-empty
         * `items`, which meant the error arrived only once MapKit had loaded, a
         * token had been exchanged and a map existed -- i.e. in production, on a
         * page whose map had already half-built itself.
         *
         * The type system cannot carry this: making `itemLabel` required when
         * `items` is would mean a union `$props`, which no gate in this package can
         * prove safe under `vue-tsc`. So the throw stays, raised first thing in
         * `setup` -- before a script is injected or a token is fetched, naming the
         * component and both ways out.
         */
        function assertPinLabelling(items) {
            if (items.length === 0 || !componentProps.pinsFocusable || componentProps.itemLabel)
                return;
            throw new Error('<AppMapKit>: the itemLabel prop is required whenever items is non-empty -- it is the ' +
                'accessible name of the library-owned pin host, and a pin without one is unreachable ' +
                'by screen reader. Pass itemLabel, or set :pins-focusable="false" for a decorative ' +
                'map whose pins are not interactive controls.');
        }
        assertPinLabelling(componentProps.items);
        const injectedNonce = inject(mapKitNonceInjectionKey, null);
        const colorMode = inject(mapKitColorModeInjectionKey, null);
        const mapKitOptions = {};
        if (componentProps.libraries)
            mapKitOptions.libraries = componentProps.libraries;
        if (componentProps.language !== undefined)
            mapKitOptions.language = componentProps.language;
        // Emitted from the component, so a page with no map downloads nothing (§f).
        useMapKitPreload({
            ...mapKitOptions,
            ...((componentProps.nonce ?? injectedNonce)
                ? { nonce: componentProps.nonce ?? injectedNonce ?? undefined }
                : {}),
        });
        const { failure, mapkit, ready, retry: retryLoad } = useMapKit(mapKitOptions);
        const calloutEntries = shallowRef([]);
        const containerRef = ref(null);
        /**
         * `ready` says MapKit JS loaded; this says the `mapkit.Map` exists. They are
         * one tick apart -- the map is constructed in a post-flush watcher, after
         * the container element is in the DOM -- and the wrapper's
         * `data-mapkit-state` has to track the second, not the first. A plain `let`
         * cannot: it would leave the component rendered as `loading` forever.
         */
        const mapReady = ref(false);
        const wrapperRef = ref(null);
        let calloutLayer = null;
        let map = null;
        let overlayLayer = null;
        let overviewRegion = null;
        let pinLayer = null;
        const state = computed(() => {
            if (failure.value)
                return 'error';
            return ready.value && mapReady.value ? 'ready' : 'loading';
        });
        function report(cause) {
            const next = {
                message: cause instanceof Error ? cause.message : String(cause),
                source: 'mapkit',
                status: 'Unknown',
            };
            emit('mapkit-error', next);
            throw cause;
        }
        function framingPoints() {
            const points = componentProps.items.map((item) => ({
                lat: item.lat,
                lng: item.lng,
            }));
            for (const feature of componentProps.geojson?.features ?? []) {
                points.push(...mapKitGeometryPoints(feature.geometry));
            }
            for (const circle of componentProps.circles)
                points.push({ lat: circle.lat, lng: circle.lng });
            return points;
        }
        function toRegion(namespace, plain, span) {
            return new namespace.CoordinateRegion(new namespace.Coordinate(plain.lat, plain.lng), new namespace.CoordinateSpan(span.lat, span.lng));
        }
        function computeOverview(namespace) {
            const plain = mapKitBoundingRegion(framingPoints(), {
                boundingPadding: componentProps.boundingPadding,
                fallbackCenter: componentProps.fallbackCenter,
                minSpanDelta: componentProps.minSpanDelta,
            });
            if (!plain)
                return null;
            return toRegion(namespace, plain.center, plain.span);
        }
        /**
         * Where a coordinate lands inside the map container.
         *
         * `convertCoordinateToPointOnPage` is the right answer where it exists, but
         * the deterministic fake at `./testing` deliberately does not model it and
         * THROWS rather than answering `undefined` -- and a real map that has not
         * laid out yet returns `null`. Both fall through to the pin's own placed
         * position, which MapKit and the fake both write.
         */
        function projectCoordinate(coordinate, id) {
            const container = containerRef.value;
            const namespace = mapkit.value;
            if (!container || !map || !namespace)
                return null;
            try {
                const convert = map.convertCoordinateToPointOnPage;
                if (typeof convert === 'function') {
                    const point = convert.call(map, new namespace.Coordinate(coordinate.lat, coordinate.lng));
                    if (point) {
                        const box = container.getBoundingClientRect();
                        return {
                            x: point.x - box.left - globalThis.scrollX,
                            y: point.y - box.top - globalThis.scrollY,
                        };
                    }
                }
            }
            catch {
                // Not modelled on this map; the pin's own position answers the same question.
            }
            const host = pinLayer?.hostFor(id);
            if (!host)
                return null;
            const geometry = componentProps.pinGeometry?.(pinLayer?.itemFor(id)) ?? {};
            const offset = mapKitAnchorOffset(geometry);
            const left = host.offsetLeft || Number.parseFloat(host.style.left || '0');
            const top = host.offsetTop || Number.parseFloat(host.style.top || '0');
            return {
                x: left - offset.x + (geometry.size ? geometry.size.width / 2 + offset.x : 0),
                y: top,
            };
        }
        function calloutAnchorOffset(item) {
            const geometry = componentProps.pinGeometry?.(item) ?? {};
            const offset = mapKitAnchorOffset(geometry);
            return { x: offset.x + (geometry.size?.width ?? 0) / 2, y: offset.y };
        }
        function openCallout(id) {
            const item = pinLayer?.itemFor(id);
            const container = containerRef.value;
            if (!item || !container)
                return;
            calloutLayer ??= new MapKitCalloutHostLayer({
                container,
                onChange: (entries) => {
                    calloutEntries.value = entries;
                },
                projectCoordinate,
            });
            calloutLayer.open({
                anchorOffset: calloutAnchorOffset(item),
                coordinate: { lat: item.lat, lng: item.lng },
                id,
                item,
            });
            emit('callout-open', { id, item });
        }
        function closeCallout(id) {
            if (!calloutLayer)
                return;
            const targets = id === undefined ? [...calloutLayer.openIds] : [id];
            for (const target of targets) {
                const item = pinLayer?.itemFor(target);
                if (calloutLayer.close(target) && item)
                    emit('callout-close', { id: target, item });
            }
        }
        function select(id) {
            if (id === componentProps.selectedId)
                return;
            emit('update:selectedId', id);
        }
        function applySelection(id) {
            if (!pinLayer)
                return;
            pinLayer.setSelected(id);
            if (!componentProps.calloutFollowSelection)
                return;
            closeCallout();
            if (id !== null)
                openCallout(id);
        }
        function zoomToItem(namespace, item) {
            map?.setRegionAnimated(toRegion(namespace, { lat: item.lat, lng: item.lng }, componentProps.zoomSpan), true);
        }
        function applyItems() {
            const namespace = mapkit.value;
            if (!map || !pinLayer || !namespace)
                return;
            pinLayer.setItems(componentProps.items);
            if (componentProps.preserveRegion)
                return;
            overviewRegion = computeOverview(namespace);
            if (overviewRegion)
                map.setRegionAnimated(overviewRegion, true);
        }
        function initMap() {
            const namespace = mapkit.value;
            const container = containerRef.value;
            if (!namespace || !container || map)
                return;
            overviewRegion = computeOverview(namespace);
            const mapOptions = {
                colorScheme: resolveColorScheme(),
                isRotationEnabled: componentProps.isRotationEnabled,
                isScrollEnabled: componentProps.isScrollEnabled,
                isZoomEnabled: componentProps.isZoomEnabled,
                // K-3: `'muted'` is this library's spelling; MapKit's is `'mutedStandard'`.
                mapType: resolveMapKitMapType(componentProps.mapType),
                showsPointsOfInterest: componentProps.showsPointsOfInterest,
            };
            if (overviewRegion)
                mapOptions['region'] = overviewRegion;
            if (componentProps.clusteringIdentifier !== undefined &&
                componentProps.createClusterElement) {
                mapOptions['annotationForCluster'] = (cluster) => new namespace.Annotation(cluster.coordinate, () => componentProps.createClusterElement(cluster, cluster.memberAnnotations.length), { calloutEnabled: false });
            }
            map = new namespace.Map(container, mapOptions);
            pinLayer = new MapKitPinLayer({
                ...(componentProps.clusteringIdentifier === undefined
                    ? {}
                    : { clusteringIdentifier: componentProps.clusteringIdentifier }),
                ...(componentProps.createPinElement
                    ? {
                        createPinElement: (item, selected) => componentProps.createPinElement(item, selected),
                    }
                    : {}),
                ...(componentProps.itemLabel
                    ? { itemLabel: (item) => componentProps.itemLabel(item) }
                    : {}),
                // Read the live prop, not the function identity captured at init -- a
                // pinGeometry-only setProps would otherwise restyle nothing.
                itemKey: (item, index) => componentProps.itemKey(item, index),
                pinGeometry: (item) => componentProps.pinGeometry?.(item) ?? {},
                focusable: componentProps.pinsFocusable,
                map,
                mapkit: namespace,
                onSelect: select,
            });
            map.addEventListener('region-change-end', () => {
                const region = map?.region;
                if (!region)
                    return;
                emit('region-change', {
                    centerLat: region.center.latitude,
                    centerLng: region.center.longitude,
                    latDelta: region.span.latitudeDelta,
                    lngDelta: region.span.longitudeDelta,
                });
                overlayLayer?.resizeCirclesToRegion(region.span.latitudeDelta);
                calloutLayer?.reposition();
            });
            pinLayer.setItems(componentProps.items);
            applyOverlays();
            if (componentProps.selectedId !== null)
                applySelection(componentProps.selectedId);
            mapReady.value = true;
            // K-10: the namespace goes with the map. A value built from
            // `globalThis.mapkit` belongs to a different namespace and this map's own
            // instanceof checks reject it.
            emit('map-ready', map, namespace);
        }
        function applyOverlays() {
            const hasOverlayWork = (componentProps.geojson?.features.length ?? 0) > 0 || componentProps.circles.length > 0;
            if (!map || (!overlayLayer && !hasOverlayWork))
                return;
            const namespace = mapkit.value;
            if (!namespace)
                return;
            overlayLayer ??= new MapKitOverlayLayer({
                circleScaleFactor: componentProps.circleScaleFactor,
                dynamicCircleRadius: componentProps.dynamicCircleRadius,
                map: map,
                mapkit: namespace,
                maxCircleRadius: componentProps.maxCircleRadius,
                minCircleRadius: componentProps.minCircleRadius,
                ...(componentProps.overlayStyleFn ? { overlayStyleFn: componentProps.overlayStyleFn } : {}),
            });
            overlayLayer.setGeoJSON(componentProps.geojson);
            overlayLayer.setCircles(componentProps.circles);
        }
        function resolveColorScheme() {
            if (componentProps.colorScheme !== 'auto')
                return componentProps.colorScheme;
            return colorMode?.value === 'dark' ? 'dark' : 'light';
        }
        /**
         * K-11. Watching only `ready` with `immediate: true` runs the first
         * callback inside `setup()`, before the canvas ref is assigned. When
         * MapKit JS is already loaded (every `<AppMapKit>` after the first on a
         * page session) that call finds no container and `ready` never edges
         * again, so the host stays `loading` with no map. Watch both so init
         * runs when the later of the two arrives.
         */
        watch([() => ready.value, containerRef], ([isReady, container]) => {
            if (isReady && container) {
                try {
                    initMap();
                }
                catch (cause) {
                    report(cause);
                }
            }
        }, { flush: 'post', immediate: true });
        watch(() => componentProps.items, () => {
            try {
                assertPinLabelling(componentProps.items);
                applyItems();
            }
            catch (cause) {
                report(cause);
            }
        });
        watch(() => componentProps.selectedId, (id) => {
            applySelection(id);
            const namespace = mapkit.value;
            if (componentProps.suppressSelectionZoom || !map || !namespace)
                return;
            const item = id === null ? null : pinLayer?.itemFor(id);
            if (item)
                zoomToItem(namespace, item);
            else if (overviewRegion)
                map.setRegionAnimated(overviewRegion, true);
        });
        watch(() => [componentProps.geojson, componentProps.circles], () => {
            applyOverlays();
        });
        watch(() => [
            componentProps.createPinElement,
            componentProps.itemKey,
            componentProps.itemLabel,
            componentProps.pinGeometry,
        ], () => {
            try {
                applyItems();
            }
            catch (cause) {
                report(cause);
            }
        });
        /**
         * K-4. 2.1.0 applied `mapType` and `colorScheme` in the `mapkit.Map`
         * constructor and never again, so switching either prop on a mounted map
         * did nothing at all. The injected colour-mode source is watched with them:
         * without it `colorScheme: 'auto'` is only auto once, at construction.
         */
        watch(() => [componentProps.mapType, componentProps.colorScheme, colorMode?.value ?? null], () => {
            if (!map)
                return;
            try {
                applyMapKitBasemap(map, {
                    colorScheme: resolveColorScheme(),
                    mapType: componentProps.mapType,
                });
            }
            catch (cause) {
                report(cause);
            }
        });
        watch(() => failure.value, (value) => {
            if (value)
                emit('mapkit-error', value);
        });
        onBeforeUnmount(() => {
            calloutLayer?.destroy();
            calloutLayer = null;
            calloutEntries.value = [];
            overlayLayer?.destroy();
            overlayLayer = null;
            pinLayer?.destroy();
            pinLayer = null;
            map?.destroy();
            map = null;
        });
        function retry() {
            pinLayer?.destroy();
            pinLayer = null;
            overlayLayer?.destroy();
            overlayLayer = null;
            calloutLayer?.destroy();
            calloutLayer = null;
            calloutEntries.value = [];
            map?.destroy();
            map = null;
            mapReady.value = false;
            retryLoad();
        }
        expose({
            closeCallout,
            getDiagnostics: () => pinLayer?.getDiagnostics() ?? {
                annotations: 0,
                lastDiff: { added: [], moved: [], removed: [], restyled: [] },
            },
            getMap: () => map,
            /**
             * The namespace that built this map (2.1.1, K-10), for an app that has to
             * construct MapKit values itself. NEVER `globalThis.mapkit`.
             */
            getMapKit: () => mapkit.value,
            openCallout,
            retry,
            scrollIntoView: () => {
                containerRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
            select,
            setRegion: (center, span) => {
                const namespace = mapkit.value;
                if (!map || !namespace)
                    return;
                map.setRegionAnimated(toRegion(namespace, center, span ?? { lat: 0.01, lng: 0.01 }), true);
            },
            zoomToFit: (zoomOutLevels = 0) => {
                const namespace = mapkit.value;
                if (!map || !namespace)
                    return;
                const plain = mapKitBoundingRegion(framingPoints(), {
                    boundingPadding: componentProps.boundingPadding,
                    fallbackCenter: componentProps.fallbackCenter,
                    minSpanDelta: componentProps.minSpanDelta,
                });
                if (!plain)
                    return;
                const factor = 2 ** zoomOutLevels;
                map.setRegionAnimated(toRegion(namespace, plain.center, {
                    lat: plain.span.lat * factor,
                    lng: plain.span.lng * factor,
                }), true);
            },
        });
        return () => {
            const children = [];
            if (failure.value) {
                children.push(h('div', { class: 'mapkit-status', role: 'alert' }, slots.error?.({ failure: failure.value, retry }) ?? [
                    h('strong', 'Map unavailable'),
                    // Never the raw error: the code and a retry, per §c.4.
                    h('span', failure.value.status),
                    h('button', { onClick: retry, type: 'button' }, 'Try again'),
                ]));
            }
            else if (!ready.value) {
                children.push(h('div', { class: 'mapkit-status', role: 'status' }, slots.loading?.() ?? [h('span', 'Loading map…')]));
            }
            if (slots.fallback && failure.value?.source === 'mapkit') {
                children.push(h('div', { class: 'mapkit-fallback' }, slots.fallback()));
            }
            children.push(h('div', {
                class: 'mapkit-canvas',
                nonce: componentProps.nonce ?? injectedNonce ?? undefined,
                ref: containerRef,
            }));
            if (slots.default)
                children.push(...slots.default());
            for (const entry of calloutEntries.value) {
                if (!slots.callout)
                    break;
                children.push(h(Teleport, { key: entry.id, to: entry.host }, {
                    default: () => slots.callout?.({
                        close: () => {
                            closeCallout(entry.id);
                            if (componentProps.calloutFollowSelection)
                                select(null);
                        },
                        id: entry.id,
                        item: entry.item,
                        placement: entry.placement,
                        position: entry.position,
                    }),
                }));
            }
            return h('div', {
                'aria-label': componentProps.ariaLabel,
                class: 'mapkit-wrapper',
                'data-mapkit-state': state.value,
                ref: wrapperRef,
                role: 'region',
            }, children);
        };
    },
});
/**
 * Exported with a generic construct signature so an app's own item type flows
 * through `items`, `itemKey`, `itemLabel`, `createPinElement`, `pinGeometry` and
 * the `#callout` slot scope. The runtime props above cannot carry a type
 * parameter, so the generic surface is applied here, once.
 *
 * 2.1.0 re-typed `items` alone, which under `strictFunctionTypes` left every
 * callback rejecting the app's item type -- parameters are contravariant, so
 * `(item: Station) => string` is not assignable to `(item: MapKitPinItem) =>
 * string`. `tests/nuxt/app-map-kit-generic.test.ts` is the compile-time gate; a
 * runtime test cannot see this at all.
 */
export default AppMapKitImpl;
//# sourceMappingURL=AppMapKit.js.map