export type FrameReadiness = 'idle' | 'loading' | 'ready' | 'failed';
export interface TemporalPlaybackState {
    current: number;
    frameCount: number;
    readiness: ReadonlyMap<number, FrameReadiness>;
}
export declare function nextDrawableFrame(state: TemporalPlaybackState): number | null;
export declare function temporalProgress(state: TemporalPlaybackState): number;
export declare function boundedFrameCache<T>(entries: ReadonlyMap<number, T>, maxEntries: number): Map<number, T>;
//# sourceMappingURL=temporal.d.ts.map