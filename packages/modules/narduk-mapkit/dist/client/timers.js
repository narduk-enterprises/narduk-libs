/** `globalThis` timers plus `Date.now()`. Used when no scheduler is injected. */
export const defaultMapKitTimerScheduler = {
    cancel: (handle) => {
        globalThis.clearTimeout(handle);
    },
    now: () => Date.now(),
    schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};
//# sourceMappingURL=timers.js.map