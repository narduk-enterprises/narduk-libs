/**
 * The two documented defaults, in a file that imports nothing.
 *
 * They live apart from `options.ts` because the module (`src/nuxt/index.ts`)
 * needs them at build time, in plain Node, while `options.ts` imports
 * `#imports` -- a specifier that only Vite resolves. `check:package`
 * dynamically imports every published entry with bare `node`, so a module whose
 * graph reaches `#imports` fails to load at all.
 */
import type { MapKitLibrary } from '../../client/mapkit.js'

/**
 * MapKit JS 6 ships `mapkit.core.js` as a stub, so the list is what decides
 * whether there is a `mapkit.Map` at all. These three are what 2.0.x hard-coded;
 * 2.1.0 keeps them as the DEFAULT and makes the list configurable
 * (narduk-libs#422 §b) so an app that draws only pins can drop `overlays`.
 */
export const DEFAULT_MAPKIT_LIBRARIES: MapKitLibrary[] = ['map', 'annotations', 'overlays']

export const DEFAULT_MAPKIT_TOKEN_ROUTE = '/api/mapkit-token'
