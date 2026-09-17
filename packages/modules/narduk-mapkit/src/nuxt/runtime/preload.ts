/**
 * The SSR preload tag (§c.7).
 *
 * `renderHTMLAttributes()` is Apple's own generator for the `<script>` that
 * starts `mapkit.core.js` downloading as the HTML is parsed; `load()` then
 * adopts the tag rather than injecting a second one (it dedupes on
 * `data-callback="initMapKitLoaderV2"`).
 *
 * **Emitted without a `token`.** A token in the tag is MapKit's static,
 * non-refreshable path -- and a portal token that works on a preview host has,
 * by definition, no origin restriction on it at all. The tag's whole job is the
 * download; the exchange still happens through `authorizationCallback`.
 *
 * It is emitted from `<AppMapKit>`'s own `setup`, not from the module into
 * `app.head`, so a page that renders no map issues no request to
 * `cdn.apple-mapkit.com`.
 */
import { renderHTMLAttributes } from '@apple/mapkit-loader'
import { useHead } from '#imports'

import { readMapKitPublicOptions, resolveMapKitRuntimeOptions } from './options.js'

import type { MapKitLibrary } from '../../client/mapkit.js'

export interface MapKitPreloadOptions {
  language?: string
  libraries?: readonly MapKitLibrary[]
  nonce?: string | undefined
}

export function useMapKitPreload(options: MapKitPreloadOptions = {}): void {
  if (readMapKitPublicOptions().ssrPreload === false) return
  const resolved = resolveMapKitRuntimeOptions({
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.libraries === undefined ? {} : { libraries: options.libraries }),
  })

  const attributes = renderHTMLAttributes({
    libraries: [...resolved.libraries],
    version: '6',
    ...(resolved.language === undefined ? {} : { language: resolved.language }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  })

  useHead({ script: [attributes] })
}
