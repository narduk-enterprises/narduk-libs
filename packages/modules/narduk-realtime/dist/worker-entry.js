import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/**
 * Nuxt builds Nitro twice: once for the prerenderer and once for the deployment
 * preset. Only the preset build produces the Cloudflare Worker entry with a
 * `default` export; the prerenderer entry has none, so re-exporting `default`
 * from it would fail the build. This marker is what distinguishes them.
 */
export const CLOUDFLARE_PRESET_ENTRY_MARKER = '/presets/cloudflare/';
/** Name of the generated entry written into the Nitro build directory. */
export const WORKER_ENTRY_FILENAME = 'narduk-realtime-worker-entry.mjs';
/**
 * Compose the generated Worker entry.
 *
 * Nitro pins the entry chunk name to `index.mjs`, so wrapping its entry this way
 * leaves the wrangler `main` path unchanged; the built Worker simply gains one
 * named export per Durable Object class alongside the default fetch handler.
 */
export function buildWorkerEntrySource(nitroEntry, durableObjects) {
    return [
        `export { default } from ${JSON.stringify(nitroEntry)}`,
        ...durableObjects.map(({ className, modulePath }) => `export { ${className} } from ${JSON.stringify(modulePath)}`),
        '',
    ].join('\n');
}
/**
 * Build the Nitro `rollup:before` handler that re-exports every declared
 * Durable Object class from the Cloudflare Worker entry.
 *
 * The handler is a no-op for any Nitro build that is not the Cloudflare preset
 * build, and a no-op when no Durable Objects are declared.
 */
export function createWorkerEntryHook(durableObjects) {
    return (nitro, rollupConfig) => {
        if (durableObjects.length === 0)
            return;
        if (!nitro.options.entry.includes(CLOUDFLARE_PRESET_ENTRY_MARKER))
            return;
        const entryPath = join(nitro.options.buildDir, WORKER_ENTRY_FILENAME);
        mkdirSync(dirname(entryPath), { recursive: true });
        writeFileSync(entryPath, buildWorkerEntrySource(nitro.options.entry, durableObjects), 'utf8');
        rollupConfig.input = entryPath;
    };
}
//# sourceMappingURL=worker-entry.js.map