/**
 * Injectable timer surface shared by the temporal controller and the pointer
 * probe. Both primitives are time-dependent, and both must stay deterministic
 * under test without a real clock, a real browser, or MapKit JS.
 *
 * Handles are opaque on purpose: `setTimeout` returns a `number` in browsers
 * and a `Timeout` object in Node, and test doubles return whatever they like.
 */
export type MapKitTimerHandle = unknown;
export interface MapKitTimerScheduler {
    /** Cancel a handle previously returned by `schedule`. */
    cancel: (handle: MapKitTimerHandle) => void;
    /** Monotonic-enough millisecond clock; used for throttling decisions. */
    now: () => number;
    /** Run `callback` after at least `delayMs` milliseconds. */
    schedule: (callback: () => void, delayMs: number) => MapKitTimerHandle;
}
/** `globalThis` timers plus `Date.now()`. Used when no scheduler is injected. */
export declare const defaultMapKitTimerScheduler: MapKitTimerScheduler;
//# sourceMappingURL=timers.d.ts.map