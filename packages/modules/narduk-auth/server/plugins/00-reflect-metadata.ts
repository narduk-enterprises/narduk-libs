import { defineNitroPlugin } from 'nitropack/runtime'

import {
  installReflectMetadataPolyfill,
  reflectMetadataPolyfillInstalled,
} from '../lib/app-auth/reflect-metadata-polyfill'

void reflectMetadataPolyfillInstalled
installReflectMetadataPolyfill()

/**
 * Install the Reflect metadata polyfill before passkey routes import
 * `@simplewebauthn/server` → tsyringe (narduk-libs#786).
 *
 * The installer runs at module evaluation — not only inside the plugin
 * callback — because a route module in the same Worker graph can evaluate
 * tsyringe before Nitro invokes plugins. The callback re-installs in case a
 * later runtime reset `Reflect`.
 */
export default defineNitroPlugin(() => {
  installReflectMetadataPolyfill()
})
