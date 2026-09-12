/*
 * Server-render proof, mirroring narduk-charts's `src/ssr.test.ts`
 * (narduk-libs#269). `nuxt.test.ts` already proves this end to end through a
 * real Nuxt/Nitro server; this file isolates the same claim at the component
 * level, with no Nuxt build in front of it.
 *
 * AppMapKit's first render on a Nuxt/Nitro consumer happens on the server —
 * for the Cloudflare Workers preset, a runtime with no `window`, `document`,
 * or Apple's injected `mapkit` global at all. `useMapKit()` and `initMap()`
 * gate every DOM- and `mapkit`-touching branch behind `import.meta.client`.
 * This file runs in `vitest.config.ts`'s default `node` environment
 * (deliberately not opted into `happy-dom` the way `callout-mount.test.ts`
 * and the new `app-map-kit-mount.test.ts` are), and nothing here replaces
 * the `import.meta.client` macro the way a real Nuxt Vite build does — so it
 * evaluates falsy exactly as it does under real SSR, and `AppMapKit`'s own
 * source (not a stand-in) has to render without throwing.
 */
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vitest'

import AppMapKit from '../src/runtime/components/AppMapKit.vue'

import type { GeoJSONFeatureCollection } from '../src/runtime/components/AppMapKit.vue'

it('runs in an environment with no DOM and no mapkit global, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
  expect(typeof (globalThis as { mapkit?: unknown }).mapkit).toBe('undefined')
})

const polygonGeojson: GeoJSONFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
}

describe('AppMapKit server rendering without a DOM', () => {
  it('renders the loading state instead of throwing', async () => {
    const html = await renderToString(createSSRApp(AppMapKit, { items: [] }))
    expect(html).toContain('mapkit-wrapper')
    expect(html).toContain('Loading map')
    expect(html).toContain('role="status"')
  })

  it('renders pin-mode, geojson-mode, fullscreen and callout opt-ins without touching a DOM global', async () => {
    const html = await renderToString(
      createSSRApp(AppMapKit, {
        items: [{ id: 'a', lat: 1, lng: 2 }],
        createPinElement: () => ({ element: {} }),
        geojson: polygonGeojson,
        fullscreenControl: true,
        callouts: true,
      }),
    )
    expect(html).toContain('mapkit-wrapper')
    // Still the loading state: `mapkitReady` never becomes true because
    // `useMapKit()`'s client-only branch never runs during SSR, so `initMap`
    // — the only place any of these props would reach `mapkit` — never runs.
    expect(html).toContain('Loading map')
    // The fullscreen toggle is gated on the prop alone, not on `mapkitReady`.
    expect(html).toContain('aria-pressed="false"')
  })

  it('does not touch a DOM or mapkit global merely by importing the component', async () => {
    // The import at the top of this file already proves module scope is
    // clean; this asserts the same for a second render, after any lazy init.
    await expect(renderToString(createSSRApp(AppMapKit, { items: [] }))).resolves.toContain(
      'Loading map',
    )
  })
})
