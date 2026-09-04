/** `globalThis` timers plus `Date.now()`. Used when no scheduler is injected. */
export const defaultMapKitTimerScheduler = {
    cancel: (handle) => {
        globalThis.clearTimeout(handle);
    },
    now: () => Date.now(),
    schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};
/**
 * `globalThis` animation frames, falling back to a ~60fps `setTimeout` where
 * they do not exist (Workers, Node, headless test runs).
 */
export const defaultMapKitFrameScheduler = {
    cancelAnimationFrame: (handle) => {
        const cancelFrame = globalThis.cancelAnimationFrame;
        if (cancelFrame) {
            cancelFrame.call(globalThis, handle);
            return;
        }
        globalThis.clearTimeout(handle);
    },
    requestAnimationFrame: (callback) => {
        const requestFrame = globalThis.requestAnimationFrame;
        if (requestFrame)
            return requestFrame.call(globalThis, callback);
        return globalThis.setTimeout(() => callback(Date.now()), 16);
    },
};
//# sourceMappingURL=timers.js.map