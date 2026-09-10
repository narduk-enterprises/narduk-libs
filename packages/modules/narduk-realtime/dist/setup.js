import { resolveDurableObjects, resolveUpgrades } from './options.js';
import { createWorkerEntryHook } from './worker-entry.js';
/**
 * Wire the declared Durable Objects and upgrade routes into the Worker build.
 *
 * Resolution happens here rather than inside the build hook so that a typo in a
 * class name, a missing module, or an upgrade route whose `idFrom` names no
 * parameter fails the configuration immediately instead of midway through a
 * Cloudflare build -- or, worse, at request time on a deployed Worker. Returns
 * what was wired so a caller (and the tests) can see exactly that.
 */
export function installRealtimeWorkerEntry(options) {
    const durableObjects = resolveDurableObjects(options.durableObjects ?? {}, options.rootDir);
    const upgrades = resolveUpgrades(options.upgrades, options.rootDir);
    if (durableObjects.length === 0 && upgrades.length === 0)
        return { durableObjects, upgrades };
    const writeWorkerEntry = createWorkerEntryHook(durableObjects, upgrades);
    options.hooks.hook('nitro:init', (nitro) => {
        nitro.hooks.hook('rollup:before', writeWorkerEntry);
    });
    return { durableObjects, upgrades };
}
/**
 * Wire the declared Durable Objects into the Cloudflare Worker build.
 *
 * The 0.1.0 entry point, kept for callers that only export classes.
 * {@link installRealtimeWorkerEntry} is the full surface.
 */
export function installDurableObjectExports(durableObjects, rootDir, hooks) {
    return installRealtimeWorkerEntry({ durableObjects, rootDir, hooks }).durableObjects;
}
//# sourceMappingURL=setup.js.map