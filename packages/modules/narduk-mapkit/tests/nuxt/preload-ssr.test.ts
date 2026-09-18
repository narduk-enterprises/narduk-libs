/**
 * @vitest-environment node
 *
 * The SSR preload tag (§c.7, §f), rendered where it is emitted: on the server.
 *
 * `<AppMapKit>` is rendered with Vue's real server renderer and no DOM at all.
 * `renderHTMLAttributes` is Apple's real implementation, so these assertions
 * are about the tag Apple actually generates. The client half -- the same tag
 * adopted after hydration, never doubled -- is `preload-hydration.test.ts`
 * (narduk-libs#469).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AppMapKit from '../../src/nuxt/runtime/components/AppMapKit.js'
import { resetMapKitComposableStateForTests } from '../../src/nuxt/runtime/composables/useMapKit.js'

import { headEntries, resetNuxtImportsStub, setTestRuntimeConfig } from './nuxt-imports.js'

async function renderOnServer(props: Record<string, unknown> = {}): Promise<string> {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp({
    render: () =>
      h(AppMapKit, {
        // Never called: nothing builds a pin during SSR.
        createPinElement: () => ({ element: {} as HTMLElement }),
        itemLabel: () => 'Station',
        ...props,
      }),
  })
  return await renderToString(app)
}

beforeEach(() => {
  resetNuxtImportsStub()
  resetMapKitComposableStateForTests()
  setTestRuntimeConfig({ public: {} })
})

describe('the SSR preload tag (§c.7, §f)', () => {
  it('emits Apple renderHTMLAttributes WITHOUT a token', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { libraries: ['map', 'annotations'] } } })

    await renderOnServer()

    expect(headEntries).toHaveLength(1)
    const script = headEntries[0]?.script?.[0]
    expect(script).toBeDefined()
    // A token in the tag is MapKit's static, non-refreshable path, and a portal
    // token that works on a preview host has no origin restriction at all.
    expect(Object.keys(script!)).not.toContain('token')
    expect(JSON.stringify(script)).not.toContain('token')
    expect(script).toMatchObject({
      'data-callback': 'initMapKitLoaderV2',
      'data-libraries': 'map,annotations',
      src: 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js',
    })
  })

  it('emits nothing at all when the module turned the preload off', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { ssrPreload: false } } })

    await renderOnServer()

    expect(headEntries).toStrictEqual([])
  })

  it('carries the CSP nonce onto the tag and the map container', async () => {
    const html = await renderOnServer({ nonce: 'nonce-123' })

    expect(headEntries[0]?.script?.[0]?.['nonce']).toBe('nonce-123')
    expect(html).toMatch(
      /class="mapkit-canvas"[^>]*nonce="nonce-123"|nonce="nonce-123"[^>]*class="mapkit-canvas"/,
    )
  })
})
