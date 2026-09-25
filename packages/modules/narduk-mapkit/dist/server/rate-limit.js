const DEFAULT_MAX_KEYS = 10_000;
export function createMapKitFixedWindowRateLimit(options) {
    const now = options.now ?? Date.now;
    const keyOf = options.key ?? ((context) => context.self);
    const windowMs = Math.max(1, options.windowSeconds) * 1000;
    const maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
    /**
     * Insertion order is reset order: every window is the same length and a renewed window is
     * re-inserted at the back, so expired windows are always at the front.
     */
    const windows = new Map();
    return (context) => {
        const at = now();
        for (const [staleKey, stale] of windows) {
            if (at < stale.resetAtMs)
                break;
            windows.delete(staleKey);
        }
        const key = keyOf(context);
        const window = windows.get(key);
        if (!window || at >= window.resetAtMs) {
            // Delete first so a renewed window moves to the back (a clock that steps backwards can
            // leave an expired window behind a live one, which the sweep above then stops at).
            windows.delete(key);
            windows.set(key, { count: 1, resetAtMs: at + windowMs });
            if (windows.size > maxKeys) {
                const oldestKey = windows.keys().next().value;
                if (oldestKey !== undefined)
                    windows.delete(oldestKey);
            }
            return { allowed: true };
        }
        window.count += 1;
        if (window.count <= options.limit)
            return { allowed: true };
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - at) / 1000)),
        };
    };
}
//# sourceMappingURL=rate-limit.js.map