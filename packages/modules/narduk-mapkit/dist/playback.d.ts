import type { MapKitLineDrawable, MapKitPlaybackLineOptions, MapKitPlaybackPoint, MapKitPoint } from './types.js';
export declare function clampMapKitPlaybackProgress(progress: number): number;
export declare function normalizeMapKitPlaybackPoints<TData = unknown>(points: ReadonlyArray<MapKitPlaybackPoint<TData> | MapKitPoint> | null | undefined): Array<MapKitPlaybackPoint<TData>>;
export declare function clampMapKitPlaybackIndex(index: number, pointCount: number): number;
export declare function mapKitPlaybackIndexToProgress(index: number, pointCount: number): number;
export declare function mapKitPlaybackProgressToIndex(progress: number, pointCount: number): number;
export declare function buildMapKitPlaybackLineSlices<TData = unknown>(points: ReadonlyArray<MapKitPlaybackPoint<TData> | MapKitPoint>, index: number, options?: MapKitPlaybackLineOptions): MapKitLineDrawable[];
export declare function getMapKitPlaybackDurationMs<TData = unknown>(points: ReadonlyArray<MapKitPlaybackPoint<TData>>, fallbackDurationMs?: number | null): number;
export declare function getMapKitPlaybackElapsedMs<TData = unknown>(points: ReadonlyArray<MapKitPlaybackPoint<TData>>, progress: number, fallbackDurationMs?: number | null): number;
export declare function formatMapKitPlaybackDuration(ms: number): string;
//# sourceMappingURL=playback.d.ts.map