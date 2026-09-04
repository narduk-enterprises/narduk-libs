import { defaultMapKitTimerScheduler } from './timers.js'

import type { MapKitLayerDescriptor, MapKitLayerReplaceOptions } from './layers.js'
import type { MapKitTimerHandle, MapKitTimerScheduler } from './timers.js'

/**
 * Decode/readiness state of a single dated frame.
 *
 * - `idle`: nothing is known about the frame (never requested, or evicted from
 *   the bounded readiness cache).
 * - `loading`: a prefetch or a layer replacement for the frame is in flight.
 * - `ready`: the frame's tile source produced usable imagery.
 * - `failed`: the frame's tile source rejected; playback skips it.
 */
export type FrameReadiness = 'idle' | 'loading' | 'ready' | 'failed'

/** Plain-data snapshot of a temporal sequence, independent of MapKit JS. */
export interface TemporalPlaybackState {
  current: number
  frameCount: number
  readiness: ReadonlyMap<number, FrameReadiness>
}

/**
 * Index of the next frame that may be drawn without showing an empty layer.
 *
 * Returns `null` unless both the current frame and the wrapped next frame are
 * `ready`, which is what makes an animation loop readiness-gated rather than
 * time-gated: a loop that advances onto an undecoded frame flashes.
 */
export function nextDrawableFrame(state: TemporalPlaybackState): number | null {
  if (state.frameCount < 1 || state.readiness.get(state.current) !== 'ready') return null
  const next = (state.current + 1) % state.frameCount
  return state.readiness.get(next) === 'ready' ? next : null
}

/** Fraction of the sequence that is decoded and drawable, in `0..1`. */
export function temporalProgress(state: TemporalPlaybackState): number {
  if (state.frameCount < 1) return 0
  let ready = 0
  for (let index = 0; index < state.frameCount; index++)
    if (state.readiness.get(index) === 'ready') ready++
  return ready / state.frameCount
}

/**
 * Copy `entries` capped at `maxEntries`, dropping the oldest insertion first.
 *
 * Callers that want LRU behavior re-insert the entry they touched before
 * calling this, which is exactly what the temporal controller does with the
 * frame the map is currently showing.
 */
export function boundedFrameCache<T>(
  entries: ReadonlyMap<number, T>,
  maxEntries: number,
): Map<number, T> {
  const result = new Map(entries)
  while (result.size > Math.max(1, maxEntries)) result.delete(result.keys().next().value!)
  return result
}

const DEFAULT_INTERVAL_MS = 900
const DEFAULT_LOOP_WINDOW_SIZE = 7
const DEFAULT_PREFETCH_AHEAD = 2
const DEFAULT_MAX_TRACKED_FRAMES = 8

/** One dated frame of a temporal layer, plus optional consumer metadata. */
export interface TemporalFrame<TMeta = unknown> {
  /** Stable identity of the frame, typically a date id such as `2026-08-27`. */
  readonly id: string
  /** Consumer-owned metadata (coverage fraction, provenance, label, ...). */
  readonly meta?: TMeta
}

/** A frame, or the bare id of a frame that carries no metadata. */
export type TemporalFrameInput<TMeta = unknown> = string | TemporalFrame<TMeta>

/** Normalize a mixed id/frame list, dropping entries with an empty id. */
export function normalizeTemporalFrames<TMeta = unknown>(
  frames: ReadonlyArray<TemporalFrameInput<TMeta>> | null | undefined,
): Array<TemporalFrame<TMeta>> {
  if (!Array.isArray(frames)) return []
  return frames.flatMap((frame) => {
    if (typeof frame === 'string') return frame.trim() ? [{ id: frame }] : []
    if (!frame || typeof frame.id !== 'string' || !frame.id.trim()) return []
    return [frame.meta === undefined ? { id: frame.id } : { id: frame.id, meta: frame.meta }]
  })
}

/**
 * The slice of `MapKitLayerRegistry` the controller needs.
 *
 * Declared structurally so the controller can be driven by a registry, by a
 * test double, or by any other object that can swap one layer's tile source.
 */
export interface TemporalLayerTarget {
  replace(
    id: string,
    descriptor: MapKitLayerDescriptor,
    options?: MapKitLayerReplaceOptions,
  ): Promise<void>
}

/** Why the controller moved to a different frame. */
export type TemporalChangeReason = 'scrub' | 'step' | 'play' | 'frames'

/** Why playback stopped. */
export type TemporalPauseReason = 'user' | 'destroy' | 'frames' | 'reduced-motion' | 'stalled'

/** Everything the controller reports. Consumers own all rendering. */
export type TemporalControllerEvent<TMeta = unknown> =
  | {
      readonly frame: TemporalFrame<TMeta> | undefined
      readonly index: number
      readonly playing: boolean
      readonly reason: TemporalChangeReason
      readonly type: 'change'
    }
  | {
      readonly frame: TemporalFrame<TMeta> | undefined
      readonly index: number
      readonly progress: number
      readonly readiness: FrameReadiness
      readonly type: 'readiness'
    }
  | {
      readonly index: number
      readonly intervalMs: number
      readonly type: 'play'
      readonly windowSize: number
      readonly windowStart: number
    }
  | { readonly index: number; readonly reason: TemporalPauseReason; readonly type: 'pause' }
  | { readonly index: number; readonly type: 'stall'; readonly waitingFor: number }
  | { readonly index: number; readonly reason: unknown; readonly type: 'error' }

export type TemporalControllerListener<TMeta = unknown> = (
  event: TemporalControllerEvent<TMeta>,
) => void

export interface TemporalScrubOptions {
  /** Override the crossfade for this transition only. Ignored under reduced motion. */
  crossfadeDurationMs?: number
  /** Re-apply the descriptor even when the index is unchanged. */
  force?: boolean
}

export interface TemporalPlayOptions {
  /** Milliseconds between advance attempts. Default `900`. */
  intervalMs?: number
  /** Loop over the last N frames. Default `7`, clamped to the frame count. */
  windowSize?: number
}

export interface TemporalLayerControllerOptions<TMeta = unknown> {
  /** Forwarded to `registry.replace`. Default `'first-image'` for async sources. */
  activateWhen?: 'immediate' | 'first-image'
  /** Crossfade for frame changes. Omit to use the registry's own default. */
  crossfadeDurationMs?: number
  /**
   * Build the layer descriptor for a frame. The returned descriptor's `id`
   * must equal `layerId`; the controller throws otherwise rather than letting
   * the registry reject the swap mid-animation.
   */
  descriptorForFrame: (frame: TemporalFrame<TMeta>, index: number) => MapKitLayerDescriptor
  /** Ordered oldest-to-newest dated frames. */
  frames: ReadonlyArray<TemporalFrameInput<TMeta>>
  /**
   * Gate advancement on frame readiness. Defaults to `true` when
   * `prefetchFrame` is supplied and `false` otherwise, because without a
   * readiness source every frame would stall forever.
   */
  gateAdvanceOnReadiness?: boolean
  /** Starting index. Default `0`. */
  index?: number
  /** Default playback interval in milliseconds. Default `900`. */
  intervalMs?: number
  /** Registry id of the layer this controller owns. */
  layerId: string
  /** Default loop window. Default `7`. */
  loopWindowSize?: number
  /** Upper bound on remembered frame readiness. Default `8`. */
  maxTrackedFrames?: number
  onEvent?: TemporalControllerListener<TMeta>
  /** How many upcoming frames to warm. Default `2`. */
  prefetchAhead?: number
  /**
   * Warm a frame's tile source. Resolving marks the frame `ready`; rejecting
   * marks it `failed` and playback skips it.
   */
  prefetchFrame?: (
    frame: TemporalFrame<TMeta>,
    index: number,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Forwarded to `registry.replace` as the bounded readiness timeout. */
  readinessTimeoutMs?: number
  /**
   * Consumer-owned `prefers-reduced-motion` flag. When true, `play()` is
   * refused and every scrub is instant (crossfade `0`).
   */
  reducedMotion?: boolean
  registry: TemporalLayerTarget
  /** Injectable clock/timers. Default: `globalThis` timers and `Date.now()`. */
  timer?: MapKitTimerScheduler
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length < 1) return 0
  return Math.max(0, Math.min(length - 1, Math.trunc(index)))
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
export class MapKitTemporalLayerController<TMeta = unknown> {
  readonly #activateWhen: 'immediate' | 'first-image' | undefined
  readonly #crossfadeDurationMs: number | undefined
  readonly #descriptorForFrame: (
    frame: TemporalFrame<TMeta>,
    index: number,
  ) => MapKitLayerDescriptor
  readonly #gateAdvanceOnReadiness: boolean
  readonly #layerId: string
  readonly #listeners = new Set<TemporalControllerListener<TMeta>>()
  readonly #maxTrackedFrames: number
  readonly #prefetchAhead: number
  readonly #prefetchFrame:
    | ((frame: TemporalFrame<TMeta>, index: number, signal: AbortSignal) => Promise<unknown>)
    | undefined
  readonly #prefetching = new Map<number, { controller: AbortController; promise: Promise<void> }>()
  readonly #readinessTimeoutMs: number | undefined
  readonly #registry: TemporalLayerTarget
  readonly #timer: MapKitTimerScheduler

  #defaultIntervalMs: number
  #defaultWindowSize: number
  #destroyed = false
  #frames: Array<TemporalFrame<TMeta>>
  #index: number
  #intervalMs: number
  #playing = false
  #readiness = new Map<number, FrameReadiness>()
  #reducedMotion: boolean
  #scrub: { controller: AbortController; token: number } | null = null
  #scrubToken = 0
  #timerHandle: MapKitTimerHandle | null = null
  #windowSize: number

  constructor(options: TemporalLayerControllerOptions<TMeta>) {
    if (!options.layerId.trim()) throw new Error('layerId is required')

    this.#activateWhen = options.activateWhen
    this.#crossfadeDurationMs = options.crossfadeDurationMs
    this.#descriptorForFrame = options.descriptorForFrame
    this.#layerId = options.layerId
    this.#maxTrackedFrames = Math.max(1, options.maxTrackedFrames ?? DEFAULT_MAX_TRACKED_FRAMES)
    this.#prefetchAhead = Math.max(0, options.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD)
    this.#prefetchFrame = options.prefetchFrame
    this.#readinessTimeoutMs = options.readinessTimeoutMs
    this.#registry = options.registry
    this.#timer = options.timer ?? defaultMapKitTimerScheduler
    this.#gateAdvanceOnReadiness =
      options.gateAdvanceOnReadiness ?? options.prefetchFrame !== undefined

    this.#frames = normalizeTemporalFrames(options.frames)
    this.#index = clampIndex(options.index ?? 0, this.#frames.length)
    this.#reducedMotion = options.reducedMotion ?? false
    this.#defaultIntervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS)
    this.#defaultWindowSize = Math.max(1, options.loopWindowSize ?? DEFAULT_LOOP_WINDOW_SIZE)
    this.#intervalMs = this.#defaultIntervalMs
    this.#windowSize = this.#defaultWindowSize

    if (options.onEvent) this.#listeners.add(options.onEvent)
  }

  get destroyed(): boolean {
    return this.#destroyed
  }

  /** The current frame, or `undefined` when the sequence is empty. */
  get frame(): TemporalFrame<TMeta> | undefined {
    return this.#frames[this.#index]
  }

  get frames(): ReadonlyArray<TemporalFrame<TMeta>> {
    return this.#frames
  }

  get index(): number {
    return this.#index
  }

  get length(): number {
    return this.#frames.length
  }

  get playing(): boolean {
    return this.#playing
  }

  get reducedMotion(): boolean {
    return this.#reducedMotion
  }

  /** Snapshot in whole-sequence coordinates, for `temporalProgress` and UI. */
  state(): TemporalPlaybackState {
    const readiness = new Map<number, FrameReadiness>()
    for (let index = 0; index < this.#frames.length; index++) {
      readiness.set(index, this.readinessOf(index))
    }
    return { current: this.#index, frameCount: this.#frames.length, readiness }
  }

  /** Readiness of one frame. Unknown frames read `idle`, or `ready` when ungated. */
  readinessOf(index: number): FrameReadiness {
    const known = this.#readiness.get(index)
    if (known !== undefined) return known
    return this.#gateAdvanceOnReadiness ? 'idle' : 'ready'
  }

  /** Fraction of the sequence known to be drawable, in `0..1`. */
  progress(): number {
    return temporalProgress(this.state())
  }

  /** Index of a frame id, or `-1`. */
  indexOf(id: string): number {
    return this.#frames.findIndex((frame) => frame.id === id)
  }

  subscribe(listener: TemporalControllerListener<TMeta>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Record readiness observed outside the controller (tile errors, decoders). */
  markReadiness(index: number, readiness: FrameReadiness): void {
    if (index < 0 || index >= this.#frames.length) return
    this.#setReadiness(index, readiness)
  }

  /** Update the reduced-motion flag. Turning it on stops an active loop. */
  setReducedMotion(reducedMotion: boolean): void {
    if (this.#reducedMotion === reducedMotion) return
    this.#reducedMotion = reducedMotion
    if (reducedMotion && this.#playing) this.pause('reduced-motion')
  }

  /**
   * Replace the frame list. Playback stops, readiness is cleared (indices no
   * longer identify the same dates), and the index is clamped or re-anchored
   * to the previously current frame id when it survives.
   */
  setFrames(frames: ReadonlyArray<TemporalFrameInput<TMeta>>): void {
    const previousId = this.frame?.id
    if (this.#playing) this.pause('frames')
    this.#cancelPrefetch()
    this.#frames = normalizeTemporalFrames(frames)
    this.#readiness = new Map()
    const preserved = previousId === undefined ? -1 : this.indexOf(previousId)
    this.#index = preserved >= 0 ? preserved : clampIndex(this.#index, this.#frames.length)
    this.#emit({
      frame: this.frame,
      index: this.#index,
      playing: this.#playing,
      reason: 'frames',
      type: 'change',
    })
  }

  /** Move to `index` and swap the layer's tile source. */
  async scrubTo(index: number, options: TemporalScrubOptions = {}): Promise<void> {
    return this.#goTo(clampIndex(index, this.#frames.length), 'scrub', options)
  }

  /** Move to the frame with `id`. Unknown ids are ignored. */
  async scrubToId(id: string, options: TemporalScrubOptions = {}): Promise<void> {
    const index = this.indexOf(id)
    if (index < 0) return
    return this.#goTo(index, 'scrub', options)
  }

  /** Step `delta` frames. Clamps at the ends unless `wrap` is set. */
  async stepBy(
    delta: number,
    options: TemporalScrubOptions & { wrap?: boolean } = {},
  ): Promise<void> {
    if (this.#frames.length < 1) return
    const raw = this.#index + Math.trunc(delta)
    const next = options.wrap
      ? ((raw % this.#frames.length) + this.#frames.length) % this.#frames.length
      : clampIndex(raw, this.#frames.length)
    return this.#goTo(next, 'step', options)
  }

  async stepForward(options: TemporalScrubOptions & { wrap?: boolean } = {}): Promise<void> {
    return this.stepBy(1, options)
  }

  async stepBack(options: TemporalScrubOptions & { wrap?: boolean } = {}): Promise<void> {
    return this.stepBy(-1, options)
  }

  /**
   * Loop the last `windowSize` frames at `intervalMs`.
   *
   * Refused under reduced motion, which emits a `pause` event with reason
   * `reduced-motion` so a play button can reflect that nothing started.
   */
  play(options: TemporalPlayOptions = {}): void {
    if (this.#destroyed || this.#frames.length < 1) return
    if (this.#reducedMotion) {
      this.#emit({ index: this.#index, reason: 'reduced-motion', type: 'pause' })
      return
    }

    this.#intervalMs = Math.max(1, options.intervalMs ?? this.#defaultIntervalMs)
    this.#windowSize = Math.max(1, options.windowSize ?? this.#defaultWindowSize)
    const { size, start } = this.#windowRange()
    if (this.#index < start) {
      void this.#goTo(start, 'play', {})
    }

    if (this.#playing) return
    this.#playing = true
    this.#emit({
      index: this.#index,
      intervalMs: this.#intervalMs,
      type: 'play',
      windowSize: size,
      windowStart: start,
    })
    void this.prefetch()
    this.#schedule()
  }

  /** Stop the loop. Safe to call when not playing. */
  pause(reason: TemporalPauseReason = 'user'): void {
    this.#clearTimer()
    if (!this.#playing) return
    this.#playing = false
    this.#emit({ index: this.#index, reason, type: 'pause' })
  }

  toggle(options: TemporalPlayOptions = {}): void {
    if (this.#playing) this.pause()
    else this.play(options)
  }

  /**
   * Warm frames. Defaults to the current frame plus `prefetchAhead` upcoming
   * window frames. A no-op when no `prefetchFrame` was supplied.
   */
  async prefetch(indexes?: readonly number[]): Promise<void> {
    if (!this.#prefetchFrame) return
    const targets = indexes ?? this.#upcomingIndexes()
    await Promise.all(targets.map((index) => this.#prefetchOne(index)))
  }

  /** Cancel timers, in-flight prefetches, and the pending swap; drop listeners. */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.pause('destroy')
    this.#cancelPrefetch()
    this.#scrub?.controller.abort()
    this.#scrub = null
    this.#listeners.clear()
  }

  #windowRange(): { size: number; start: number } {
    const size = Math.max(1, Math.min(this.#windowSize, Math.max(1, this.#frames.length)))
    return { size, start: Math.max(0, this.#frames.length - size) }
  }

  #windowState(): TemporalPlaybackState {
    const { size, start } = this.#windowRange()
    const readiness = new Map<number, FrameReadiness>()
    for (let offset = 0; offset < size; offset++) {
      readiness.set(offset, this.readinessOf(start + offset))
    }
    return { current: clampIndex(this.#index - start, size), frameCount: size, readiness }
  }

  #upcomingIndexes(): number[] {
    if (this.#frames.length < 1) return []
    const { size, start } = this.#windowRange()
    const current = clampIndex(this.#index - start, size)
    const indexes = [this.#index]
    for (let ahead = 1; ahead <= Math.min(this.#prefetchAhead, size - 1); ahead++) {
      indexes.push(start + ((current + ahead) % size))
    }
    return [...new Set(indexes)]
  }

  /**
   * The next frame the loop may draw, or `null` while it must wait.
   *
   * Delegates the ready/ready check to `nextDrawableFrame` in window-local
   * coordinates, then diagnoses a `null` so a failed frame is skipped instead
   * of stalling the loop forever.
   */
  #nextPlayIndex(): number | null {
    const { size, start } = this.#windowRange()
    const state = this.#windowState()
    const drawable = nextDrawableFrame(state)
    if (drawable !== null) return start + drawable

    if (state.readiness.get(state.current) !== 'ready') {
      void this.prefetch([this.#index])
      return null
    }

    // Scan forward past failed frames, stopping before wrapping back onto the
    // frame already on screen.
    for (let hop = 1; hop < size; hop++) {
      const offset = (state.current + hop) % size
      const readiness = state.readiness.get(offset)
      if (readiness === 'failed') continue
      if (readiness === 'ready') return start + offset
      void this.prefetch([start + offset])
      return null
    }

    // Every other frame in the window failed; nothing will become drawable.
    this.pause('stalled')
    return null
  }

  #schedule(): void {
    if (!this.#playing || this.#destroyed) return
    this.#clearTimer()
    this.#timerHandle = this.#timer.schedule(() => {
      this.#timerHandle = null
      this.#tick()
    }, this.#intervalMs)
  }

  #clearTimer(): void {
    if (this.#timerHandle === null) return
    this.#timer.cancel(this.#timerHandle)
    this.#timerHandle = null
  }

  #tick(): void {
    if (!this.#playing || this.#destroyed) return

    // A swap still in flight owns the layer; skip this beat rather than
    // cancelling a crossfade that is already halfway through.
    if (this.#scrub) {
      this.#schedule()
      return
    }

    const next = this.#nextPlayIndex()
    if (next === null) {
      if (this.#playing) {
        this.#emit({ index: this.#index, type: 'stall', waitingFor: this.#index })
        this.#schedule()
      }
      return
    }

    void this.#goTo(next, 'play', {})
    void this.prefetch()
    this.#schedule()
  }

  async #goTo(
    index: number,
    reason: TemporalChangeReason,
    options: TemporalScrubOptions,
  ): Promise<void> {
    if (this.#destroyed || this.#frames.length < 1) return
    const frame = this.#frames[index]
    if (!frame) return
    if (index === this.#index && !options.force && this.#readiness.get(index) === 'ready') return

    const descriptor = this.#descriptorForFrame(frame, index)
    if (descriptor.id !== this.#layerId) {
      throw new Error(
        `descriptorForFrame must return a descriptor with id "${this.#layerId}", got "${descriptor.id}"`,
      )
    }

    this.#index = index
    this.#touch(index)
    if (this.readinessOf(index) !== 'ready') this.#setReadiness(index, 'loading')
    this.#emit({ frame, index, playing: this.#playing, reason, type: 'change' })

    this.#scrub?.controller.abort()
    const controller = new AbortController()
    const token = ++this.#scrubToken
    this.#scrub = { controller, token }

    try {
      await this.#registry.replace(
        this.#layerId,
        descriptor,
        this.#replaceOptions(controller, options),
      )
      if (token === this.#scrubToken) this.#setReadiness(index, 'ready')
    } catch (reasonValue) {
      if (token === this.#scrubToken) {
        this.#setReadiness(index, 'failed')
        this.#emit({ index, reason: reasonValue, type: 'error' })
      }
    } finally {
      if (this.#scrub?.token === token) this.#scrub = null
    }
  }

  #replaceOptions(
    controller: AbortController,
    options: TemporalScrubOptions,
  ): MapKitLayerReplaceOptions {
    const crossfadeDurationMs = this.#reducedMotion
      ? 0
      : (options.crossfadeDurationMs ?? this.#crossfadeDurationMs)
    return {
      ...(this.#activateWhen !== undefined ? { activateWhen: this.#activateWhen } : {}),
      ...(crossfadeDurationMs !== undefined ? { crossfadeDurationMs } : {}),
      ...(this.#readinessTimeoutMs !== undefined
        ? { readinessTimeoutMs: this.#readinessTimeoutMs }
        : {}),
      signal: controller.signal,
    }
  }

  #prefetchOne(index: number): Promise<void> {
    const prefetchFrame = this.#prefetchFrame
    const frame = this.#frames[index]
    if (!prefetchFrame || !frame) return Promise.resolve()
    if (this.readinessOf(index) === 'ready') return Promise.resolve()

    const inFlight = this.#prefetching.get(index)
    if (inFlight) return inFlight.promise

    this.#setReadiness(index, 'loading')
    const controller = new AbortController()
    const promise = prefetchFrame(frame, index, controller.signal)
      // Readiness bookkeeping only; the chain is deliberately Promise<void>.
      .then(() => {
        // eslint-disable-next-line promise/always-return -- narduk-libs#138
        if (!controller.signal.aborted) this.#setReadiness(index, 'ready')
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        this.#setReadiness(index, 'failed')
        this.#emit({ index, reason, type: 'error' })
      })
      .finally(() => {
        if (this.#prefetching.get(index)?.controller === controller) this.#prefetching.delete(index)
      })

    this.#prefetching.set(index, { controller, promise })
    return promise
  }

  #cancelPrefetch(): void {
    for (const entry of this.#prefetching.values()) entry.controller.abort()
    this.#prefetching.clear()
  }

  /** Move an index to the newest slot so bounded eviction drops it last. */
  #touch(index: number): void {
    const readiness = this.#readiness.get(index)
    if (readiness === undefined) return
    this.#readiness.delete(index)
    this.#readiness.set(index, readiness)
  }

  #setReadiness(index: number, readiness: FrameReadiness): void {
    this.#readiness.delete(index)
    this.#readiness.set(index, readiness)
    this.#touch(this.#index)
    this.#readiness = boundedFrameCache(this.#readiness, this.#maxTrackedFrames)
    this.#emit({
      frame: this.#frames[index],
      index,
      progress: this.progress(),
      readiness,
      type: 'readiness',
    })
  }

  #emit(event: TemporalControllerEvent<TMeta>): void {
    for (const listener of [...this.#listeners]) listener(event)
  }
}

/** Construct a {@link MapKitTemporalLayerController}. */
export function createTemporalLayerController<TMeta = unknown>(
  options: TemporalLayerControllerOptions<TMeta>,
): MapKitTemporalLayerController<TMeta> {
  return new MapKitTemporalLayerController(options)
}
