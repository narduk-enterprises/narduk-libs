/**
 * Retired canonical-redirect middleware, kept as a source-compatible alias.
 *
 * narduk-libs#409: this module used to sit in the auto-scanned `middleware/`
 * tree beside `00-canonical-host.ts`, so every consuming app registered two
 * canonical-host redirects that disagreed -- 301 here, 308 there, with
 * different dev gates. The implementation is gone and `00-canonical-host` is
 * the single live redirect. The module stays, outside the scan directory, so an
 * app that imports the handler directly (lakestat-us runs the core middleware
 * chain by hand around a Nitro routing workaround) keeps compiling and now gets
 * the one live behaviour instead of a second, conflicting one.
 *
 * @deprecated Import
 * `@narduk-enterprises/narduk-core/server/middleware/00-canonical-host`.
 */
import { readRuntimeString } from '../utils/runtime-env'

import type { useRuntimeConfig } from 'nitropack/runtime'

export { default } from '../middleware/00-canonical-host'

function isLocalhost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * @deprecated Read `SITE_URL` (falling back to `runtimeConfig.public.appUrl`)
 * directly. Retained only because it was a published export of the retired
 * middleware; nothing in the workspace calls it.
 */
export function resolveCanonicalOrigin(
  event: Parameters<typeof readRuntimeString>[0],
  config: ReturnType<typeof useRuntimeConfig>,
) {
  const siteUrl = readRuntimeString(event, 'SITE_URL', { config, fallback: config.public.appUrl })
  if (!siteUrl) return null

  try {
    const canonicalOrigin = new URL(siteUrl)
    return isLocalhost(canonicalOrigin.hostname) ? null : canonicalOrigin
  } catch {
    return null
  }
}
