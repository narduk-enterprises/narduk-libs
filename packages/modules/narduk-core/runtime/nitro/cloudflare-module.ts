import * as nuxtAppConfig from '#internal/nuxt/app-config'
/**
 * Nitro entry for the `cloudflare_module` preset (operator-portal#2534).
 *
 * `src/cloudflare-asset-miss-entry.ts` points `nitro.options.entry` here and
 * aliases `#narduk-core/cloudflare-module-entry` to the preset's own entry, so
 * everything the preset does stays: this file only hands that entry an `env`
 * whose `ASSETS` answers a 404 `no-store`. See `runtime/shared/asset-miss-no-store.ts`.
 *
 * Opt out with `appConfig.narduk.assetMissNoStore = false`. The config is read
 * from Nuxt's server app-config virtual, once, at Worker start; when it is
 * missing the behaviour stays on.
 */
import original from '#narduk-core/cloudflare-module-entry'

import {
  isAssetMissNoStoreEnabled,
  withUncachedAssetMissHandler,
} from '../shared/asset-miss-no-store'

export * from '#narduk-core/cloudflare-module-entry'

export default withUncachedAssetMissHandler(
  original,
  isAssetMissNoStoreEnabled((nuxtAppConfig as { default?: unknown }).default),
)
