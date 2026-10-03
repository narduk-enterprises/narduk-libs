/**
 * Three first-paint defaults every narduk app inherits (narduk-libs#1369). Each
 * is on unless the app opts out, and an explicit app value always wins:
 *
 * - `componentDetection`: `ui.experimental.componentDetection: true`. Without
 *   it Tailwind generates every Nuxt UI component theme into the entry
 *   stylesheet, which is render-blocking. Detection scans the app and its
 *   layers; first-party modules name their own components (see
 *   `first-party-nuxt-ui-components.ts` and `nuxt-ui-sources.ts`). Opt out with
 *   `ui: { experimental: { componentDetection: false } }`, or name components a
 *   module-only render needs with `componentDetection: ['UCard', ...]`.
 * - `resourceHints`: a `build:manifest` hook that sets `prefetch = false` on
 *   every manifest entry and `preload = false` on script entries, so the page
 *   head stops carrying about fifteen `modulepreload` links and several
 *   `prefetch` links that compete with the stylesheet on a slow link. Navigation
 *   still loads each route's chunks on demand.
 * - `linkPrefetch`: `experimental.defaults.nuxtLink.prefetchOn` becomes
 *   `{ visibility: false, interaction: true }`, so a link prefetches its route
 *   on hover or focus, not whenever it scrolls into view. An app that sets
 *   either key in its own config keeps that key.
 *
 * Opt out of any one with `nardukCore: { performance: { <name>: false } }`.
 */
import { firstPartyNuxtUiComponents } from './first-party-nuxt-ui-components'
import { extendNuxtUiComponentDetection } from './nuxt-ui-sources'

export interface NardukCorePerformanceOptions {
  /** Default `true`. `false` leaves `ui.experimental.componentDetection` as the app set it. */
  componentDetection?: boolean
  /** Default `true`. `false` keeps Nuxt's visibility-based link prefetch. */
  linkPrefetch?: boolean
  /** Default `true`. `false` keeps Nuxt's `modulepreload` and `prefetch` head links. */
  resourceHints?: boolean
}

interface ManifestEntry {
  prefetch?: boolean
  preload?: boolean
  resourceType?: string
}

interface PrefetchOn {
  interaction?: boolean
  visibility?: boolean
}

interface ConfigLayerLike {
  config?: {
    experimental?: { defaults?: { nuxtLink?: { prefetchOn?: unknown } } }
  }
}

export interface LinkPrefetchHost {
  _layers?: readonly ConfigLayerLike[]
  experimental?: Record<string, unknown>
}

/**
 * Turns Nuxt UI component detection on in place when the app did not decide.
 * Mutating rather than copying matters: `@nuxt/ui` keeps a reference to this
 * object, so the install and the later `modules:done` additions must share it.
 */
export function applyComponentDetectionDefault(host: { ui?: unknown }): void {
  const ui = (host.ui ??= {}) as { experimental?: { componentDetection?: boolean | string[] } }
  ui.experimental ??= {}
  ui.experimental.componentDetection ??= true
}

/** The `build:manifest` handler: no prefetch anywhere, no preload for scripts. */
export function trimManifestResourceHints(manifest: Record<string, ManifestEntry>): void {
  for (const entry of Object.values(manifest)) {
    entry.prefetch = false
    if (entry.resourceType === 'script') entry.preload = false
  }
}

/** The raw `prefetchOn` an app or layer wrote, before Nuxt's schema defaults. */
function explicitPrefetchOn(layers: readonly ConfigLayerLike[] | undefined): unknown[] {
  return (layers ?? [])
    .map((layer) => layer.config?.experimental?.defaults?.nuxtLink?.prefetchOn)
    .filter((value) => value !== undefined)
}

/**
 * Sets `visibility: false` and `interaction: true` unless a config layer wrote
 * that key. Nuxt's schema already fills `prefetchOn: { visibility: true }` into
 * the resolved options, so the resolved value cannot tell the app's choice from
 * the framework default; the layers' raw configs can.
 */
export function applyLinkPrefetchDefaults(host: LinkPrefetchHost): void {
  const raw = explicitPrefetchOn(host._layers)
  // A non-object value (`false`) is the app switching prefetch triggers off
  // wholesale: leave it.
  if (raw.some((value) => typeof value !== 'object' || value === null)) return
  const written = raw as PrefetchOn[]
  const experimental = (host.experimental ??= {}) as {
    defaults?: { nuxtLink?: { prefetchOn?: PrefetchOn | boolean } }
  }
  const defaults = (experimental.defaults ??= {})
  const nuxtLink = (defaults.nuxtLink ??= {})
  const current = typeof nuxtLink.prefetchOn === 'object' ? nuxtLink.prefetchOn : {}
  const prefetchOn: PrefetchOn = { ...current }
  if (!written.some((value) => value.visibility !== undefined)) prefetchOn.visibility = false
  if (!written.some((value) => value.interaction !== undefined)) prefetchOn.interaction = true
  nuxtLink.prefetchOn = prefetchOn
}

interface InstalledModule {
  meta?: { name?: unknown }
}

/** The slice of the Nuxt instance `registerPerformanceDefaults` touches. */
export interface PerformanceDefaultsHost {
  hook: (name: string, handler: (...args: never[]) => unknown) => unknown
  options: LinkPrefetchHost & {
    _installedModules?: readonly InstalledModule[]
    ui?: unknown
  }
}

/**
 * Wires the three defaults, plus the `U*` components of the first-party modules
 * that are installed (a module is not a layer, so detection never scans them).
 * Call before `@nuxt/ui` installs, which reads component detection in its setup.
 */
export function registerPerformanceDefaults(
  nuxt: PerformanceDefaultsHost,
  performance: NardukCorePerformanceOptions = {},
): void {
  const { options } = nuxt
  if (performance.componentDetection !== false) applyComponentDetectionDefault(options)
  if (performance.linkPrefetch !== false) applyLinkPrefetchDefaults(options)
  if (performance.resourceHints !== false) nuxt.hook('build:manifest', trimManifestResourceHints)
  nuxt.hook('modules:done', () => {
    extendNuxtUiComponentDetection(
      options.ui,
      firstPartyNuxtUiComponents(options._installedModules),
    )
  })
}
