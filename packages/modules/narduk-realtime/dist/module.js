import { defineNuxtModule } from '@nuxt/kit';
import { installRealtimeWorkerEntry } from './setup.js';
// Annotated explicitly: @nuxt/kit 4.5.x infers the return type from
// @nuxt/schema without re-exporting `NuxtModule`, so declaration emit cannot
// name it from a bare specifier (TS2742).
const nardukRealtimeModule = defineNuxtModule({
    meta: {
        name: '@narduk-enterprises/narduk-realtime',
        configKey: 'realtime',
        compatibility: {
            nuxt: '>=3.16.0',
        },
    },
    defaults: {
        durableObjects: {},
        upgrades: [],
    },
    setup(options, nuxt) {
        installRealtimeWorkerEntry({
            durableObjects: options.durableObjects ?? {},
            upgrades: options.upgrades ?? [],
            rootDir: nuxt.options.rootDir,
            // See the NuxtHookRegistry doc comment: `nitro:init` is not part of the
            // standalone `NuxtHooks` type.
            hooks: nuxt.hooks,
        });
    },
});
export default nardukRealtimeModule;
export { NardukRealtimeConfigurationError, resolveDurableObjects, resolveUpgrades, } from './options.js';
export { installDurableObjectExports, installRealtimeWorkerEntry } from './setup.js';
export { buildWorkerEntrySource, CLOUDFLARE_PRESET_ENTRY_MARKER, createWorkerEntryHook, UPGRADE_ROUTER_MODULE, WORKER_ENTRY_FILENAME, } from './worker-entry.js';
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER } from './worker/principal.js';
//# sourceMappingURL=module.js.map