/**
 * Drop the memoized fallback limiter. A test that changes the configured
 * ceiling needs the next request to rebuild it; without this the only way to
 * get a fresh one is a second module instance, which no supported runtime has.
 */
export declare function resetMapKitRateLimitForTests(): void;
declare const _default: import("h3").EventHandler<import("h3").EventHandlerRequest, Promise<Response>>;
export default _default;
//# sourceMappingURL=mapkit-token.get.d.ts.map