import type { PointLayerView } from './point-layer.js';
/** The slice of an element the label needs. */
export interface AreaHoverLabelElement {
    dataset: Record<string, string | undefined>;
    style: {
        cssText: string;
        opacity: string;
        transform: string;
        transition: string;
    };
    remove: () => void;
    setAttribute: (name: string, value: string) => void;
    textContent: string | null;
}
export interface AreaHoverLabelContainer {
    appendChild: (child: never) => unknown;
    ownerDocument?: {
        createElement: (tag: string) => unknown;
    };
}
export interface AreaHoverLabelOptions<TElement extends AreaHoverLabelElement> {
    className?: string;
    container: AreaHoverLabelContainer;
    /** Make the element. Default: a `div` from the container's document. */
    createElement?: () => TElement;
    /** Fade time. Default 140 ms; 0 when `reducedMotion` is true. */
    fadeMs?: number;
    /** How far inside the view an anchor must lie to be used, in CSS pixels. Default 48. */
    insetPx?: number;
    /** Set `true` for `prefers-reduced-motion: reduce`. Default: the media query, if any. */
    reducedMotion?: boolean;
    /** Extra inline style, applied once. Colour, size and weight belong to the app. */
    style?: string;
}
export interface AreaHoverLabelTarget {
    latitude: number;
    longitude: number;
    text: string;
}
export interface AreaHoverLabel {
    destroy: () => void;
    hide: () => void;
    readonly element: AreaHoverLabelElement;
    /** Where the text sits now: on its anchor, beside the pointer, or nowhere. */
    readonly placement: 'anchor' | 'hidden' | 'pointer';
    /** Show `target`'s text. `pointer` is in CSS pixels from the view's top-left. */
    show: (target: AreaHoverLabelTarget, pointer?: {
        x: number;
        y: number;
    } | null) => void;
    readonly text: string;
    /** The map moved or resized: place the text for this view. */
    update: (view: PointLayerView) => void;
}
export declare function createAreaHoverLabel<TElement extends AreaHoverLabelElement>(options: AreaHoverLabelOptions<TElement>): AreaHoverLabel;
//# sourceMappingURL=area-hover-label.d.ts.map