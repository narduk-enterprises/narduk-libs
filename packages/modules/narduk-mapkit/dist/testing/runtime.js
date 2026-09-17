/**
 * The entire fake, as ONE self-contained function.
 *
 * Every import above is `import type`, so `verbatimModuleSyntax` erases all of
 * them and the compiled function references nothing outside its own body. That
 * is what lets `createFakeMapKitRuntime.toString()` be injected verbatim into a
 * browser through `page.addInitScript()` with no bundler -- see
 * `fakeMapKitInitScript()` in `./index.ts`, and the round-trip test in
 * `tests/testing/init-script.test.ts` that evaluates the generated source in an
 * isolated realm and drives the resulting namespace.
 *
 * Do not add a value import to this file, do not reference a module-scope
 * constant from inside the function, and do not hoist a helper out of it.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- one function by design; see the note above.
export function createFakeMapKitRuntime(rawOptions = {}) {
    // ---------------------------------------------------------------- errors --
    class FakeMapKitNotImplemented extends Error {
        member;
        constructor(member) {
            super(`FakeMapKitNotImplemented: ${member}`);
            this.name = 'FakeMapKitNotImplemented';
            this.member = member;
        }
    }
    function notImplemented(member) {
        throw new FakeMapKitNotImplemented(member);
    }
    /**
     * Keys a test runner, a reactivity system or a promise resolver probes on an
     * arbitrary object. Answering `undefined` keeps the fidelity rule from firing
     * on machinery rather than on product code.
     */
    const probeKeys = new Set([
        '$$typeof',
        '__v_isReactive',
        '__v_isRef',
        '__v_raw',
        '__v_skip',
        'asymmetricMatch',
        'nodeName',
        'nodeType',
        'tagName',
        'then',
    ]);
    /**
     * The fidelity rule: reading or writing a member the fake does not model
     * throws instead of silently answering `undefined`.
     */
    function guard(target, label) {
        return new Proxy(target, {
            get(object, property) {
                if (typeof property === 'symbol')
                    return Reflect.get(object, property, object);
                if (property in object) {
                    const value = Reflect.get(object, property, object);
                    if (typeof value !== 'function')
                        return value;
                    // Constructors (own `prototype`) are handed back untouched so
                    // `instanceof` and identity survive. Everything else is bound to the
                    // real target: EventTarget's methods read internal slots a Proxy
                    // receiver does not have.
                    return Object.hasOwn(value, 'prototype')
                        ? value
                        : value.bind(object);
                }
                if (probeKeys.has(property))
                    return undefined;
                return notImplemented(`${label}.${property}`);
            },
            set(object, property, value) {
                if (typeof property === 'symbol' || property in object) {
                    return Reflect.set(object, property, value, object);
                }
                return notImplemented(`${label}.${property} (write)`);
            },
        });
    }
    // ---------------------------------------------------------------- options --
    const auth = rawOptions.auth ?? {};
    const authMode = auth.mode ?? 'accept';
    const bootstrapAttemptLimit = auth.bootstrapAttempts ?? 3;
    const accessKeyTtlMs = (auth.accessKeyTtlSeconds ?? 1800) * 1000;
    const onAccessKeyExpiry = auth.onAccessKeyExpiry ?? 'refresh';
    const pageOrigin = auth.origin ?? 'http://localhost:3000';
    const tokenOrigin = auth.expectedOrigin ?? 'http://localhost:4501';
    const errorStatus = auth.status ?? 'Unauthorized';
    const version = rawOptions.version ?? '6.0.128';
    const build = rawOptions.build ?? '6.0.128';
    const viewportWidth = rawOptions.viewport?.width ?? 800;
    const viewportHeight = rawOptions.viewport?.height ?? 600;
    const availableLibraries = [...(rawOptions.libraries ?? ['map', 'annotations', 'overlays'])];
    // ------------------------------------------------------------------ state --
    const operations = [];
    const tokens = [];
    const bootstrapAttempts = [];
    const configurationChanges = [];
    const errors = [];
    const annotationCounts = new Map();
    const liveMaps = [];
    const callouts = new WeakMap();
    let clock = 0;
    let tokenCalls = 0;
    let annotationsAdded = 0;
    let annotationsRemoved = 0;
    let annotationSequence = 0;
    let mapSequence = 0;
    let initialized = false;
    let initCalled = false;
    let accessKeyExpiresAt = null;
    let authorizationCallback;
    let loadedLibraries;
    const log = (name, annotationIds = [], detail = '') => {
        operations.push({ annotationIds, at: clock, detail, name });
    };
    const countsFor = (id) => {
        let entry = annotationCounts.get(id);
        if (!entry) {
            entry = { added: 0, deselected: 0, removed: 0, selected: 0 };
            annotationCounts.set(id, entry);
        }
        return entry;
    };
    /** The fake always assigns an id; Apple's type still allows null. */
    const idOf = (annotation) => annotation.id ?? '';
    // ---------------------------------------------------------------- the DOM --
    const documentOf = () => {
        const candidate = globalThis.document;
        if (!candidate) {
            throw new Error('fake MapKit needs a DOM to build map and annotation elements. Run this test under happy-dom or jsdom, or use the fake for token/auth assertions only.');
        }
        return candidate;
    };
    class FallbackPoint {
        x;
        y;
        z = 0;
        w = 1;
        constructor(x = 0, y = 0) {
            this.x = x;
            this.y = y;
        }
        toJSON() {
            return { w: this.w, x: this.x, y: this.y, z: this.z };
        }
        matrixTransform() {
            return notImplemented('DOMPoint.matrixTransform');
        }
    }
    const makePoint = (x, y) => {
        const ctor = globalThis.DOMPoint;
        return ctor ? new ctor(x, y) : new FallbackPoint(x, y);
    };
    // ------------------------------------------------------------ value types --
    class Coordinate {
        latitude;
        longitude;
        constructor(latitude = 0, longitude = 0) {
            this.latitude = latitude;
            this.longitude = longitude;
        }
        copy() {
            return new Coordinate(this.latitude, this.longitude);
        }
        equals(other) {
            return this.latitude === other.latitude && this.longitude === other.longitude;
        }
        toString() {
            return `<mapkit.Coordinate latitude=${this.latitude} longitude=${this.longitude}>`;
        }
    }
    class CoordinateSpan {
        latitudeDelta;
        longitudeDelta;
        constructor(latitudeDelta = 0, longitudeDelta = 0) {
            this.latitudeDelta = latitudeDelta;
            this.longitudeDelta = longitudeDelta;
        }
        copy() {
            return new CoordinateSpan(this.latitudeDelta, this.longitudeDelta);
        }
        equals(other) {
            return (this.latitudeDelta === other.latitudeDelta && this.longitudeDelta === other.longitudeDelta);
        }
        toString() {
            return `<mapkit.CoordinateSpan latitudeDelta=${this.latitudeDelta} longitudeDelta=${this.longitudeDelta}>`;
        }
    }
    class CoordinateRegion {
        center;
        span;
        constructor(center = new Coordinate(), span = new CoordinateSpan(1, 1)) {
            this.center = new Coordinate(center.latitude, center.longitude);
            this.span = new CoordinateSpan(span.latitudeDelta, span.longitudeDelta);
        }
        copy() {
            return new CoordinateRegion(this.center, this.span);
        }
        equals(other) {
            return this.center.equals(other.center) && this.span.equals(other.span);
        }
        toString() {
            return `<mapkit.CoordinateRegion center=${this.center.toString()} span=${this.span.toString()}>`;
        }
    }
    class Padding {
        top;
        right;
        bottom;
        left;
        constructor(padding) {
            if (padding !== undefined && typeof padding !== 'object') {
                notImplemented('mapkit.Padding (numeric constructor overloads)');
            }
            this.top = padding?.top ?? 0;
            this.right = padding?.right ?? 0;
            this.bottom = padding?.bottom ?? 0;
            this.left = padding?.left ?? 0;
        }
        copy() {
            return new Padding(this);
        }
        equals(other) {
            return (this.top === other.top &&
                this.right === other.right &&
                this.bottom === other.bottom &&
                this.left === other.left);
        }
    }
    // ------------------------------------------------- deterministic projection --
    /** Web-Mercator, clamped to the projection's own latitude limit. */
    const mercator = (latitude) => {
        const clamped = Math.max(-85.051_128_78, Math.min(85.051_128_78, latitude));
        return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
    };
    const project = (coordinate, region) => {
        const west = region.center.longitude - region.span.longitudeDelta / 2;
        const east = region.center.longitude + region.span.longitudeDelta / 2;
        const north = mercator(region.center.latitude + region.span.latitudeDelta / 2);
        const south = mercator(region.center.latitude - region.span.latitudeDelta / 2);
        const spanX = east - west;
        const spanY = north - south;
        return {
            x: spanX === 0 ? viewportWidth / 2 : ((coordinate.longitude - west) / spanX) * viewportWidth,
            y: spanY === 0
                ? viewportHeight / 2
                : ((north - mercator(coordinate.latitude)) / spanY) * viewportHeight,
        };
    };
    // ----------------------------------------------------------- annotations --
    const unmodelledAnnotationMembers = [
        'animates',
        'appearanceAnimation',
        'clusteringIdentifier',
        'collisionMode',
        'displayPriority',
        'draggable',
        'memberAnnotations',
        'padding',
        'selectionAccessory',
        'selectionAccessoryOffset',
    ];
    class Annotation extends EventTarget {
        accessibilityLabel;
        anchorOffset;
        callout;
        calloutEnabled;
        calloutOffset;
        coordinate;
        data;
        element;
        enabled;
        id;
        selected = false;
        size;
        subtitle;
        title;
        visible;
        /** Set by the map. Not part of Apple's writable surface here. */
        ownerMap = null;
        constructor(location, element, options = {}) {
            super();
            annotationSequence += 1;
            this.id = options.id ?? `fake-annotation-${annotationSequence}`;
            this.coordinate = new Coordinate(location.latitude, location.longitude);
            this.element = options.element ?? element;
            this.data = options.data ?? {};
            this.title = options.title ?? null;
            this.subtitle = options.subtitle ?? null;
            this.accessibilityLabel = options.accessibilityLabel ?? null;
            this.anchorOffset = options.anchorOffset ?? makePoint(0, 0);
            this.calloutOffset = options.calloutOffset ?? makePoint(0, 0);
            this.callout = options.callout ?? null;
            this.calloutEnabled = options.calloutEnabled ?? true;
            this.enabled = options.enabled ?? true;
            this.visible = options.visible ?? true;
            this.size = options.size ?? null;
            this.element.dataset['annotationId'] = this.id;
            this.element.style.position = 'absolute';
        }
        get map() {
            return this.ownerMap;
        }
    }
    for (const member of unmodelledAnnotationMembers) {
        Object.defineProperty(Annotation.prototype, member, {
            configurable: true,
            get: () => notImplemented(`mapkit.Annotation.${member}`),
            set: () => notImplemented(`mapkit.Annotation.${member} (write)`),
        });
    }
    const defaultElement = (className, text) => {
        const element = documentOf().createElement('div');
        element.className = className;
        if (text)
            element.textContent = text;
        return element;
    };
    class MarkerAnnotation extends Annotation {
        color;
        glyphColor;
        glyphText;
        constructor(location, options = {}) {
            super(location, defaultElement('fake-mapkit-marker', options.glyphText ?? ''), options);
            this.color = options.color ?? '#ff5b40';
            this.glyphColor = options.glyphColor ?? '#ffffff';
            this.glyphText = options.glyphText ?? null;
        }
    }
    class ImageAnnotation extends Annotation {
        url;
        constructor(location, options) {
            super(location, defaultElement('fake-mapkit-image-annotation', ''), options);
            this.url = options.url ?? {};
        }
    }
    const asAnnotation = (value) => value;
    // ------------------------------------------------------------------- map --
    const unmodelledMapMembers = [
        'addOverlay',
        'addOverlays',
        'addTileOverlay',
        'annotationForCluster',
        'annotationsInMapRect',
        'cameraBoundary',
        'cameraDistance',
        'cameraZoomRange',
        'colorScheme',
        'convertCoordinateToPointOnPage',
        'convertPointOnPageToCoordinate',
        'mapType',
        'overlays',
        'removeOverlay',
        'removeOverlays',
        'removeTileOverlay',
        'tileOverlays',
        'userLocationAnnotation',
        'visibleMapRect',
    ];
    const fireRegionChange = (map) => {
        map.dispatchEvent(new Event('region-change-start'));
        map.dispatchEvent(new Event('region-change-end'));
    };
    class AnnotationEvent extends Event {
        annotation;
        constructor(type, annotation) {
            super(type);
            this.annotation = annotation;
        }
    }
    class MapImpl extends EventTarget {
        element;
        /** The guarded view of `this`; what every public reference hands back. */
        view;
        regionValue;
        selectedValue = null;
        ownedAnnotations = [];
        destroyed = false;
        constructor(parent, options = {}) {
            super();
            mapSequence += 1;
            const doc = documentOf();
            const host = typeof parent === 'string'
                ? doc.getElementById(parent)
                : (parent ?? doc.createElement('div'));
            if (!host)
                throw new Error(`fake MapKit: no element with id "${String(parent)}" to attach the map to`);
            const element = doc.createElement('div');
            element.className = 'fake-mapkit-map';
            element.dataset['mapId'] = `fake-map-${mapSequence}`;
            element.style.position = 'relative';
            element.style.width = `${viewportWidth}px`;
            element.style.height = `${viewportHeight}px`;
            host.append(element);
            this.element = element;
            this.regionValue = options.region
                ? new CoordinateRegion(options.region.center, options.region.span)
                : new CoordinateRegion(options.center ?? new Coordinate(), new CoordinateSpan(1, 1));
            this.view = guard(this, 'mapkit.Map');
        }
        get annotations() {
            return [...this.ownedAnnotations];
        }
        set annotations(next) {
            // Real MapKit replaces wholesale here. Logged under its own name so a
            // budget test can see a full rebuild that `addAnnotations` would hide.
            log('annotations=', next.map(idOf), `${this.ownedAnnotations.length} -> ${next.length}`);
            this.removeAnnotations([...this.ownedAnnotations]);
            this.addAnnotations(next);
        }
        get region() {
            return this.regionValue.copy();
        }
        set region(next) {
            log('region=');
            this.applyRegion(next);
            fireRegionChange(this);
        }
        get selectedAnnotation() {
            return this.selectedValue;
        }
        set selectedAnnotation(next) {
            log('selectedAnnotation=', next ? [idOf(next)] : []);
            this.applySelection(next);
        }
        applyRegion(next) {
            this.regionValue = new CoordinateRegion(next.center, next.span);
            for (const annotation of this.ownedAnnotations)
                this.place(annotation);
        }
        place(annotation) {
            const point = project(annotation.coordinate, this.regionValue);
            const element = annotation.element;
            element.style.left = `${point.x + annotation.anchorOffset.x}px`;
            element.style.top = `${point.y + annotation.anchorOffset.y}px`;
        }
        applySelection(next) {
            const previous = this.selectedValue;
            if (previous === next)
                return;
            if (previous) {
                previous.selected = false;
                this.removeCallout(previous);
                countsFor(idOf(previous)).deselected += 1;
                log('deselect', [idOf(previous)]);
                this.dispatchEvent(new AnnotationEvent('deselect', previous));
            }
            this.selectedValue = next;
            if (next) {
                next.selected = true;
                countsFor(idOf(next)).selected += 1;
                log('select', [idOf(next)]);
                this.dispatchEvent(new AnnotationEvent('select', next));
                this.renderCallout(next);
            }
        }
        renderCallout(annotation) {
            if (!annotation.calloutEnabled)
                return;
            const delegate = annotation.callout;
            if (delegate?.calloutShouldAppearForAnnotation?.(annotation) === false)
                return;
            let element;
            if (delegate?.calloutElementForAnnotation) {
                element = delegate.calloutElementForAnnotation(annotation);
            }
            else {
                element = documentOf().createElement('div');
                element.className = 'fake-mapkit-callout';
                const content = delegate?.calloutContentForAnnotation?.(annotation);
                if (content)
                    element.append(content);
                else
                    element.textContent = annotation.title ?? idOf(annotation);
            }
            element.dataset['calloutFor'] = idOf(annotation);
            const size = annotation.size ?? { height: 0, width: 0 };
            const offset = delegate?.calloutAnchorOffsetForAnnotation?.(annotation, size) ?? annotation.calloutOffset;
            const point = project(annotation.coordinate, this.regionValue);
            element.style.position = 'absolute';
            element.style.left = `${point.x + offset.x}px`;
            element.style.top = `${point.y + offset.y}px`;
            this.element?.append(element);
            callouts.set(annotation, element);
            log('callout-render', [idOf(annotation)]);
        }
        removeCallout(annotation) {
            const element = callouts.get(annotation);
            if (!element)
                return;
            element.remove();
            callouts.delete(annotation);
            log('callout-remove', [idOf(annotation)]);
        }
        attach(annotation) {
            asAnnotation(annotation).ownerMap = this.view;
            this.ownedAnnotations.push(annotation);
            this.place(annotation);
            this.element?.append(annotation.element);
            annotationsAdded += 1;
            countsFor(idOf(annotation)).added += 1;
        }
        detach(annotation) {
            const index = this.ownedAnnotations.indexOf(annotation);
            if (index >= 0)
                this.ownedAnnotations.splice(index, 1);
            if (this.selectedValue === annotation)
                this.applySelection(null);
            this.removeCallout(annotation);
            asAnnotation(annotation).ownerMap = null;
            annotation.element.remove();
            annotationsRemoved += 1;
            countsFor(idOf(annotation)).removed += 1;
        }
        addAnnotation(annotation) {
            log('addAnnotation', [idOf(annotation)]);
            if (this.ownedAnnotations.includes(annotation))
                return null;
            this.attach(annotation);
            return annotation;
        }
        addAnnotations(annotations) {
            log('addAnnotations', annotations.map(idOf), String(annotations.length));
            for (const annotation of annotations) {
                if (!this.ownedAnnotations.includes(annotation))
                    this.attach(annotation);
            }
            return annotations;
        }
        removeAnnotation(annotation) {
            log('removeAnnotation', [idOf(annotation)]);
            this.detach(annotation);
            return annotation;
        }
        removeAnnotations(annotations) {
            log('removeAnnotations', annotations.map(idOf), String(annotations.length));
            for (const annotation of annotations)
                this.detach(annotation);
            return annotations;
        }
        setRegionAnimated(region, _animated) {
            log('setRegionAnimated');
            this.applyRegion(region);
            fireRegionChange(this);
            return this.view;
        }
        setCenterAnimated(coordinate, _animated) {
            log('setCenterAnimated');
            this.applyRegion({ center: coordinate, span: this.regionValue.span });
            fireRegionChange(this);
            return this.view;
        }
        showItems(items, options = {}) {
            log('showItems', items.map(idOf), String(items.length));
            if (items.length === 0)
                return items;
            let minLatitude = Number.POSITIVE_INFINITY;
            let maxLatitude = Number.NEGATIVE_INFINITY;
            let minLongitude = Number.POSITIVE_INFINITY;
            let maxLongitude = Number.NEGATIVE_INFINITY;
            for (const item of items) {
                minLatitude = Math.min(minLatitude, item.coordinate.latitude);
                maxLatitude = Math.max(maxLatitude, item.coordinate.latitude);
                minLongitude = Math.min(minLongitude, item.coordinate.longitude);
                maxLongitude = Math.max(maxLongitude, item.coordinate.longitude);
            }
            const span = new CoordinateSpan(Math.max(maxLatitude - minLatitude, options.minimumSpan?.latitudeDelta ?? 0.01), Math.max(maxLongitude - minLongitude, options.minimumSpan?.longitudeDelta ?? 0.01));
            const center = new Coordinate((minLatitude + maxLatitude) / 2, (minLongitude + maxLongitude) / 2);
            this.applyRegion({ center, span });
            fireRegionChange(this);
            return items;
        }
        destroy() {
            if (this.destroyed)
                return;
            log('Map.destroy');
            this.destroyed = true;
            this.applySelection(null);
            for (const annotation of [...this.ownedAnnotations])
                this.detach(annotation);
            this.element?.remove();
            const index = liveMaps.indexOf(this.view);
            if (index >= 0)
                liveMaps.splice(index, 1);
        }
    }
    for (const member of unmodelledMapMembers) {
        Object.defineProperty(MapImpl.prototype, member, {
            configurable: true,
            get: () => notImplemented(`mapkit.Map.${member}`),
            set: () => notImplemented(`mapkit.Map.${member} (write)`),
        });
    }
    // ------------------------------------------------------- auth state machine --
    class ConfigurationChangeEvent extends Event {
        status;
        constructor(status) {
            super('configuration-change');
            this.status = status;
        }
    }
    class ConfigurationErrorEvent extends Event {
        message;
        status;
        constructor(status, message) {
            super('error');
            this.status = status;
            this.message = message;
        }
    }
    const failureMessage = () => auth.message ??
        (authMode === 'wrong-origin'
            ? // The suffix is verbatim from the 2026-09-17 measurement against Apple.
                // Whatever real MapKit prefixes it with was not captured, so the fake
                // does not invent one.
                `Origin does not match - expected: ${tokenOrigin}, actual: ${pageOrigin}`
            : 'Initialization failed.');
    const failureStatus = () => authMode === 'wrong-origin' ? 'Unauthorized' : errorStatus;
    const succeed = () => {
        accessKeyExpiresAt = clock + accessKeyTtlMs;
        const status = initialized ? 'Refreshed' : 'Initialized';
        initialized = true;
        configurationChanges.push(status);
        log('configuration-change', [], status);
        namespaceTarget.dispatchEvent(new ConfigurationChangeEvent(status));
    };
    const fail = (status, message) => {
        accessKeyExpiresAt = null;
        errors.push({ message, status });
        log('error', [], status);
        namespaceTarget.dispatchEvent(new ConfigurationErrorEvent(status, message));
    };
    /**
     * One token exchange. `accept` bootstraps once; every failing mode re-sends
     * the SAME token `bootstrapAttemptLimit` times before giving up -- the shape
     * measured against Apple on 2026-09-17, and the reason MapKit never
     * self-heals from a bad token.
     */
    const exchange = (token) => {
        const tokenIndex = tokens.push(token) - 1;
        if (authMode === 'accept') {
            bootstrapAttempts.push({ attempt: 1, tokenIndex });
            log('bootstrap', [], `attempt 1 token#${tokenIndex}`);
            succeed();
            return;
        }
        for (let attempt = 1; attempt <= bootstrapAttemptLimit; attempt += 1) {
            bootstrapAttempts.push({ attempt, tokenIndex });
            log('bootstrap', [], `attempt ${attempt} token#${tokenIndex}`);
        }
        fail(failureStatus(), failureMessage());
    };
    const requestToken = () => {
        const callback = authorizationCallback;
        if (!callback) {
            fail('Unauthorized', 'No authorizationCallback was supplied to mapkit.init().');
            return;
        }
        tokenCalls += 1;
        log('authorizationCallback', [], String(tokenCalls));
        let settled = false;
        callback.call(null, (token) => {
            if (settled)
                return;
            settled = true;
            exchange(token);
        });
    };
    // -------------------------------------------------------------- namespace --
    // Stable constructors: created once, so `instanceof` and identity behave the
    // way they do on the real namespace.
    const MapConstructor = function FakeMap(parent, options) {
        log('Map');
        const instance = new MapImpl(parent, options);
        liveMaps.push(instance.view);
        return instance.view;
    };
    const AnnotationConstructor = function FakeAnnotation(location, factory, options = {}) {
        log('Annotation');
        return new Annotation(location, factory(new Coordinate(location.latitude, location.longitude), options), options);
    };
    const MarkerAnnotationConstructor = function FakeMarkerAnnotation(location, options) {
        log('MarkerAnnotation');
        return new MarkerAnnotation(location, options);
    };
    const ImageAnnotationConstructor = function FakeImageAnnotation(location, options) {
        log('ImageAnnotation');
        return new ImageAnnotation(location, options);
    };
    const unmodelledNamespaceMembers = [
        'BoundingRegion',
        'CameraZoomRange',
        'CircleOverlay',
        'Directions',
        'FeatureVisibility',
        'Geocoder',
        'Libraries',
        'LineGradient',
        'MapFeatureType',
        'MapPoint',
        'MapRect',
        'MapSize',
        'PlaceAnnotation',
        'PlaceLookup',
        'PointsOfInterestSearch',
        'PolygonOverlay',
        'PolylineOverlay',
        'Search',
        'Style',
        'TileOverlay',
        'importGeoJSON',
    ];
    class NamespaceImpl extends EventTarget {
        language;
        version = version;
        build = build;
        Coordinate = Coordinate;
        CoordinateSpan = CoordinateSpan;
        CoordinateRegion = CoordinateRegion;
        Padding = Padding;
        constructor() {
            super();
            this.language = rawOptions.language ?? 'en';
        }
        get loadedLibraries() {
            return loadedLibraries ? [...loadedLibraries] : undefined;
        }
        get maps() {
            return [...liveMaps];
        }
        requireLibrary(library, member, value) {
            if (!(loadedLibraries ?? availableLibraries).includes(library)) {
                throw new Error(`[MapKit] mapkit.${member} is available after loading the following library: ${library}.`);
            }
            return value;
        }
        get Map() {
            return this.requireLibrary('map', 'Map', MapConstructor);
        }
        get Annotation() {
            return this.requireLibrary('annotations', 'Annotation', AnnotationConstructor);
        }
        get MarkerAnnotation() {
            return this.requireLibrary('annotations', 'MarkerAnnotation', MarkerAnnotationConstructor);
        }
        get ImageAnnotation() {
            return this.requireLibrary('annotations', 'ImageAnnotation', ImageAnnotationConstructor);
        }
        init(options) {
            log('init');
            if (initCalled) {
                notImplemented('mapkit.init (called twice on one namespace)');
            }
            initCalled = true;
            if (options.language)
                this.language = options.language;
            if (options.libraries)
                loadedLibraries = [...options.libraries];
            authorizationCallback = options.authorizationCallback;
            requestToken();
        }
        load(libraryNames) {
            const requested = typeof libraryNames === 'string' ? [libraryNames] : [...libraryNames];
            log('load', [], requested.join(','));
            const missing = requested.filter((library) => !availableLibraries.includes(library));
            if (missing.length > 0) {
                return Promise.reject(new Error(`[MapKit] Unknown library: ${missing.join(', ')}`));
            }
            loadedLibraries = [...new Set([...(loadedLibraries ?? []), ...requested])];
            return Promise.resolve(namespace);
        }
    }
    for (const member of unmodelledNamespaceMembers) {
        Object.defineProperty(NamespaceImpl.prototype, member, {
            configurable: true,
            get: () => notImplemented(`mapkit.${member}`),
            set: () => notImplemented(`mapkit.${member} (write)`),
        });
    }
    const namespaceTarget = new NamespaceImpl();
    const namespace = guard(namespaceTarget, 'mapkit');
    // ------------------------------------------------------ loader-shaped load --
    const load = (options = {}) => {
        log('load', [], (options.libraries ?? []).join(','));
        if (options.version && !options.version.startsWith('6')) {
            return Promise.reject(new Error(`Unsupported MapKit JS version: ${options.version}`));
        }
        const requested = options.libraries ?? availableLibraries;
        const missing = requested.filter((library) => !availableLibraries.includes(library));
        if (missing.length > 0) {
            return Promise.reject(new Error(`[MapKit] Unknown library: ${missing.join(', ')}`));
        }
        loadedLibraries = [...requested];
        if (options.language)
            namespaceTarget.language = options.language;
        if (options.token !== undefined) {
            // `load({ token })` is MapKit's static, non-refreshable path: the token
            // goes on the script tag and there is never an authorizationCallback.
            exchange(options.token);
        }
        return Promise.resolve(namespace);
    };
    // ------------------------------------------------------------- inspection --
    const inspect = {
        get annotationsAdded() {
            return annotationsAdded;
        },
        get annotationsRemoved() {
            return annotationsRemoved;
        },
        get bootstrapAttempts() {
            return [...bootstrapAttempts];
        },
        get configurationChanges() {
            return [...configurationChanges];
        },
        get errors() {
            return [...errors];
        },
        get maps() {
            return [...liveMaps];
        },
        get now() {
            return clock;
        },
        get operations() {
            return [...operations];
        },
        get tokenCalls() {
            return tokenCalls;
        },
        get tokens() {
            return [...tokens];
        },
        advanceClock(milliseconds) {
            if (milliseconds < 0)
                throw new Error('fake MapKit clock only moves forward');
            clock += milliseconds;
            if (accessKeyExpiresAt === null || clock < accessKeyExpiresAt)
                return;
            accessKeyExpiresAt = null;
            if (onAccessKeyExpiry === 'nothing')
                return;
            if (onAccessKeyExpiry === 'error') {
                fail(errorStatus, auth.message ?? 'The access key expired.');
                return;
            }
            requestToken();
        },
        annotationCounts(annotation) {
            const id = typeof annotation === 'string' ? annotation : (annotation.id ?? '');
            const entry = annotationCounts.get(id);
            return entry ? { ...entry } : { added: 0, deselected: 0, removed: 0, selected: 0 };
        },
        calloutElement(annotation) {
            return callouts.get(annotation) ?? null;
        },
        count(name) {
            return operations.filter((operation) => operation.name === name).length;
        },
        deselectAnnotation(map) {
            ;
            map.applySelection(null);
        },
        reset() {
            operations.length = 0;
            tokens.length = 0;
            bootstrapAttempts.length = 0;
            configurationChanges.length = 0;
            errors.length = 0;
            annotationCounts.clear();
            tokenCalls = 0;
            annotationsAdded = 0;
            annotationsRemoved = 0;
        },
        selectAnnotation(map, annotation) {
            ;
            map.applySelection(annotation);
        },
    };
    return { inspect, load, mapkit: namespace };
}
//# sourceMappingURL=runtime.js.map