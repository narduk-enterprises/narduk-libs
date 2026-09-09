import type { ResolvedDurableObject } from './worker-entry.js';
export declare class NardukRealtimeConfigurationError extends Error {
    constructor(message: string);
}
/**
 * Validate and resolve the `realtime.durableObjects` map.
 *
 * Entries are returned sorted by class name so that the generated Worker entry
 * is byte-identical across builds of the same configuration.
 */
export declare function resolveDurableObjects(durableObjects: Record<string, string>, rootDir: string): ResolvedDurableObject[];
//# sourceMappingURL=options.d.ts.map