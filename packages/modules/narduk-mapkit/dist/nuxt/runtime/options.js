/**
 * Resolution order for the runtime options `<AppMapKit>` and `useMapKit()` need.
 *
 * Per-call argument, then the module's own configuration as the app set it, then
 * the documented default. The module publishes its non-secret configuration at
 * `runtimeConfig.public.nardukMapKit` -- a deliberate addition to the §b.1 table,
 * so the component can read `libraries` without a second source of truth and
 * without a virtual module that plain `tsc` cannot compile. Nothing secret is
 * ever placed there: no token, no key, no origin list.
 */
import { useRuntimeConfig } from '#imports';
import { DEFAULT_MAPKIT_LIBRARIES, DEFAULT_MAPKIT_TOKEN_ROUTE } from './defaults.js';
export { DEFAULT_MAPKIT_LIBRARIES, DEFAULT_MAPKIT_TOKEN_ROUTE } from './defaults.js';
export function readMapKitPublicOptions() {
    const config = useRuntimeConfig();
    const published = config.public['nardukMapKit'];
    if (typeof published !== 'object' || published === null)
        return {};
    return published;
}
export function resolveMapKitRuntimeOptions(overrides) {
    const published = readMapKitPublicOptions();
    const libraries = overrides.libraries ?? published.libraries ?? DEFAULT_MAPKIT_LIBRARIES;
    if (libraries.length === 0) {
        throw new Error('libraries is required: MapKit JS 6 loads no map library by default, so an empty list ' +
            'produces a namespace with no mapkit.Map on it at all.');
    }
    return {
        language: overrides.language ?? published.language,
        libraries,
        tokenEndpoint: overrides.tokenEndpoint ?? published.tokenRoutePath ?? DEFAULT_MAPKIT_TOKEN_ROUTE,
    };
}
//# sourceMappingURL=options.js.map