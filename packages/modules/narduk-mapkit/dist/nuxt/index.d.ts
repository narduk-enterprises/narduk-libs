import type { ModuleOptions } from './types.js';
import type { NuxtModule } from '@nuxt/schema';
export type * from './types.js';
export type { MapKitCalloutEntry, MapKitCalloutPlacement } from './runtime/callout-host.js';
export type { MapKitPinAnchor, MapKitPinGeometry } from './runtime/pin-geometry.js';
export type { MapKitDiff, MapKitPinElement, MapKitPinItem } from './runtime/pin-layer.js';
export { mapKitColorModeInjectionKey, mapKitNonceInjectionKey } from './runtime/injection-keys.js';
/**
 * Annotated rather than inferred: `@nuxt/kit` types `defineNuxtModule`'s return
 * as `@nuxt/schema`'s `NuxtModule` without re-exporting it, so an inferred
 * `export default` emits a `.d.ts` that names a path inside the pnpm store.
 */
declare const module: NuxtModule<ModuleOptions>;
export default module;
export type { MapKitPublicRuntimeOptions } from './runtime/options.js';
//# sourceMappingURL=index.d.ts.map