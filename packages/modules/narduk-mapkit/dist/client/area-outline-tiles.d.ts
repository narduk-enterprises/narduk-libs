import type { VectorTileAreaLayer } from './vector-tile-areas.js';
import type { VectorTileCanvas } from './vector-tiles.js';
export interface AreaOutlineTileSourceOptions<TCanvas extends VectorTileCanvas> {
    createCanvas: (width: number, height: number) => TCanvas;
    /** What to draw, or `null` for nothing yet. Replace it with {@link AreaOutlineTileSource.setLayer}. */
    layer?: VectorTileAreaLayer | null;
    /** Logical tile size before the device scale. MapKit asks for 256. */
    tileSize?: number;
}
export interface AreaOutlineTileSource<TCanvas extends VectorTileCanvas> {
    /** Pass as the `imageForTile` of a layer descriptor. `null` for a tile nothing reaches. */
    imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>;
    readonly layer: VectorTileAreaLayer | null;
    /** Draw another layer from the next tile on. The caller replaces the overlay to repaint at once. */
    setLayer: (layer: VectorTileAreaLayer | null) => void;
}
export declare function createAreaOutlineTileSource<TCanvas extends VectorTileCanvas>(options: AreaOutlineTileSourceOptions<TCanvas>): AreaOutlineTileSource<TCanvas>;
//# sourceMappingURL=area-outline-tiles.d.ts.map