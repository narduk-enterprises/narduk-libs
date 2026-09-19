import type { MkMapRect } from './runtime.js';
/**
 * Camera math for the map kit, in MapKit's normalized Web Mercator map units
 * (x and y run 0 to 1 from the top left of the world).
 */
export type MapTier = 'close' | 'local' | 'overview' | 'regional';
export interface FramePoint {
    x: number;
    y: number;
}
export interface FrameSize {
    height: number;
    width: number;
}
/** Pixels the chrome covers along each edge of the map frame. */
export interface FrameInsets {
    bottom: number;
    left: number;
    right: number;
    top: number;
}
export interface LngLatBox {
    east: number;
    north: number;
    south: number;
    west: number;
}
export interface LatLon {
    lat: number;
    lon: number;
}
export declare function tierForSpan(longitudeDelta: number, widthPx: number): MapTier;
/** Projects a coordinate to frame pixels, using the world copy nearest the view centre. */
export declare function projectToFrame(rect: MkMapRect, frame: FrameSize, point: LatLon): FramePoint;
export declare function frameToCoordinate(rect: MkMapRect, frame: FrameSize, point: FramePoint): LatLon;
/**
 * MapKit reports and takes its visible rect for the PADDED box -- the element
 * less `map.padding` -- not the whole element (measured on live MapKit JS 6: a
 * 200 px bottom padding shrinks `visibleMapRect` to the top 464 of 664 px).
 * The kit's camera math works in whole-frame pixels, so the view converts at
 * the one boundary: `unpadRect` turns MapKit's rect into the whole frame's,
 * and `padRect` turns a whole-frame rect back into the one MapKit expects.
 */
export declare function unpadRect(rect: MkMapRect, frame: FrameSize, padding: FrameInsets): MkMapRect;
/** The inverse of `unpadRect`: the padded box's share of a whole-frame rect. */
export declare function padRect(rect: MkMapRect, frame: FrameSize, padding: FrameInsets): MkMapRect;
export declare function frameContains(frame: FrameSize, point: FramePoint, margin?: number): boolean;
/**
 * The visible map rect that fits a lat/lon box inside the part of the frame the
 * chrome leaves free, centred there. `maxZoom` stops single points zooming in forever.
 */
export declare function rectForBox(box: LngLatBox, frame: FrameSize, insets: FrameInsets, options?: {
    margin?: number;
    maxZoom?: number;
}): MkMapRect;
/**
 * The visible map rect that moves a frame point to the centre of the free area,
 * keeping the zoom. Returns null when the point is already comfortably inside it.
 */
export declare function rectRevealing(rect: MkMapRect, frame: FrameSize, insets: FrameInsets, point: FramePoint, margin?: number): MkMapRect | null;
/** Zooms the rect around its centre; a factor above 1 zooms in. */
export declare function zoomRect(rect: MkMapRect, factor: number): MkMapRect;
//# sourceMappingURL=camera.d.ts.map