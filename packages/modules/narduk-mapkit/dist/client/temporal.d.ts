import type { MapKitLayerDescriptor, MapKitLayerReplaceOptions } from './layers.js';
import type { MapKitTimerScheduler } from './timers.js';
/**
 * Decode/readiness state of a single dated frame.
 *
 * - `idle`: nothing is known about the frame (never requested, or evicted from
 *   the bounded readiness cache).
 * - `loading`: a prefetch or a layer replacement for the frame is in flight.
 * - `ready`: the frame's tile source produced usable imagery.
 * - `failed`: the frame's tile source rejected; playback skips it.
 */
export type FrameReadiness = 'idle' | 'loading' | 'ready' | 'failed';
/** Plain-data snapshot of a temporal sequence, independent of MapKit JS. */
export interface TemporalPlaybackState {
    current: number;
    frameCount: number;
    readiness: ReadonlyMap<number, FrameReadiness>;
}
/**
 * Index of the next frame that may be drawn without showing an empty layer.
 *
 * Returns `null` unless both the current frame and the wrapped next frame are
 * `ready`, which is what makes an animation loop readiness-gated rather than
 * time-gated: a loop that advances onto an undecoded frame flashes.
 */
export declare function nextDrawableFrame(state: TemporalPlaybackState): number | null;
/** Fraction of the sequence that is decoded and drawable, in `0..1`. */
export declare function temporalProgress(state: TemporalPlaybackState): number;
/**
 * Copy `entries` capped at `maxEntries`, dropping the oldest insertion first.
 *
 * Callers that want LRU behavior re-insert the entry they touched before
 * calling this, which is exactly what the temporal controller does with the
 * frame the map is currently showing.
 */
export declare function boundedFrameCache<T>(entries: ReadonlyMap<number, T>, maxEntries: number): Map<number, T>;
/** One dated frame of a temporal layer, plus optional consumer metadata. */
export interface TemporalFrame<TMeta = unknown> {
    /** Stable identity of the frame, typically a date id such as `2026-08-27`. */
    readonly id: string;
    /** Consumer-owned metadata (coverage fraction, provenance, label, ...). */
    readonly meta?: TMeta;
}
/** A frame, or the bare id of a frame that carries no metadata. */
export type TemporalFrameInput<TMeta = unknown> = string | TemporalFrame<TMeta>;
/** Normalize a mixed id/frame list, dropping entries with an empty id. */
export declare function normalizeTemporalFrames<TMeta = unknown>(frames: ReadonlyArray<TemporalFrameInput<TMeta>> | null | undefined): Array<TemporalFrame<TMeta>>;
/**
 * The slice of `MapKitLayerRegistry` the controller needs.
 *
 * Declared structurally so the controller can be driven by a registry, by a
 * test double, or by any other object that can swap one layer's tile source.
 */
export interface TemporalLayerTarget {
    replace(id: string, descriptor: MapKitLayerDescriptor, options?: MapKitLayerReplaceOptions): Promise<void>;
}
/** Why the controller moved to a different frame. */
export type TemporalChangeReason = 'scrub' | 'step' | 'play' | 'frames';
/** Why playback stopped. */
export type TemporalPauseReason = 'user' | 'destroy' | 'frames' | 'reduced-motion' | 'stalled';
/** Everything the controller reports. Consumers own all rendering. */
export type TemporalControllerEvent<TMeta = unknown> = {
    readonly frame: TemporalFrame<TMeta> | undefined;
    readonly index: number;
    readonly playing: boolean;
    readonly reason: TemporalChangeReason;
    readonly type: 'change';
} | {
    readonly frame: TemporalFrame<TMeta> | undefined;
    readonly index: number;
    readonly progress: number;
    readonly readiness: FrameReadiness;
    readonly type: 'readiness';
} | {
    readonly index: number;
    readonly intervalMs: number;
    readonly type: 'play';
    readonly windowSize: number;
    readonly windowStart: number;
} | {
    readonly index: number;
    readonly reason: TemporalPauseReason;
    readonly type: 'pause';
} | {
    readonly index: number;
    readonly type: 'stall';
    readonly waitingFor: number;
} | {
    readonly index: number;
    readonly reason: unknown;
    readonly type: 'error';
};
export type TemporalControllerListener<TMeta = unknown> = (event: TemporalControllerEvent<TMeta>) => void;
export interface TemporalScrubOptions {
    /** Override the crossfade for this transition only. Ignored under reduced motion. */
    crossfadeDurationMs?: number;
    /** Re-apply the descriptor even when the index is unchanged. */
    force?: boolean;
}
export interface TemporalPlayOptions {
    /** Milliseconds between advance attempts. Default `900`. */
    intervalMs?: number;
    /** Loop over the last N frames. Default `7`, clamped to the frame count. */
    windowSize?: number;
}
export interface TemporalLayerControllerOptions<TMeta = unknown> {
    /** Forwarded to `registry.replace`. Default `'first-image'` for async sources. */
    activateWhen?: 'immediate' | 'first-image';
    /** Crossfade for frame changes. Omit to use the registry's own default. */
    crossfadeDurationMs?: number;
    /**
     * Build the layer descriptor for a frame. The returned descriptor's `id`
     * must equal `layerId`; the controller throws otherwise rather than letting
     * the registry reject the swap mid-animation.
     */
    descriptorForFrame: (frame: TemporalFrame<TMeta>, index: number) => MapKitLayerDescriptor;
    /** Ordered oldest-to-newest dated frames. */
    frames: ReadonlyArray<TemporalFrameInput<TMeta>>;
    /**
     * Gate advancement on frame readiness. Defaults to `true` when
     * `prefetchFrame` is supplied and `false` otherwise, because without a
     * readiness source every frame would stall forever.
     */
    gateAdvanceOnReadiness?: boolean;
    /** Starting index. Default `0`. */
    index?: number;
    /** Default playback interval in milliseconds. Default `900`. */
    intervalMs?: number;
    /** Registry id of the layer this controller owns. */
    layerId: string;
    /** Default loop window. Default `7`. */
    loopWindowSize?: number;
    /** Upper bound on remembered frame readiness. Default `8`. */
    maxTrackedFrames?: number;
    onEvent?: TemporalControllerListener<TMeta>;
    /** How many upcoming frames to warm. Default `2`. */
    prefetchAhead?: number;
    /**
     * Warm a frame's tile source. Resolving marks the frame `ready`; rejecting
     * marks it `failed` and playback skips it.
     */
    prefetchFrame?: (frame: TemporalFrame<TMeta>, index: number, signal: AbortSignal) => Promise<unknown>;
    /** Forwarded to `registry.replace` as the bounded readiness timeout. */
    readinessTimeoutMs?: number;
    /**
     * Consumer-owned `prefers-reduced-motion` flag. When true, `play()` is
     * refused and every scrub is instant (crossfade `0`).
     */
    reducedMotion?: boolean;
    registry: TemporalLayerTarget;
    /** Injectable clock/timers. Default: `globalThis` timers and `Date.now()`. */
    timer?: MapKitTimerScheduler;
}
/**
 * Binds a dated frame sequence to a single `MapKitLayerRegistry` layer.
 *
 * The controller owns index state, readiness bookkeeping, bounded prefetch,
 * and a readiness-gated loop; it renders nothing. Consumers own the date
 * strip, the play button, and the descriptor for each date.
 *
 * @example
 * ```ts
 * const controller = createTemporalLayerController({
 *   registry,
 *   layerId: 'data',
 *   frames: dates,
 *   descriptorForFrame: (frame) => ({
 *     id: 'data',
 *     urlTemplate: `/tiles/${frame.id}/{z}/{x}/{y}@{scale}x.png`,
 *     bounds,
 *   }),
 *   reducedMotion: media.matches,
 * })
 *
 * await controller.scrubToId('2026-08-27')
 * controller.play({ windowSize: 7, intervalMs: 900 })
 * ```
 */
export declare class MapKitTemporalLayerController<TMeta = unknown> {
    #private;
    constructor(options: TemporalLayerControllerOptions<TMeta>);
    get destroyed(): boolean;
    /** The current frame, or `undefined` when the sequence is empty. */
    get frame(): TemporalFrame<TMeta> | undefined;
    get frames(): ReadonlyArray<TemporalFrame<TMeta>>;
    get index(): number;
    get length(): number;
    get playing(): boolean;
    get reducedMotion(): boolean;
    /** Snapshot in whole-sequence coordinates, for `temporalProgress` and UI. */
    state(): TemporalPlaybackState;
    /** Readiness of one frame. Unknown frames read `idle`, or `ready` when ungated. */
    readinessOf(index: number): FrameReadiness;
    /** Fraction of the sequence known to be drawable, in `0..1`. */
    progress(): number;
    /** Index of a frame id, or `-1`. */
    indexOf(id: string): number;
    subscribe(listener: TemporalControllerListener<TMeta>): () => void;
    /** Record readiness observed outside the controller (tile errors, decoders). */
    markReadiness(index: number, readiness: FrameReadiness): void;
    /** Update the reduced-motion flag. Turning it on stops an active loop. */
    setReducedMotion(reducedMotion: boolean): void;
    /**
     * Replace the frame list. Playback stops, readiness is cleared (indices no
     * longer identify the same dates), and the index is clamped or re-anchored
     * to the previously current frame id when it survives.
     */
    setFrames(frames: ReadonlyArray<TemporalFrameInput<TMeta>>): void;
    /** Move to `index` and swap the layer's tile source. */
    scrubTo(index: number, options?: TemporalScrubOptions): Promise<void>;
    /** Move to the frame with `id`. Unknown ids are ignored. */
    scrubToId(id: string, options?: TemporalScrubOptions): Promise<void>;
    /** Step `delta` frames. Clamps at the ends unless `wrap` is set. */
    stepBy(delta: number, options?: TemporalScrubOptions & {
        wrap?: boolean;
    }): Promise<void>;
    stepForward(options?: TemporalScrubOptions & {
        wrap?: boolean;
    }): Promise<void>;
    stepBack(options?: TemporalScrubOptions & {
        wrap?: boolean;
    }): Promise<void>;
    /**
     * Loop the last `windowSize` frames at `intervalMs`.
     *
     * Refused under reduced motion, which emits a `pause` event with reason
     * `reduced-motion` so a play button can reflect that nothing started.
     */
    play(options?: TemporalPlayOptions): void;
    /** Stop the loop. Safe to call when not playing. */
    pause(reason?: TemporalPauseReason): void;
    toggle(options?: TemporalPlayOptions): void;
    /**
     * Warm frames. Defaults to the current frame plus `prefetchAhead` upcoming
     * window frames. A no-op when no `prefetchFrame` was supplied.
     */
    prefetch(indexes?: readonly number[]): Promise<void>;
    /** Cancel timers, in-flight prefetches, and the pending swap; drop listeners. */
    destroy(): void;
}
/** Construct a {@link MapKitTemporalLayerController}. */
export declare function createTemporalLayerController<TMeta = unknown>(options: TemporalLayerControllerOptions<TMeta>): MapKitTemporalLayerController<TMeta>;
//# sourceMappingURL=temporal.d.ts.map