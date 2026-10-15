import { isAssetMissNoStoreEnabled } from '../runtime/shared/asset-miss-no-store'

/** Alias the wrapper entry imports; it points at the preset's own entry. */
export const CLOUDFLARE_MODULE_ENTRY_ALIAS = '#narduk-core/cloudflare-module-entry'

/**
 * The `cloudflare_module` preset's default entry, in nitropack's `dist`. A
 * path match, not a preset-name match: `cloudflare_durable`, the legacy module
 * preset, `nitro-prerender`, `cloudflare-dev` and an app's own `nitro.entry`
 * all have a different entry and are left as they are.
 */
const CLOUDFLARE_MODULE_DEFAULT_ENTRY =
  /[\\/]presets[\\/]cloudflare[\\/]runtime[\\/]cloudflare-module(?:\.mjs)?$/

export interface NitroEntryHost {
  options: {
    alias: Record<string, string>
    dev?: boolean
    entry?: string
  }
}

/**
 * Points a Nitro `cloudflare_module` build at the wrapper entry that answers an
 * asset 404 `no-store` (operator-portal#2534). Returns whether it did.
 *
 * Runs in `nitro:init`: `entry` is resolved by then and the alias is read when
 * the rollup config is built. A build opts out with
 * `appConfig.narduk.assetMissNoStore = false` in `nuxt.config`; the wrapper
 * itself also reads `app.config.ts` at run time.
 */
export function applyAssetMissNoStoreEntry(
  nitro: NitroEntryHost,
  wrapperEntry: string,
  appConfig?: unknown,
): boolean {
  const { entry } = nitro.options
  if (nitro.options.dev || typeof entry !== 'string') return false
  if (!CLOUDFLARE_MODULE_DEFAULT_ENTRY.test(entry)) return false
  if (!isAssetMissNoStoreEnabled(appConfig)) return false

  nitro.options.alias = { ...nitro.options.alias, [CLOUDFLARE_MODULE_ENTRY_ALIAS]: entry }
  nitro.options.entry = wrapperEntry
  return true
}
