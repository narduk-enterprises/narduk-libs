/**
 * `@narduk-enterprises/narduk-mapkit/nuxt` -- the Nuxt module for 2.1.0.
 *
 * `@narduk-enterprises/narduk-mapkit-nuxt` stays frozen at 2.0.x and receives no
 * 2.1.0 release, so no existing app can be handed this component by a version
 * bump: adopting it is an edit to `nuxt.config.ts`, i.e. a migration PR.
 *
 * What the module does NOT carry over from that adapter, all of it with zero
 * consumers: the `callouts*` props, `<AppMapKitCallout>`, `useMapKitCallouts`,
 * `useMapkitToken`, `fullscreenControl` / `fullscreenMode` and `centerLabel`.
 * The callout need is met by the `#callout` slot instead. The token route
 * still honours a limiter an app mounts on `event.context.nardukMapKit.rateLimit`,
 * and applies none of its own unless the app sets `rateLimit`.
 */
import {
  addComponent,
  addImports,
  addServerHandler,
  addTemplate,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'

import { DEFAULT_MAPKIT_LIBRARIES, DEFAULT_MAPKIT_TOKEN_ROUTE } from './runtime/defaults.js'
import { MAPKIT_COMPONENT_CSS } from './runtime/styles.js'

import type { MapKitPublicRuntimeOptions } from './runtime/options.js'
import type { ModuleOptions } from './types.js'
import type { NuxtModule } from '@nuxt/schema'

export type * from './types.js'
export type { MapKitBasemap } from './runtime/basemap.js'
export type { MapKitCalloutEntry, MapKitCalloutPlacement } from './runtime/callout-host.js'
export type { MapKitPinAnchor, MapKitPinGeometry } from './runtime/pin-geometry.js'
export type { MapKitDiff, MapKitPinElement, MapKitPinItem } from './runtime/pin-layer.js'
export type {
  AppMapKitItemProps,
  AppMapKitProps,
  AppMapKitSlots,
  MapKitCalloutSlotScope,
} from './runtime/components/AppMapKit.js'
export { mapKitColorModeInjectionKey, mapKitNonceInjectionKey } from './runtime/injection-keys.js'
export { applyMapKitBasemap, resolveMapKitMapType } from './runtime/basemap.js'
export { MAPKIT_COMPONENT_CSS } from './runtime/styles.js'

interface MutableRuntimeConfig {
  appleKeyId?: string
  applePrivateKey?: string
  appleSecretKey?: string
  appleTeamId?: string
  public: { [key: string]: unknown; mapkitTokenEndpoint?: string }
  [key: string]: unknown
}

/** WHATWG URL parsing removes every ASCII tab, LF and CR from the input. */
const URL_IGNORED_CHARACTERS = /[\t\n\r]/g

function normalizeRoutePath(path: string): string {
  // WHATWG canonicalisation, in the parser's own order: every ASCII tab and
  // newline is REMOVED from the input first, so `/<TAB>/evil.example/mk` is
  // `//evil.example/mk`; then `\` reads as `/`, so `/\evil.example/mk` is too.
  // Checking the raw string sees neither (narduk-libs#422 review round 2).
  const canonical = path.trim().replaceAll(URL_IGNORED_CHARACTERS, '').replaceAll('\\', '/')
  if (!canonical.startsWith('/')) {
    throw new Error('nardukMapKit.tokenRoutePath must start with / -- the route is same-host only')
  }
  // `//evil.example/mk` starts with `/` and is still cross-origin: the browser
  // reads it as protocol-relative. `fetchMapKitToken` throws on one, but at
  // first paint and from inside the loader -- so the module refuses it at
  // setup, where the message can name the option (§b.1).
  if (canonical.startsWith('//')) {
    throw new Error(
      'nardukMapKit.tokenRoutePath must not start with // -- a protocol-relative path ' +
        'leaves the serving origin, and the route is same-host only',
    )
  }
  return canonical.replace(/\/$/, '') || DEFAULT_MAPKIT_TOKEN_ROUTE
}

/**
 * A retired key that is still set is reported by NAME, once, at startup.
 *
 * Throwing instead would turn a 2.0.x app's leftover environment variable into
 * a start-up failure inside a MINOR. The value is never read and never printed.
 */
function warnRetiredKeys(runtimeConfig: MutableRuntimeConfig): void {
  const retired = ['mapkitAllowedOrigins']
  for (const key of retired) {
    if (runtimeConfig[key]) {
      console.warn(
        `[narduk-mapkit] runtimeConfig.${key} is accepted and ignored in 2.1.0: the token's ` +
          'origin claim is built from the routed request host alone.',
      )
    }
  }
  if (runtimeConfig.public['mapkitToken']) {
    console.warn(
      '[narduk-mapkit] runtimeConfig.public.mapkitToken is accepted and ignored in 2.1.0: a ' +
        'static portal token is origin-restricted to exactly one domain, so it can never work ' +
        'on a preview or on localhost.',
    )
  }
}

/**
 * Annotated rather than inferred: `@nuxt/kit` types `defineNuxtModule`'s return
 * as `@nuxt/schema`'s `NuxtModule` without re-exporting it, so an inferred
 * `export default` emits a `.d.ts` that names a path inside the pnpm store.
 */
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    compatibility: { nuxt: '>=4.0.0' },
    configKey: 'nardukMapKit',
    name: '@narduk-enterprises/narduk-mapkit/nuxt',
  },
  defaults: {
    component: true,
    composables: true,
    // `libraries` is deliberately absent: `defu` concatenates arrays, so a
    // default here would append to whatever the app configured. It is resolved
    // in `setup` instead.
    // `rateLimit` is deliberately absent: the token route is unlimited unless
    // the app opts in (narduk-libs#485).
    ssrPreload: true,
    tokenRoute: true,
    tokenRoutePath: DEFAULT_MAPKIT_TOKEN_ROUTE,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const tokenRoutePath = normalizeRoutePath(options.tokenRoutePath)
    const libraries = options.libraries ?? [...DEFAULT_MAPKIT_LIBRARIES]
    if (libraries.length === 0) {
      throw new Error(
        'nardukMapKit.libraries must name at least one library: MapKit JS 6 ships ' +
          'mapkit.core.js as a stub, so without "map" there is no mapkit.Map at all.',
      )
    }

    const runtimeConfig = nuxt.options.runtimeConfig as unknown as MutableRuntimeConfig
    runtimeConfig.appleKeyId ??= ''
    runtimeConfig.applePrivateKey ??= ''
    runtimeConfig.appleSecretKey ??= ''
    runtimeConfig.appleTeamId ??= ''
    runtimeConfig.public.mapkitTokenEndpoint ??= tokenRoutePath
    // Server-side and non-secret: a ceiling, not a credential. Empty unless the
    // app opted in, so the route's default is no limit at all.
    runtimeConfig['nardukMapKit'] = options.rateLimit ? { rateLimit: { ...options.rateLimit } } : {}
    warnRetiredKeys(runtimeConfig)

    // The client runtime's own non-secret configuration. Deliberately one key,
    // and deliberately not a place a token could ever be put.
    const published: MapKitPublicRuntimeOptions = {
      libraries: [...libraries],
      ssrPreload: options.ssrPreload,
      tokenRoutePath,
      ...(options.language === undefined ? {} : { language: options.language }),
    }
    runtimeConfig.public['nardukMapKit'] = published

    // Published runtime files import `#imports`, which only resolves for code
    // Vite processes -- so the runtime directory is transpiled, as every
    // published Nuxt module's is.
    nuxt.options.build.transpile.push(resolver.resolve('./runtime'))

    if (options.component) {
      addComponent({
        filePath: resolver.resolve('./runtime/components/AppMapKit'),
        name: 'AppMapKit',
      })
      // K-6. The host chrome the component cannot work without, written out of
      // a TS string because `tsc` -- this package's whole build -- emits no
      // `.css`. `unshift`, not `push`: the stylesheet has to come FIRST so an
      // app's own single-class rule for the same property wins on order.
      const stylesheet = addTemplate({
        filename: 'narduk-mapkit.css',
        getContents: () => MAPKIT_COMPONENT_CSS,
        write: true,
      })
      nuxt.options.css.unshift(stylesheet.dst)
    }
    if (options.composables) {
      addImports([{ from: resolver.resolve('./runtime/composables/useMapKit'), name: 'useMapKit' }])
    }
    if (options.tokenRoute) {
      addServerHandler({
        handler: resolver.resolve('./runtime/server/mapkit-token.get'),
        method: 'get',
        route: tokenRoutePath,
      })
      addServerHandler({
        handler: resolver.resolve('./runtime/server/mapkit-token.method-not-allowed'),
        route: tokenRoutePath,
      })
    }

    // `ssrPreload` is honoured by `<AppMapKit>` through `useHead`, NOT by
    // pushing a script into `nuxt.options.app.head`: a page that renders no map
    // must make no request to `cdn.apple-mapkit.com` at all (§f).

    addTypeTemplate({
      filename: 'types/narduk-mapkit-nuxt.d.ts',
      getContents: () => `
declare module '@nuxt/schema' {
  interface RuntimeConfig {
    appleKeyId: string
    applePrivateKey: string
    appleSecretKey: string
    appleTeamId: string
    nardukMapKit: { rateLimit?: { limit: number; windowSeconds: number } }
  }
  interface PublicRuntimeConfig {
    mapkitTokenEndpoint: string
    nardukMapKit: import('@narduk-enterprises/narduk-mapkit/nuxt').MapKitPublicRuntimeOptions
  }
}
export {}
`,
    })
  },
})

export default module

export type { MapKitPublicRuntimeOptions } from './runtime/options.js'
