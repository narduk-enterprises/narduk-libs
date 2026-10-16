/**
 * Moving markers: vehicles (or people, boats, aircraft) that report a new
 * position every few seconds and should glide between fixes instead of jumping.
 *
 * Extracted from the Wave Transit concept's live bus layer. It is deliberately
 * not a pin layer: a layer that clusters everything it holds would swallow a
 * moving marker in a count bubble. This one adds, moves and removes annotations
 * by id, so a poll that finds the same markers only nudges them, and a marker
 * that stops reporting disappears at once.
 *
 * ## What it does
 *
 * - **One `requestAnimationFrame` loop** for all markers. Each glides from where
 *   it is *drawn* (not where it last reported) to the new fix over `glideMs`,
 *   linearly, along its route line when it is on one (`lines`).
 * - **Snap rules** (see `mapKitSnapReason`): a first fix, a jump too long to be
 *   one poll's travel, a tab that was hidden, and `prefers-reduced-motion` draw
 *   the new place at once. Returning to a hidden tab finishes every glide
 *   instead of sweeping.
 * - **Heading**, shortest-angle unwrapped, from the route line where there is
 *   one and from the move otherwise; ignored below `minHeadingMoveMetres`. Written
 *   as `--mapkit-heading` (degrees, may pass 360) and `data-mapkit-heading`.
 * - **Tiers**: `setTier('dot' | 'symbol' | 'detail' | ...)` writes
 *   `data-mapkit-tier` on every host, so CSS owns the look. Pair it with
 *   `chooseMapKitMarkerTier`.
 * - **Follow camera**: `follow(id)` keeps the map centred on one marker as it
 *   glides, and lets go as soon as the user scrolls or zooms.
 * - **Accessible hit area**: a host that is at least `hitArea` px square over a
 *   smaller glyph (`expandMapKitHitArea`), focusable with a label.
 *
 * MapKit is reached through the structural types below, so the same fake that
 * drives `<AppMapKit>`'s tests drives this, and so does a hand-written one.
 */
import { expandMapKitHitArea, mapKitAnchorOffset } from '../nuxt/runtime/pin-geometry.js';
import { haversineDistanceMetres } from '../geometry/helpers.js';
import { MAPKIT_GLIDE_MS, MAPKIT_MIN_HEADING_MOVE_METRES, bearingDegrees, interpolateLatLng, mapKitSnapReason, normalizeHeading, pathAlongPolylines, pathEndHeading, pointAlongPath, unwrapHeading, } from '../geometry/motion.js';
import { writeMapKitHitArea } from './hit-area.js';
import { defaultMapKitFrameScheduler } from './timers.js';
const DEFAULT_SIZE = { height: 48, width: 48 };
const NO_PADDING = { bottom: 0, left: 0, right: 0, top: 0 };
const USER_GESTURES = ['scroll-start', 'zoom-start', 'rotation-start'];
export class MapKitMovingMarkerLayer {
    #document;
    #entries = new Map();
    #frames;
    #hidden;
    #now;
    #options;
    #reducedMotion;
    #destroyed = false;
    #followId = null;
    #frame = 0;
    #selectedId = null;
    #tier = 'symbol';
    #wasHidden = false;
    #onVisibility = () => {
        if (this.#hidden()) {
            this.#wasHidden = true;
            this.#stopLoop();
        }
        else {
            // Back on the tab: nothing sweeps across the map; every marker is drawn at its fix.
            this.#finishAll();
        }
    };
    #onUserGesture = () => {
        this.follow(null);
    };
    constructor(options) {
        this.#options = options;
        this.#document = options.document ?? globalThis.document;
        this.#frames = options.frames ?? defaultMapKitFrameScheduler;
        this.#now = options.now ?? (() => performance.now());
        this.#hidden =
            options.hidden ?? (() => this.#document?.hidden === true);
        this.#reducedMotion =
            options.reducedMotion ??
                (() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
        this.#document?.addEventListener('visibilitychange', this.#onVisibility);
    }
    get size() {
        return this.#entries.size;
    }
    /** How many markers are mid-glide. */
    get gliding() {
        let count = 0;
        for (const entry of this.#entries.values())
            if (entry.glide)
                count++;
        return count;
    }
    get tier() {
        return this.#tier;
    }
    get followedId() {
        return this.#followId;
    }
    /** The position drawn for a marker now (mid-glide), or `undefined` for an unknown id. */
    positionOf(id) {
        return this.#entries.get(id)?.shown;
    }
    /** The host element for a marker, once MapKit has rendered it. */
    hostFor(id) {
        return this.#entries.get(id)?.host;
    }
    /** Draw every marker in `tier`; a marker added later is drawn in it too. */
    setTier(tier) {
        if (tier === this.#tier)
            return;
        this.#tier = tier;
        for (const entry of this.#entries.values()) {
            this.#applyGeometry(entry);
            if (entry.host)
                entry.host.setAttribute('data-mapkit-tier', tier);
        }
    }
    /** Mark one marker selected (`aria-pressed`, `data-mapkit-selected`). */
    setSelected(id) {
        if (id === this.#selectedId)
            return;
        const previous = this.#selectedId;
        this.#selectedId = id;
        for (const key of [previous, id]) {
            if (key === null)
                continue;
            const entry = this.#entries.get(key);
            if (entry?.host)
                this.#writeSelected(entry.host, key === id);
        }
    }
    /**
     * Keep the camera centred on one marker as it glides, until the user scrolls
     * or zooms (or the marker goes away). `null` stops following. Returns whether
     * the id is a known marker.
     */
    follow(id) {
        const ended = this.#followId;
        if (id === null || !this.#entries.has(id)) {
            if (ended !== null)
                this.#endFollow(ended);
            return id === null;
        }
        if (ended === id)
            return true;
        this.#followId = id;
        const { map } = this.#options;
        for (const type of USER_GESTURES)
            map.addEventListener?.(type, this.#onUserGesture);
        const shown = this.#entries.get(id).shown;
        map.setCenterAnimated?.(this.#coordinate(shown), true);
        return true;
    }
    /** Make the map show exactly `markers`. */
    set(markers) {
        if (this.#destroyed)
            return;
        const wanted = new Map(markers.map((marker) => [marker.id, marker]));
        const gone = [];
        for (const [id, entry] of this.#entries) {
            if (wanted.has(id))
                continue;
            entry.cleanup?.();
            gone.push(entry.annotation);
            this.#entries.delete(id);
            if (this.#followId === id)
                this.#endFollow(id);
        }
        const hidden = this.#wasHidden || this.#hidden();
        const added = [];
        for (const marker of markers) {
            const known = this.#entries.get(marker.id);
            if (known) {
                this.#move(known, marker, hidden);
                continue;
            }
            added.push(this.#add(marker));
        }
        if (gone.length > 0)
            this.#options.map.removeAnnotations(gone);
        if (added.length > 0)
            this.#options.map.addAnnotations(added);
        if (!this.#hidden())
            this.#wasHidden = false;
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#stopLoop();
        this.#document?.removeEventListener('visibilitychange', this.#onVisibility);
        if (this.#followId !== null)
            this.#endFollow(this.#followId);
        this.set([]);
        this.#destroyed = true;
    }
    #coordinate(at) {
        return new this.#options.mapkit.Coordinate(at.lat, at.lng);
    }
    #geometryFor() {
        const configured = this.#options.geometry;
        const base = typeof configured === 'function'
            ? configured(this.#tier)
            : (configured ?? { anchor: 'center', size: DEFAULT_SIZE });
        const hitArea = this.#options.hitArea;
        if (hitArea === undefined || hitArea === false)
            return { geometry: base, padding: NO_PADDING };
        return expandMapKitHitArea(base, hitArea === true ? undefined : hitArea);
    }
    #applyGeometry(entry) {
        const { geometry, padding } = this.#geometryFor();
        entry.geometry = geometry;
        entry.padding = padding;
        const offset = mapKitAnchorOffset(geometry);
        entry.annotation.anchorOffset = new DOMPoint(offset.x, offset.y);
        entry.annotation.size = geometry.size
            ? { height: geometry.size.height, width: geometry.size.width }
            : null;
        if (entry.host)
            writeMapKitHitArea(entry.host, geometry, padding);
    }
    #add(marker) {
        const { geometry, padding } = this.#geometryFor();
        const offset = mapKitAnchorOffset(geometry);
        const entry = {
            annotation: undefined,
            cleanup: undefined,
            geometry,
            glide: undefined,
            heading: undefined,
            host: undefined,
            marker,
            padding,
            renderKey: this.#options.renderKey?.(marker) ?? '',
            shown: { lat: marker.lat, lng: marker.lng },
        };
        const options = {
            anchorOffset: new DOMPoint(offset.x, offset.y),
            calloutEnabled: false,
            data: { movingMarker: marker.id },
            displayPriority: this.#options.displayPriority ?? 1000,
        };
        if (geometry.size)
            options['size'] = { height: geometry.size.height, width: geometry.size.width };
        entry.annotation = new this.#options.mapkit.Annotation(this.#coordinate(entry.shown), () => this.#buildHost(entry), options);
        this.#entries.set(marker.id, entry);
        return entry.annotation;
    }
    #buildHost(entry) {
        const { marker } = entry;
        const host = this.#document.createElement('span');
        host.setAttribute('data-mapkit-moving', marker.id);
        host.setAttribute('data-mapkit-tier', this.#tier);
        entry.host = host;
        const label = this.#options.label?.(marker);
        if (label !== undefined) {
            host.setAttribute('role', 'button');
            host.setAttribute('tabindex', '0');
            host.setAttribute('aria-label', label);
            host.style.cursor = 'pointer';
            const activate = (via) => {
                this.#options.onSelect?.(this.#selectedId === marker.id ? null : marker.id, via);
            };
            host.addEventListener('click', (event) => {
                event.stopPropagation();
                activate('pointer');
            });
            host.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar')
                    return;
                event.preventDefault();
                event.stopPropagation();
                activate('keyboard');
            });
            this.#writeSelected(host, this.#selectedId === marker.id);
        }
        this.#renderGlyph(entry);
        this.#applyHeading(entry);
        writeMapKitHitArea(host, entry.geometry, entry.padding);
        return host;
    }
    #renderGlyph(entry) {
        const { host } = entry;
        if (!host)
            return;
        entry.cleanup?.();
        const made = this.#options.createElement(entry.marker, this.#tier);
        const glyph = 'element' in made ? made : { element: made };
        entry.cleanup = glyph.cleanup;
        host.replaceChildren(glyph.element);
    }
    #writeSelected(host, selected) {
        if (host.hasAttribute('role'))
            host.setAttribute('aria-pressed', selected ? 'true' : 'false');
        if (selected)
            host.setAttribute('data-mapkit-selected', '');
        else
            host.removeAttribute('data-mapkit-selected');
    }
    #applyHeading(entry) {
        if (this.#options.heading === false || !entry.host || entry.heading === undefined)
            return;
        entry.host.setAttribute('data-mapkit-heading', String(Math.round(normalizeHeading(entry.heading))));
        entry.host.style.setProperty('--mapkit-heading', `${String(entry.heading)}deg`);
    }
    #move(entry, marker, hidden) {
        const previous = entry.marker;
        entry.marker = marker;
        const key = this.#options.renderKey?.(marker);
        if (key !== undefined && key !== entry.renderKey) {
            entry.renderKey = key;
            this.#renderGlyph(entry);
        }
        if (previous.lat === marker.lat && previous.lng === marker.lng)
            return;
        const from = entry.shown;
        const to = { lat: marker.lat, lng: marker.lng };
        const lines = this.#options.lines?.(marker) ?? [];
        const snap = this.#snapReason(from, to, hidden);
        const path = snap === null && lines.length > 0 ? pathAlongPolylines(lines, from, to) : null;
        const minMove = this.#options.minHeadingMoveMetres ?? MAPKIT_MIN_HEADING_MOVE_METRES;
        if (haversineDistanceMetres(previous, marker) >= minMove) {
            const target = (path ? pathEndHeading(path) : null) ?? bearingDegrees(previous, marker);
            entry.heading = unwrapHeading(entry.heading, target);
            this.#applyHeading(entry);
        }
        if (snap !== null) {
            entry.glide = undefined;
            this.#draw(entry, to);
            return;
        }
        entry.glide = { from, path, start: this.#now(), to };
        this.#startLoop();
    }
    #snapReason(from, to, hidden) {
        return mapKitSnapReason(from, to, {
            hidden,
            maxGlideMetres: this.#options.maxGlideMetres ?? 1500,
            reducedMotion: this.#reducedMotion(),
        });
    }
    #draw(entry, at) {
        entry.shown = at;
        entry.annotation.coordinate = this.#coordinate(at);
        if (this.#followId === entry.marker.id) {
            this.#options.map.setCenterAnimated?.(this.#coordinate(at), false);
        }
    }
    #startLoop() {
        if (this.#frame !== 0 || this.#hidden())
            return;
        this.#frame = this.#frames.requestAnimationFrame(this.#tick);
    }
    #stopLoop() {
        if (this.#frame !== 0)
            this.#frames.cancelAnimationFrame(this.#frame);
        this.#frame = 0;
    }
    /** One loop for every marker: advance each glide, and stop when none is left. */
    #tick = () => {
        this.#frame = 0;
        const now = this.#now();
        const glideMs = this.#options.glideMs ?? MAPKIT_GLIDE_MS;
        let live = false;
        for (const entry of this.#entries.values()) {
            const glide = entry.glide;
            if (!glide)
                continue;
            const t = (now - glide.start) / glideMs;
            if (t >= 1) {
                entry.glide = undefined;
                this.#draw(entry, glide.to);
                continue;
            }
            this.#draw(entry, glide.path ? pointAlongPath(glide.path, t) : interpolateLatLng(glide.from, glide.to, t));
            live = true;
        }
        if (live)
            this.#startLoop();
    };
    #finishAll() {
        for (const entry of this.#entries.values()) {
            if (!entry.glide)
                continue;
            const to = entry.glide.to;
            entry.glide = undefined;
            this.#draw(entry, to);
        }
    }
    #endFollow(id) {
        this.#followId = null;
        for (const type of USER_GESTURES) {
            this.#options.map.removeEventListener?.(type, this.#onUserGesture);
        }
        this.#options.onFollowEnd?.(id);
    }
}
export function createMapKitMovingMarkerLayer(options) {
    return new MapKitMovingMarkerLayer(options);
}
//# sourceMappingURL=moving-markers.js.map