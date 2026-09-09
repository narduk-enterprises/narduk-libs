import { resolveDurableObjects } from './options.js';
import { createWorkerEntryHook } from './worker-entry.js';
/**
 * Wire the declared Durable Objects into the Cloudflare Worker build.
 *
 * Resolution happens here rather than inside the build hook so that a typo in a
 * class name or a missing module fails the configuration immediately instead of
 * midway through a Cloudflare build. Returns the resolved objects so a caller
 * (and the tests) can see exactly what was wired.
 */
export function installDurableObjectExports(durableObjects, rootDir, hooks) {
    const resolved = resolveDurableObjects(durableObjects, rootDir);
    if (resolved.length === 0)
        return resolved;
    const writeWorkerEntry = createWorkerEntryHook(resolved);
    hooks.hook('nitro:init', (nitro) => {
        nitro.hooks.hook('rollup:before', writeWorkerEntry);
    });
    return resolved;
}
//# sourceMappingURL=setup.js.map