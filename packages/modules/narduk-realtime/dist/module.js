import { defineNuxtModule } from '@nuxt/kit';
import { installDurableObjectExports } from './setup.js';
export default defineNuxtModule({
    meta: {
        name: '@narduk-enterprises/narduk-realtime',
        configKey: 'realtime',
        compatibility: {
            nuxt: '>=3.16.0',
        },
    },
    defaults: {
        durableObjects: {},
    },
    setup(options, nuxt) {
        installDurableObjectExports(options.durableObjects ?? {}, nuxt.options.rootDir, 
        // See the NuxtHookRegistry doc comment: `nitro:init` is not part of the
        // standalone `NuxtHooks` type.
        nuxt.hooks);
    },
});
export { NardukRealtimeConfigurationError, resolveDurableObjects } from './options.js';
export { installDurableObjectExports } from './setup.js';
export { buildWorkerEntrySource, CLOUDFLARE_PRESET_ENTRY_MARKER, createWorkerEntryHook, WORKER_ENTRY_FILENAME, } from './worker-entry.js';
//# sourceMappingURL=module.js.map