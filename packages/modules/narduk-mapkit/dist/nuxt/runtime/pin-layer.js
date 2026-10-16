/**
 * The keyed pin layer: `<AppMapKit>`'s annotation seam, with no Vue in it.
 *
 * ## Why this is a controller and not component code
 *
 * Two consumers (gonogo and earthdata) drive MapKit from plain TypeScript, and
 * the 2.1.0 contract (narduk-libs#422) requires the seam to hold without Vue. So
 * everything that decides *what the map is told* lives here and is exercised by
 * `tests/nuxt/pin-layer.test.ts` with no component mounted; `AppMapKit` only
 * turns props and watchers into calls on this object.
 *
 * ## The buoys#112 root cause
 *
 * 2.0.x rebuilt every annotation on every `items` change **and on every
 * selection change**: `rebuildAnnotations()` removed all N and added all N. On a
 * 570-pin mobile map that destroyed the DOM node the user had just tapped, so
 * the callout's "View details" link never survived long enough to be pressed.
 *
 * Here:
 *
 * - `setItems()` reconciles by key. An unchanged pin is not touched at all; a
 *   moved or restyled pin is updated **in place**, keeping its annotation object
 *   identity and its DOM host; only genuinely new keys are added and genuinely
 *   absent keys removed. Initial render of N items is exactly one
 *   `addAnnotations` call.
 * - `setSelected()` performs **zero** adds and **zero** removes. It re-renders
 *   exactly the outgoing and incoming glyphs inside hosts that persist, so
 *   `document.activeElement` survives a selection change.
 *
 * ## Who owns which element
 *
 * The library owns the **host**: a `role="button"`, `tabindex="0"` element
 * carrying the accessible name, `aria-pressed`, the click and Enter/Space
 * handlers, and the test hooks. The app owns the **glyph** only, returned by
 * `createPinElement`. That split is what makes every pin Tab-reachable without
 * every app re-implementing it -- the third defect the 2.1.0 fake pinned.
 */
import { MapKitAnnotationRegistry } from '../../client/annotations.js';
import { MapKitHoverTooltip } from '../../client/hover-tooltip.js';
import { nextMapKitRovingKey } from '../../geometry/roving.js';
import { MAPKIT_MIN_HIT_TARGET, expandMapKitHitArea, mapKitAnchorOffset, mapKitPinGeometrySignature, } from './pin-geometry.js';
const ROVING_KEYS = {
    ArrowDown: 'south',
    ArrowLeft: 'west',
    ArrowRight: 'east',
    ArrowUp: 'north',
    End: 'last',
    Home: 'first',
};
const NO_PADDING = { bottom: 0, left: 0, right: 0, top: 0 };
function paddingSignature(padding) {
    return [padding.top, padding.right, padding.bottom, padding.left].map(String).join(',');
}
function emptyDiff() {
    return { added: [], moved: [], removed: [], restyled: [] };
}
/** `item.id` is the default key, so the common case needs no `itemKey` prop. */
export function defaultMapKitItemKey(item, index) {
    const id = item.id;
    if (typeof id === 'string' && id.trim())
        return id;
    throw new Error(`<AppMapKit>: items[${String(index)}] has no string "id", so it needs an explicit itemKey. ` +
        'A stable key per item is what makes an items change a diff instead of a rebuild.');
}
let itemTokenCounter = 0;
const itemTokens = new WeakMap();
/**
 * A per-render identity token for the item object.
 *
 * The layer cannot know what inside an app's item affects its glyph, so it uses
 * the object's identity: Vue hands a new object when the data changed and the
 * same object when it did not, which is exactly the question being asked. An
 * item that is not an object falls back to its string form.
 */
function itemToken(item) {
    if (typeof item !== 'object' || item === null)
        return String(item);
    let token = itemTokens.get(item);
    if (!token) {
        itemTokenCounter += 1;
        token = `#${String(itemTokenCounter)}`;
        itemTokens.set(item, token);
    }
    return token;
}
export class MapKitPinLayer {
    #document;
    #entries = new Map();
    #options;
    #registry;
    #destroyed = false;
    #hoveredId = null;
    #lastDiff = emptyDiff();
    #rovingId = null;
    #selectedId = null;
    #tooltip;
    /** Detaches each pin host's tooltip listeners, by pin key. */
    #tooltipDetachers = new Map();
    constructor(options) {
        this.#options = options;
        this.#document = options.document ?? globalThis.document;
        this.#tooltip = options.hoverTooltip
            ? new MapKitHoverTooltip({
                container: options.hoverTooltip.container,
                document: this.#document,
                ...(options.hoverTooltip.scheduler ? { scheduler: options.hoverTooltip.scheduler } : {}),
                ...(options.hoverTooltip.showDelayMs === undefined
                    ? {}
                    : { showDelayMs: options.hoverTooltip.showDelayMs }),
            })
            : null;
        this.#registry = new MapKitAnnotationRegistry({
            map: {
                addAnnotations: (annotations) => {
                    options.map.addAnnotations(annotations);
                },
                removeAnnotations: (annotations) => {
                    options.map.removeAnnotations(annotations);
                },
            },
        });
    }
    get hoveredId() {
        return this.#hoveredId;
    }
    get selectedId() {
        return this.#selectedId;
    }
    get size() {
        return this.#entries.size;
    }
    /** `getDiagnostics()` on the component's expose (§c.6). */
    getDiagnostics() {
        return { annotations: this.#entries.size, lastDiff: this.#lastDiff };
    }
    /** The annotation for a key, for a caller that needs MapKit's own object. */
    annotationFor(key) {
        return this.#entries.get(key)?.annotation;
    }
    /** The library-owned host element for a key. The `#callout` seam anchors on it. */
    hostFor(key) {
        return this.#entries.get(key)?.host;
    }
    itemFor(key) {
        return this.#entries.get(key)?.item;
    }
    /**
     * The geometry MapKit was given for a key: the app's `pinGeometry`, grown by
     * the hit area when one is set. Anything that reads the host's box (rather
     * than the glyph's) must use this one.
     */
    geometryFor(key) {
        return this.#entries.get(key)?.geometry;
    }
    /**
     * Hide the hover tooltip if one is showing. `true` when it was, so an Escape
     * that dismissed a tooltip is not also spent on the callout behind it.
     */
    dismissTooltip() {
        if (!this.#tooltip?.visible)
            return false;
        this.#tooltip.hide();
        return true;
    }
    /** Move keyboard focus to a pin, e.g. back to it when its callout closes. */
    focusPin(key) {
        const host = this.#entries.get(key)?.host;
        if (!host || !this.#focusable)
            return false;
        this.#setRoving(key);
        host.focus({ preventScroll: true });
        return true;
    }
    keys() {
        return [...this.#entries.keys()];
    }
    /**
     * Sync the map to exactly `items`.
     *
     * One batched `removeAnnotations` and one batched `addAnnotations` at most;
     * an unchanged key makes neither call, and a moved or restyled key is applied
     * in place rather than recreated.
     */
    setItems(items) {
        if (this.#destroyed)
            return emptyDiff();
        // K-9: raised before anything is reconciled, so a missing `itemLabel`
        // cannot leave the registry and `#entries` disagreeing about what exists.
        this.#assertLabelling(items);
        const diff = emptyDiff();
        const keyFor = this.#options.itemKey;
        const descriptors = items.map((item, index) => {
            const key = keyFor(item, index);
            const { geometry, padding } = this.#resolveGeometry(item);
            const geometrySignature = `${mapKitPinGeometrySignature(geometry)}|${paddingSignature(padding)}`;
            const signature = [
                String(item.lat),
                String(item.lng),
                geometrySignature,
                itemToken(item),
            ].join('|');
            return {
                create: () => this.#createAnnotation(key, item, geometry, padding, geometrySignature, diff),
                key,
                signature,
                update: () => {
                    this.#updateAnnotation(key, item, geometry, padding, geometrySignature, diff);
                },
            };
        });
        const before = new Set(this.#entries.keys());
        const result = this.#registry.reconcile(descriptors);
        for (const key of before) {
            if (this.#registry.has(key))
                continue;
            const entry = this.#entries.get(key);
            if (!entry)
                continue;
            entry.cleanup?.();
            this.#detachTooltip(key);
            this.#entries.delete(key);
            diff.removed.push(key);
        }
        // A key whose selection no longer exists leaves the layer unselected, so a
        // later re-selection of the same id is not swallowed as a no-op.
        if (this.#selectedId !== null && !this.#entries.has(this.#selectedId))
            this.#selectedId = null;
        if (this.#hoveredId !== null && !this.#entries.has(this.#hoveredId)) {
            this.#hoveredId = null;
            this.#options.onHover?.(null);
        }
        // `recreated` means a changed signature reached a key with no update hook.
        // Every descriptor here supplies one, so this is a contract check, not a
        // branch anyone is expected to hit.
        if (result.recreated > 0) {
            throw new Error('MapKitPinLayer: an annotation was recreated instead of updated in place');
        }
        this.#syncRoving();
        this.#lastDiff = diff;
        return diff;
    }
    /**
     * Move the selection.
     *
     * Zero adds, zero removes: exactly the outgoing and the incoming glyph are
     * re-rendered inside hosts that are not replaced, so focus survives.
     */
    setSelected(id) {
        if (this.#destroyed)
            return emptyDiff();
        const next = id !== null && this.#entries.has(id) ? id : null;
        const diff = emptyDiff();
        if (next === this.#selectedId) {
            this.#lastDiff = diff;
            return diff;
        }
        const previous = this.#selectedId;
        this.#selectedId = next;
        if (previous !== null)
            this.#applySelection(previous, false, diff);
        if (next !== null)
            this.#applySelection(next, true, diff);
        this.#lastDiff = diff;
        return diff;
    }
    /**
     * Mark the hovered pin.
     *
     * Zero adds, zero removes, and no glyph rewrite: only `data-mapkit-hovered`
     * moves, so a hover cannot recreate the host the pointer is on.
     */
    setHovered(id) {
        if (this.#destroyed)
            return;
        const next = id !== null && this.#entries.has(id) ? id : null;
        if (next === this.#hoveredId)
            return;
        const previous = this.#hoveredId;
        this.#hoveredId = next;
        if (previous !== null)
            this.#applyHover(previous, false);
        if (next !== null)
            this.#applyHover(next, true);
    }
    /** Remove every pin and make the layer inert. Idempotent. */
    destroy() {
        if (this.#destroyed)
            return;
        for (const entry of this.#entries.values())
            entry.cleanup?.();
        for (const key of [...this.#tooltipDetachers.keys()])
            this.#detachTooltip(key);
        this.#entries.clear();
        this.#tooltip?.destroy();
        this.#registry.destroy();
        this.#destroyed = true;
    }
    /** The app's geometry grown by the hit area, and the padding that keeps the glyph in place. */
    #resolveGeometry(item) {
        const geometry = this.#options.pinGeometry?.(item) ?? {};
        const hitArea = this.#options.hitArea;
        if (hitArea === undefined || hitArea === false)
            return { geometry, padding: NO_PADDING };
        return expandMapKitHitArea(geometry, hitArea === true ? MAPKIT_MIN_HIT_TARGET : hitArea);
    }
    /** Size and pad the host so the larger tap target leaves the glyph exactly where it was. */
    #writeHitArea(host, geometry, padding) {
        const grown = padding.top + padding.right + padding.bottom + padding.left > 0;
        if (!grown || !geometry.size) {
            host.removeAttribute('data-mapkit-hit-area');
            for (const name of ['box-sizing', 'height', 'padding', 'width'])
                host.style.removeProperty(name);
            return;
        }
        host.setAttribute('data-mapkit-hit-area', '');
        host.style.boxSizing = 'border-box';
        host.style.height = `${String(geometry.size.height)}px`;
        host.style.width = `${String(geometry.size.width)}px`;
        host.style.padding = [padding.top, padding.right, padding.bottom, padding.left]
            .map((value) => `${String(value)}px`)
            .join(' ');
    }
    get #roving() {
        return this.#focusable && this.#options.navigation === 'roving';
    }
    /** Make `key` the one Tab stop of a roving group. */
    #setRoving(key) {
        if (!this.#roving || this.#rovingId === key || !this.#entries.has(key))
            return;
        const previous = this.#rovingId === null ? undefined : this.#entries.get(this.#rovingId);
        previous?.host.setAttribute('tabindex', '-1');
        this.#entries.get(key)?.host.setAttribute('tabindex', '0');
        this.#rovingId = key;
    }
    /** After the pin set changes: exactly one Tab stop, and it is a pin that exists. */
    #syncRoving() {
        if (!this.#roving)
            return;
        if (this.#rovingId !== null && !this.#entries.has(this.#rovingId))
            this.#rovingId = null;
        if (this.#rovingId === null) {
            const first = this.#selectedId ?? nextMapKitRovingKey(this.#rovingPoints(), null, 'first') ?? null;
            if (first !== null)
                this.#setRoving(first);
        }
        for (const [key, entry] of this.#entries) {
            entry.host.setAttribute('tabindex', key === this.#rovingId ? '0' : '-1');
        }
    }
    #rovingPoints() {
        return [...this.#entries.values()].map((entry) => ({
            key: entry.key,
            lat: entry.item.lat,
            lng: entry.item.lng,
        }));
    }
    #moveRoving(from, direction) {
        const next = nextMapKitRovingKey(this.#rovingPoints(), from, direction);
        if (next === null || next === from)
            return false;
        return this.focusPin(next);
    }
    #applySelection(key, selected, diff) {
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        entry.selected = selected;
        this.#renderGlyph(entry);
        diff.restyled.push(key);
    }
    /** Replace the host's single glyph child. The host itself is never replaced. */
    #renderGlyph(entry) {
        const create = this.#options.createPinElement;
        entry.cleanup?.();
        entry.cleanup = undefined;
        entry.host.replaceChildren();
        if (create) {
            const rendered = create(entry.item, entry.selected);
            entry.cleanup = rendered.cleanup;
            entry.host.append(rendered.element);
        }
        if (this.#focusable)
            entry.host.setAttribute('aria-pressed', entry.selected ? 'true' : 'false');
        if (entry.selected)
            entry.host.setAttribute('data-mapkit-selected', '');
        else
            entry.host.removeAttribute('data-mapkit-selected');
        this.#writeHover(entry.host, this.#hoveredId === entry.key);
    }
    #applyHover(key, hovered) {
        const host = this.#entries.get(key)?.host;
        if (!host)
            return;
        this.#writeHover(host, hovered);
    }
    #writeHover(host, hovered) {
        if (hovered)
            host.setAttribute('data-mapkit-hovered', '');
        else
            host.removeAttribute('data-mapkit-hovered');
    }
    /** `false` only when the caller asked for it; every 2.1.0 caller gets `true`. */
    get #focusable() {
        return this.#options.focusable ?? true;
    }
    #assertLabelling(items) {
        if (items.length === 0 || !this.#focusable || this.#options.itemLabel)
            return;
        throw new Error('<AppMapKit>: itemLabel is required whenever items is non-empty -- it is the ' +
            'accessible name of the pin, and a pin without one is unreachable by screen reader. ' +
            'Pass itemLabel, or build the layer with focusable: false for pins that are not ' +
            'interactive controls.');
    }
    #detachTooltip(key) {
        this.#tooltipDetachers.get(key)?.();
        this.#tooltipDetachers.delete(key);
    }
    #buildHost(key, item) {
        const host = this.#document.createElement('div');
        host.setAttribute('data-map-pin', '');
        host.setAttribute('data-mapkit-pin', key);
        if (this.#options.onHover) {
            host.addEventListener('pointerenter', () => {
                this.#options.onHover?.(key);
            });
            host.addEventListener('pointerleave', () => {
                this.#options.onHover?.(null);
            });
        }
        const tooltipOptions = this.#options.hoverTooltip;
        if (this.#tooltip && tooltipOptions) {
            // A rebuilt host for the same key replaces the old one's listeners.
            this.#detachTooltip(key);
            this.#tooltipDetachers.set(key, this.#tooltip.attach(host, () => {
                const entry = this.#entries.get(key);
                // The selected pin has its callout open: a tooltip on top of it is noise.
                return !entry || entry.selected ? null : tooltipOptions.text(entry.item);
            }));
        }
        if (!this.#focusable) {
            // K-8: no role, so no `aria-pressed` either -- `aria-pressed` on a
            // roleless element is what axe reports as `aria-allowed-attr`. The label
            // is dropped with the role: `aria-label` on an element with no role names
            // nothing, and assistive technology ignores it.
            return host;
        }
        host.setAttribute('role', 'button');
        host.setAttribute('tabindex', this.#roving ? '-1' : '0');
        host.style.cursor = 'pointer';
        // `#assertLabelling` has already refused a focusable layer without one.
        host.setAttribute('aria-label', this.#options.itemLabel?.(item) ?? '');
        const activate = (via) => {
            this.#options.onSelect?.(this.#selectedId === key ? null : key, via);
        };
        host.addEventListener('click', (event) => {
            event.stopPropagation();
            activate('pointer');
        });
        if (this.#roving) {
            host.addEventListener('focus', () => {
                this.#setRoving(key);
            });
        }
        host.addEventListener('keydown', (event) => {
            const direction = this.#roving ? ROVING_KEYS[event.key] : undefined;
            if (direction) {
                if (this.#moveRoving(key, direction)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar')
                return;
            event.preventDefault();
            event.stopPropagation();
            activate('keyboard');
        });
        return host;
    }
    #createAnnotation(key, item, geometry, padding, geometrySignature, diff) {
        const { mapkit } = this.#options;
        const host = this.#buildHost(key, item);
        const entry = {
            annotation: undefined,
            cleanup: undefined,
            geometry,
            geometrySignature,
            host,
            item,
            key,
            selected: this.#selectedId === key,
        };
        this.#renderGlyph(entry);
        this.#writeHitArea(host, geometry, padding);
        const offset = mapKitAnchorOffset(geometry);
        const options = {
            anchorOffset: new DOMPoint(offset.x, offset.y),
            // MapKit's own callout is never used: the `#callout` slot renders the
            // app's Vue tree instead, which is the only way a NuxtLink inside a
            // callout can work at all (buoys#112).
            calloutEnabled: false,
            data: { key },
        };
        if (geometry.size)
            options.size = { height: geometry.size.height, width: geometry.size.width };
        if (this.#options.clusteringIdentifier !== undefined) {
            options.clusteringIdentifier = this.#options.clusteringIdentifier;
        }
        entry.annotation = new mapkit.Annotation(new mapkit.Coordinate(item.lat, item.lng), () => host, options);
        this.#entries.set(key, entry);
        diff.added.push(key);
        return entry.annotation;
    }
    #updateAnnotation(key, item, geometry, padding, geometrySignature, diff) {
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        const { mapkit } = this.#options;
        const previous = entry.item;
        entry.item = item;
        if (previous.lat !== item.lat || previous.lng !== item.lng) {
            entry.annotation.coordinate = new mapkit.Coordinate(item.lat, item.lng);
            diff.moved.push(key);
        }
        if (entry.geometrySignature !== geometrySignature) {
            entry.geometrySignature = geometrySignature;
            entry.geometry = geometry;
            this.#writeHitArea(entry.host, geometry, padding);
            const offset = mapKitAnchorOffset(geometry);
            entry.annotation.anchorOffset = new DOMPoint(offset.x, offset.y);
            entry.annotation.size = geometry.size
                ? { height: geometry.size.height, width: geometry.size.width }
                : null;
            if (!diff.restyled.includes(key))
                diff.restyled.push(key);
        }
        // A new item object for the same key means the app's data changed, so the
        // glyph is re-rendered -- in place, inside the same host.
        if (previous !== item) {
            const label = this.#options.itemLabel?.(item);
            if (label !== undefined && this.#focusable)
                entry.host.setAttribute('aria-label', label);
            this.#renderGlyph(entry);
            if (!diff.restyled.includes(key))
                diff.restyled.push(key);
        }
    }
}
//# sourceMappingURL=pin-layer.js.map