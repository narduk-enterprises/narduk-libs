/**
 * Public option and data types for `@narduk-enterprises/narduk-mapkit/nuxt`.
 *
 * Nothing here is secret and nothing here can become secret: `ModuleOptions`
 * carries no token, key, or origin list. The signing material reaches the token
 * route through `runtimeConfig` alone (§b.1), and its env NAMES are documented
 * in the package README -- never its values, here or in a log line.
 */
import type { MapKitLibrary } from '../client/mapkit.js'

export interface MapKitRateLimitOptions {
  limit: number
  windowSeconds: number
}

export interface ModuleOptions {
  /** Register `<AppMapKit>`. */
  component: boolean
  /** Register `useMapKit()`. */
  composables: boolean
  /**
   * App-wide default for the required `libraries` prop. MapKit JS 6's
   * `mapkit.core.js` is a stub, so without `'map'` there is no `mapkit.Map` at
   * all -- which is why neither the option nor the prop has a silent fallback.
   */
  libraries: MapKitLibrary[]
  /** Passed to Apple's loader. */
  language?: string
  /**
   * Fixed-window ceiling applied to the token route per routed origin. An app
   * that mounts narduk-core's own rate limiter on
   * `event.context.nardukMapKit.rateLimit` takes precedence over this.
   */
  rateLimit: MapKitRateLimitOptions
  /**
   * Emit `renderHTMLAttributes()` during SSR so `mapkit.core.js` downloads
   * before hydration. Emitted WITHOUT a token: a token in the tag is MapKit's
   * static, non-refreshable path (§d.4).
   *
   * It is emitted by `<AppMapKit>` through `useHead`, not by the module into the
   * app head, so a page that renders no map makes no request to
   * `cdn.apple-mapkit.com` at all -- which is one of the §f budgets.
   */
  ssrPreload: boolean
  tokenRoute: boolean
  /** Must start with `/`. Same-host only; an absolute URL is a config error. */
  tokenRoutePath: string
}

export interface GeoJSONGeometry {
  coordinates: unknown
  type: string
}

export type GeoJSONFeatureProperties = Record<string, unknown>

export interface GeoJSONFeature {
  geometry: GeoJSONGeometry
  properties: GeoJSONFeatureProperties
  type: 'Feature'
}

export interface GeoJSONFeatureCollection {
  features: GeoJSONFeature[]
  type: 'FeatureCollection'
}

export interface OverlayStyle {
  fillColor: string
  fillOpacity?: number
  fillRule?: 'evenodd' | 'nonzero'
  lineDash?: number[]
  lineWidth: number
  strokeColor: string
  strokeOpacity?: number
}

export interface MapKitCircle {
  color: string
  lat: number
  lng: number
  opacity?: number
  radius: number
}

/** v6 exposes these as top-level enums; `mapkit.Map.MapTypes` is gone. */
export type MapKitMapType = 'hybrid' | 'muted' | 'satellite' | 'standard'

export type MapKitColorScheme = 'auto' | 'dark' | 'light'

/**
 * A colour-mode source `<AppMapKit>` reads when `colorScheme` is `'auto'`.
 *
 * Provided by the host app (`@nuxtjs/color-mode`'s ref, a `useState`, anything
 * with a `.value`). 2.0.x watched `<html class="dark">` with a
 * `MutationObserver`, which meant every map on a page ran one, and an app whose
 * dark mode is not a class on the root element had no way in at all.
 */
export interface MapKitColorModeSource {
  readonly value: string
}
