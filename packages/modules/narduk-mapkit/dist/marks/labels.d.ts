/**
 * Greedy text-label placement under already-placed discs. Each label hangs
 * centred below its own disc; it is kept only when its box touches no other
 * disc, no earlier label and no blocked box. Callers pass labels best first,
 * so a crowd drops its weakest labels, never a pin (a disc is never moved).
 * Vocabulary-free like the rest of `utils/mapkit`.
 */
export interface LabelDisc {
    id: string;
    radius: number;
    x: number;
    y: number;
}
export interface LabelRequest {
    height: number;
    /** Id of the disc this label hangs under. */
    id: string;
    width: number;
}
export interface LabelBox {
    bottom: number;
    left: number;
    right: number;
    top: number;
}
export interface LabelPlacementInput {
    /** Areas no label may enter, e.g. a selected pin's callout. */
    blocked?: readonly LabelBox[];
    discs: readonly LabelDisc[];
    /** Clear space between a label and anything else, in px. */
    gap: number;
    /** Space between a disc's edge and the top of its label, in px. */
    offset: number;
    /** Labels in placement order, best first. */
    requests: readonly LabelRequest[];
}
/** The box a label of this size occupies under its disc. */
export declare function labelBox(disc: LabelDisc, request: LabelRequest, offset: number): LabelBox;
/** Ids of the labels that fit, in the order they were placed. */
export declare function placeLabels(input: LabelPlacementInput): string[];
//# sourceMappingURL=labels.d.ts.map