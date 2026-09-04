import { defaultMapKitTimerScheduler } from './timers.js';
/**
 * Index of the next frame that may be drawn without showing an empty layer.
 *
 * Returns `null` unless both the current frame and the wrapped next frame are
 * `ready`, which is what makes an animation loop readiness-gated rather than
 * time-gated: a loop that advances onto an undecoded frame flashes.
 */
export function nextDrawableFrame(state) {
    if (state.frameCount < 1 || state.readiness.get(state.current) !== 'ready')
        return null;
    const next = (state.current + 1) % state.frameCount;
    return state.readiness.get(next) === 'ready' ? next : null;
}
/** Fraction of the sequence that is decoded and drawable, in `0..1`. */
export function temporalProgress(state) {
    if (state.frameCount < 1)
        return 0;
    let ready = 0;
    for (let index = 0; index < state.frameCount; index++)
        if (state.readiness.get(index) === 'ready')
            ready++;
    return ready / state.frameCount;
}
/**
 * Copy `entries` capped at `maxEntries`, dropping the oldest insertion first.
 *
 * Callers that want LRU behavior re-insert the entry they touched before
 * calling this, which is exactly what the temporal controller does with the
 * frame the map is currently showing.
 */
export function boundedFrameCache(entries, maxEntries) {
    const result = new Map(entries);
    while (result.size > Math.max(1, maxEntries))
        result.delete(result.keys().next().value);
    return result;
}
const DEFAULT_INTERVAL_MS = 900;
const DEFAULT_LOOP_WINDOW_SIZE = 7;
const DEFAULT_PREFETCH_AHEAD = 2;
const DEFAULT_MAX_TRACKED_FRAMES = 8;
/** Normalize a mixed id/frame list, dropping entries with an empty id. */
export function normalizeTemporalFrames(frames) {
    if (!Array.isArray(frames))
        return [];
    return frames.flatMap((frame) => {
        if (typeof frame === 'string')
            return frame.trim() ? [{ id: frame }] : [];
        if (!frame || typeof frame.id !== 'string' || !frame.id.trim())
            return [];
        return [frame.meta === undefined ? { id: frame.id } : { id: frame.id, meta: frame.meta }];
    });
}
function clampIndex(index, length) {
    if (!Number.isFinite(index) || length < 1)
        return 0;
    return Math.max(0, Math.min(length - 1, Math.trunc(index)));
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
export class MapKitTemporalLayerController {
    #activateWhen;
    #crossfadeDurationMs;
    #descriptorForFrame;
    #gateAdvanceOnReadiness;
    #layerId;
    #listeners = new Set();
    #maxTrackedFrames;
    #prefetchAhead;
    #prefetchFrame;
    #prefetching = new Map();
    #readinessTimeoutMs;
    #registry;
    #timer;
    #defaultIntervalMs;
    #defaultWindowSize;
    #destroyed = false;
    #frames;
    #index;
    #intervalMs;
    #playing = false;
    #readiness = new Map();
    #reducedMotion;
    #scrub = null;
    #scrubToken = 0;
    #timerHandle = null;
    #windowSize;
    constructor(options) {
        if (!options.layerId.trim())
            throw new Error('layerId is required');
        this.#activateWhen = options.activateWhen;
        this.#crossfadeDurationMs = options.crossfadeDurationMs;
        this.#descriptorForFrame = options.descriptorForFrame;
        this.#layerId = options.layerId;
        this.#maxTrackedFrames = Math.max(1, options.maxTrackedFrames ?? DEFAULT_MAX_TRACKED_FRAMES);
        this.#prefetchAhead = Math.max(0, options.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD);
        this.#prefetchFrame = options.prefetchFrame;
        this.#readinessTimeoutMs = options.readinessTimeoutMs;
        this.#registry = options.registry;
        this.#timer = options.timer ?? defaultMapKitTimerScheduler;
        this.#gateAdvanceOnReadiness =
            options.gateAdvanceOnReadiness ?? options.prefetchFrame !== undefined;
        this.#frames = normalizeTemporalFrames(options.frames);
        this.#index = clampIndex(options.index ?? 0, this.#frames.length);
        this.#reducedMotion = options.reducedMotion ?? false;
        this.#defaultIntervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
        this.#defaultWindowSize = Math.max(1, options.loopWindowSize ?? DEFAULT_LOOP_WINDOW_SIZE);
        this.#intervalMs = this.#defaultIntervalMs;
        this.#windowSize = this.#defaultWindowSize;
        if (options.onEvent)
            this.#listeners.add(options.onEvent);
    }
    get destroyed() {
        return this.#destroyed;
    }
    /** The current frame, or `undefined` when the sequence is empty. */
    get frame() {
        return this.#frames[this.#index];
    }
    get frames() {
        return this.#frames;
    }
    get index() {
        return this.#index;
    }
    get length() {
        return this.#frames.length;
    }
    get playing() {
        return this.#playing;
    }
    get reducedMotion() {
        return this.#reducedMotion;
    }
    /** Snapshot in whole-sequence coordinates, for `temporalProgress` and UI. */
    state() {
        const readiness = new Map();
        for (let index = 0; index < this.#frames.length; index++) {
            readiness.set(index, this.readinessOf(index));
        }
        return { current: this.#index, frameCount: this.#frames.length, readiness };
    }
    /** Readiness of one frame. Unknown frames read `idle`, or `ready` when ungated. */
    readinessOf(index) {
        const known = this.#readiness.get(index);
        if (known !== undefined)
            return known;
        return this.#gateAdvanceOnReadiness ? 'idle' : 'ready';
    }
    /** Fraction of the sequence known to be drawable, in `0..1`. */
    progress() {
        return temporalProgress(this.state());
    }
    /** Index of a frame id, or `-1`. */
    indexOf(id) {
        return this.#frames.findIndex((frame) => frame.id === id);
    }
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    /** Record readiness observed outside the controller (tile errors, decoders). */
    markReadiness(index, readiness) {
        if (index < 0 || index >= this.#frames.length)
            return;
        this.#setReadiness(index, readiness);
    }
    /** Update the reduced-motion flag. Turning it on stops an active loop. */
    setReducedMotion(reducedMotion) {
        if (this.#reducedMotion === reducedMotion)
            return;
        this.#reducedMotion = reducedMotion;
        if (reducedMotion && this.#playing)
            this.pause('reduced-motion');
    }
    /**
     * Replace the frame list. Playback stops, readiness is cleared (indices no
     * longer identify the same dates), and the index is clamped or re-anchored
     * to the previously current frame id when it survives.
     */
    setFrames(frames) {
        const previousId = this.frame?.id;
        if (this.#playing)
            this.pause('frames');
        this.#cancelPrefetch();
        this.#frames = normalizeTemporalFrames(frames);
        this.#readiness = new Map();
        const preserved = previousId === undefined ? -1 : this.indexOf(previousId);
        this.#index = preserved >= 0 ? preserved : clampIndex(this.#index, this.#frames.length);
        this.#emit({
            frame: this.frame,
            index: this.#index,
            playing: this.#playing,
            reason: 'frames',
            type: 'change',
        });
    }
    /** Move to `index` and swap the layer's tile source. */
    async scrubTo(index, options = {}) {
        return this.#goTo(clampIndex(index, this.#frames.length), 'scrub', options);
    }
    /** Move to the frame with `id`. Unknown ids are ignored. */
    async scrubToId(id, options = {}) {
        const index = this.indexOf(id);
        if (index < 0)
            return;
        return this.#goTo(index, 'scrub', options);
    }
    /** Step `delta` frames. Clamps at the ends unless `wrap` is set. */
    async stepBy(delta, options = {}) {
        if (this.#frames.length < 1)
            return;
        const raw = this.#index + Math.trunc(delta);
        const next = options.wrap
            ? ((raw % this.#frames.length) + this.#frames.length) % this.#frames.length
            : clampIndex(raw, this.#frames.length);
        return this.#goTo(next, 'step', options);
    }
    async stepForward(options = {}) {
        return this.stepBy(1, options);
    }
    async stepBack(options = {}) {
        return this.stepBy(-1, options);
    }
    /**
     * Loop the last `windowSize` frames at `intervalMs`.
     *
     * Refused under reduced motion, which emits a `pause` event with reason
     * `reduced-motion` so a play button can reflect that nothing started.
     */
    play(options = {}) {
        if (this.#destroyed || this.#frames.length < 1)
            return;
        if (this.#reducedMotion) {
            this.#emit({ index: this.#index, reason: 'reduced-motion', type: 'pause' });
            return;
        }
        this.#intervalMs = Math.max(1, options.intervalMs ?? this.#defaultIntervalMs);
        this.#windowSize = Math.max(1, options.windowSize ?? this.#defaultWindowSize);
        const { size, start } = this.#windowRange();
        if (this.#index < start) {
            void this.#goTo(start, 'play', {});
        }
        if (this.#playing)
            return;
        this.#playing = true;
        this.#emit({
            index: this.#index,
            intervalMs: this.#intervalMs,
            type: 'play',
            windowSize: size,
            windowStart: start,
        });
        void this.prefetch();
        this.#schedule();
    }
    /** Stop the loop. Safe to call when not playing. */
    pause(reason = 'user') {
        this.#clearTimer();
        if (!this.#playing)
            return;
        this.#playing = false;
        this.#emit({ index: this.#index, reason, type: 'pause' });
    }
    toggle(options = {}) {
        if (this.#playing)
            this.pause();
        else
            this.play(options);
    }
    /**
     * Warm frames. Defaults to the current frame plus `prefetchAhead` upcoming
     * window frames. A no-op when no `prefetchFrame` was supplied.
     */
    async prefetch(indexes) {
        if (!this.#prefetchFrame)
            return;
        const targets = indexes ?? this.#upcomingIndexes();
        await Promise.all(targets.map((index) => this.#prefetchOne(index)));
    }
    /** Cancel timers, in-flight prefetches, and the pending swap; drop listeners. */
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.pause('destroy');
        this.#cancelPrefetch();
        this.#scrub?.controller.abort();
        this.#scrub = null;
        this.#listeners.clear();
    }
    #windowRange() {
        const size = Math.max(1, Math.min(this.#windowSize, Math.max(1, this.#frames.length)));
        return { size, start: Math.max(0, this.#frames.length - size) };
    }
    #windowState() {
        const { size, start } = this.#windowRange();
        const readiness = new Map();
        for (let offset = 0; offset < size; offset++) {
            readiness.set(offset, this.readinessOf(start + offset));
        }
        return { current: clampIndex(this.#index - start, size), frameCount: size, readiness };
    }
    #upcomingIndexes() {
        if (this.#frames.length < 1)
            return [];
        const { size, start } = this.#windowRange();
        const current = clampIndex(this.#index - start, size);
        const indexes = [this.#index];
        for (let ahead = 1; ahead <= Math.min(this.#prefetchAhead, size - 1); ahead++) {
            indexes.push(start + ((current + ahead) % size));
        }
        return [...new Set(indexes)];
    }
    /**
     * The next frame the loop may draw, or `null` while it must wait.
     *
     * Delegates the ready/ready check to `nextDrawableFrame` in window-local
     * coordinates, then diagnoses a `null` so a failed frame is skipped instead
     * of stalling the loop forever.
     */
    #nextPlayIndex() {
        const { size, start } = this.#windowRange();
        const state = this.#windowState();
        const drawable = nextDrawableFrame(state);
        if (drawable !== null)
            return start + drawable;
        if (state.readiness.get(state.current) !== 'ready') {
            void this.prefetch([this.#index]);
            return null;
        }
        // Scan forward past failed frames, stopping before wrapping back onto the
        // frame already on screen.
        for (let hop = 1; hop < size; hop++) {
            const offset = (state.current + hop) % size;
            const readiness = state.readiness.get(offset);
            if (readiness === 'failed')
                continue;
            if (readiness === 'ready')
                return start + offset;
            void this.prefetch([start + offset]);
            return null;
        }
        // Every other frame in the window failed; nothing will become drawable.
        this.pause('stalled');
        return null;
    }
    #schedule() {
        if (!this.#playing || this.#destroyed)
            return;
        this.#clearTimer();
        this.#timerHandle = this.#timer.schedule(() => {
            this.#timerHandle = null;
            this.#tick();
        }, this.#intervalMs);
    }
    #clearTimer() {
        if (this.#timerHandle === null)
            return;
        this.#timer.cancel(this.#timerHandle);
        this.#timerHandle = null;
    }
    #tick() {
        if (!this.#playing || this.#destroyed)
            return;
        // A swap still in flight owns the layer; skip this beat rather than
        // cancelling a crossfade that is already halfway through.
        if (this.#scrub) {
            this.#schedule();
            return;
        }
        const next = this.#nextPlayIndex();
        if (next === null) {
            if (this.#playing) {
                this.#emit({ index: this.#index, type: 'stall', waitingFor: this.#index });
                this.#schedule();
            }
            return;
        }
        void this.#goTo(next, 'play', {});
        void this.prefetch();
        this.#schedule();
    }
    async #goTo(index, reason, options) {
        if (this.#destroyed || this.#frames.length < 1)
            return;
        const frame = this.#frames[index];
        if (!frame)
            return;
        if (index === this.#index && !options.force && this.#readiness.get(index) === 'ready')
            return;
        const descriptor = this.#descriptorForFrame(frame, index);
        if (descriptor.id !== this.#layerId) {
            throw new Error(`descriptorForFrame must return a descriptor with id "${this.#layerId}", got "${descriptor.id}"`);
        }
        this.#index = index;
        this.#touch(index);
        if (this.readinessOf(index) !== 'ready')
            this.#setReadiness(index, 'loading');
        this.#emit({ frame, index, playing: this.#playing, reason, type: 'change' });
        this.#scrub?.controller.abort();
        const controller = new AbortController();
        const token = ++this.#scrubToken;
        this.#scrub = { controller, token };
        try {
            await this.#registry.replace(this.#layerId, descriptor, this.#replaceOptions(controller, options));
            if (token === this.#scrubToken)
                this.#setReadiness(index, 'ready');
        }
        catch (reasonValue) {
            if (token === this.#scrubToken) {
                this.#setReadiness(index, 'failed');
                this.#emit({ index, reason: reasonValue, type: 'error' });
            }
        }
        finally {
            if (this.#scrub?.token === token)
                this.#scrub = null;
        }
    }
    #replaceOptions(controller, options) {
        const crossfadeDurationMs = this.#reducedMotion
            ? 0
            : (options.crossfadeDurationMs ?? this.#crossfadeDurationMs);
        return {
            ...(this.#activateWhen !== undefined ? { activateWhen: this.#activateWhen } : {}),
            ...(crossfadeDurationMs !== undefined ? { crossfadeDurationMs } : {}),
            ...(this.#readinessTimeoutMs !== undefined
                ? { readinessTimeoutMs: this.#readinessTimeoutMs }
                : {}),
            signal: controller.signal,
        };
    }
    #prefetchOne(index) {
        const prefetchFrame = this.#prefetchFrame;
        const frame = this.#frames[index];
        if (!prefetchFrame || !frame)
            return Promise.resolve();
        if (this.readinessOf(index) === 'ready')
            return Promise.resolve();
        const inFlight = this.#prefetching.get(index);
        if (inFlight)
            return inFlight.promise;
        this.#setReadiness(index, 'loading');
        const controller = new AbortController();
        const promise = prefetchFrame(frame, index, controller.signal)
            // Readiness bookkeeping only; the chain is deliberately Promise<void>.
            .then(() => {
            // eslint-disable-next-line promise/always-return -- narduk-libs#138
            if (!controller.signal.aborted)
                this.#setReadiness(index, 'ready');
        })
            .catch((reason) => {
            if (controller.signal.aborted)
                return;
            this.#setReadiness(index, 'failed');
            this.#emit({ index, reason, type: 'error' });
        })
            .finally(() => {
            if (this.#prefetching.get(index)?.controller === controller)
                this.#prefetching.delete(index);
        });
        this.#prefetching.set(index, { controller, promise });
        return promise;
    }
    #cancelPrefetch() {
        for (const entry of this.#prefetching.values())
            entry.controller.abort();
        this.#prefetching.clear();
    }
    /** Move an index to the newest slot so bounded eviction drops it last. */
    #touch(index) {
        const readiness = this.#readiness.get(index);
        if (readiness === undefined)
            return;
        this.#readiness.delete(index);
        this.#readiness.set(index, readiness);
    }
    #setReadiness(index, readiness) {
        this.#readiness.delete(index);
        this.#readiness.set(index, readiness);
        this.#touch(this.#index);
        this.#readiness = boundedFrameCache(this.#readiness, this.#maxTrackedFrames);
        this.#emit({
            frame: this.#frames[index],
            index,
            progress: this.progress(),
            readiness,
            type: 'readiness',
        });
    }
    #emit(event) {
        for (const listener of [...this.#listeners])
            listener(event);
    }
}
/** Construct a {@link MapKitTemporalLayerController}. */
export function createTemporalLayerController(options) {
    return new MapKitTemporalLayerController(options);
}
//# sourceMappingURL=temporal.js.map