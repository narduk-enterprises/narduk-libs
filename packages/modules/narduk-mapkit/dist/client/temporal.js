export function nextDrawableFrame(state) {
    if (state.frameCount < 1 || state.readiness.get(state.current) !== 'ready')
        return null;
    const next = (state.current + 1) % state.frameCount;
    return state.readiness.get(next) === 'ready' ? next : null;
}
export function temporalProgress(state) {
    if (state.frameCount < 1)
        return 0;
    let ready = 0;
    for (let index = 0; index < state.frameCount; index++)
        if (state.readiness.get(index) === 'ready')
            ready++;
    return ready / state.frameCount;
}
export function boundedFrameCache(entries, maxEntries) {
    const result = new Map(entries);
    while (result.size > Math.max(1, maxEntries))
        result.delete(result.keys().next().value);
    return result;
}
//# sourceMappingURL=temporal.js.map