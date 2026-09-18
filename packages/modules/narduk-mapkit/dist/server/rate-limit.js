export function createMapKitFixedWindowRateLimit(options) {
    const now = options.now ?? Date.now;
    const keyOf = options.key ?? ((context) => context.self);
    const windowMs = Math.max(1, options.windowSeconds) * 1000;
    const windows = new Map();
    return (context) => {
        const at = now();
        const key = keyOf(context);
        const window = windows.get(key);
        if (!window || at >= window.resetAtMs) {
            windows.set(key, { count: 1, resetAtMs: at + windowMs });
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