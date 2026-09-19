import type { MkMap, MkRuntime } from './runtime.js';
/** One mark to show. A changed signature or position repaints that mark in place. */
export interface MarkSpec {
    build: () => HTMLElement;
    key: string;
    lat: number;
    lon: number;
    selected?: boolean;
    signature: string;
}
export interface MarkLayer {
    destroy: () => void;
    render: (specs: readonly MarkSpec[]) => void;
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
export declare function createMarkLayer(map: MkMap, runtime: MkRuntime): MarkLayer;
//# sourceMappingURL=layer.d.ts.map