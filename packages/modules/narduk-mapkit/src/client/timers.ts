/**
 * Injectable timer surface shared by the temporal controller and the pointer
 * probe. Both primitives are time-dependent, and both must stay deterministic
 * under test without a real clock, a real browser, or MapKit JS.
 *
 * Handles are opaque on purpose: `setTimeout` returns a `number` in browsers
 * and a `Timeout` object in Node, and test doubles return whatever they like.
 */
export type MapKitTimerHandle = unknown

export interface MapKitTimerScheduler {
  /** Cancel a handle previously returned by `schedule`. */
  cancel: (handle: MapKitTimerHandle) => void
  /** Monotonic-enough millisecond clock; used for throttling decisions. */
  now: () => number
  /** Run `callback` after at least `delayMs` milliseconds. */
  schedule: (callback: () => void, delayMs: number) => MapKitTimerHandle
}

/** `globalThis` timers plus `Date.now()`. Used when no scheduler is injected. */
export const defaultMapKitTimerScheduler: MapKitTimerScheduler = {
  cancel: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  },
  now: () => Date.now(),
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
}

/**
 * Injectable animation-frame surface. Frame-paced primitives -- the overlay
 * crossfade and the render scheduler -- share it so a test can drive frames by
 * hand, and so a Worker or Node import never touches `requestAnimationFrame`.
 */
export interface MapKitFrameScheduler {
  cancelAnimationFrame: (handle: number) => void
  requestAnimationFrame: (callback: FrameRequestCallback) => number
}

/**
 * `globalThis` animation frames, falling back to a ~60fps `setTimeout` where
 * they do not exist (Workers, Node, headless test runs).
 */
export const defaultMapKitFrameScheduler: MapKitFrameScheduler = {
  cancelAnimationFrame: (handle) => {
    const cancelFrame = globalThis.cancelAnimationFrame
    if (cancelFrame) {
      cancelFrame.call(globalThis, handle)
      return
    }
    globalThis.clearTimeout(handle)
  },
  requestAnimationFrame: (callback) => {
    const requestFrame = globalThis.requestAnimationFrame
    if (requestFrame) return requestFrame.call(globalThis, callback)
    return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number
  },
}
