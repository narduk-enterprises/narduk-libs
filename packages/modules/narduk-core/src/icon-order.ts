/**
 * The icons narduk-core's own components render, seeded into `@nuxt/icon`'s
 * client bundle so they paint without a request. `check`, `copy` and `link`
 * are `AppCopyButton` / `AppShareButtons` (narduk-libs#467).
 */
export const CORE_CLIENT_BUNDLE_ICONS = [
  'lucide:check',
  'lucide:copy',
  'lucide:link',
  'lucide:menu',
  'lucide:monitor',
  'lucide:moon',
  'lucide:sun',
  'lucide:x',
] as const

interface InstalledModule {
  meta?: { name?: string }
}

/**
 * A warning when `@nuxt/icon` was installed before narduk-core with the
 * Iconify API fallback still on, or `undefined` when the seed reached it.
 *
 * `@nuxt/icon` reads `nuxt.options.icon` once, in its own setup. An app that
 * lists `@nuxt/icon` before narduk-core in `modules` has already installed it
 * by the time narduk-core seeds `fallbackToApi: false`, and the seed cannot
 * rewind that: an unbundled icon is then fetched from `api.iconify.design`,
 * which an enforcing CSP refuses (narduk-libs#467, riverstatus#132). An app
 * that set `fallbackToApi: false` itself is fine in either order.
 */
export function iconSeedArrivedLate(options: {
  _installedModules?: readonly InstalledModule[]
  icon?: unknown
}): string | undefined {
  const installed = (options._installedModules ?? []).some(
    (entry) => entry?.meta?.name === '@nuxt/icon',
  )
  if (!installed) return undefined
  const { icon } = options
  if (
    icon &&
    typeof icon === 'object' &&
    (icon as { fallbackToApi?: unknown }).fallbackToApi === false
  )
    return undefined
  return (
    '@narduk-enterprises/narduk-core: @nuxt/icon was installed before narduk-core, so its ' +
    'local-only icon contract (fallbackToApi: false) arrived too late and icons can still be ' +
    'fetched from api.iconify.design, which an enforcing CSP refuses. List ' +
    "'@narduk-enterprises/narduk-core' before '@nuxt/icon' in nuxt.config modules, or set " +
    'icon.fallbackToApi: false in nuxt.config (narduk-libs#467).'
  )
}
