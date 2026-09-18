/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"happyDOM":{"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}}
 *
 * narduk-libs#469: exactly ONE `mapkit.core.js` in the document, however the
 * map page was reached.
 *
 * Nothing here is mocked except MapKit itself. Apple's real
 * `@apple/mapkit-loader` `load()` runs (it is what injects or adopts the
 * script), and a real `unhead` client head receives every `useHead()` call and
 * renders into `document.head` exactly as Nuxt's does once the app has
 * hydrated -- because the second tag on buoystat.us came from unhead's client
 * renderer, not from the loader (the renderer hashes every attribute of the
 * SSR element to adopt it, and a hidden CSP nonce makes that hash miss).
 * The fake stands in for what `mapkit.core.js` defines on `window`.
 *
 * Script loading is disabled in happy-dom: an element the loader creates is
 * reported as loaded, and nothing ever reaches `cdn.apple-mapkit.com`.
 */
import { renderHTMLAttributes } from '@apple/mapkit-loader'
import { mount } from '@vue/test-utils'
import { createHead, renderDOMHead } from 'unhead/client'
import { renderSSRHead, createHead as createServerHead } from 'unhead/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetMapKitClientStateForTests } from '../../src/client/index.js'
import AppMapKit from '../../src/nuxt/runtime/components/AppMapKit.js'
import {
  resetMapKitComposableStateForTests,
  useMapKit,
} from '../../src/nuxt/runtime/composables/useMapKit.js'
import { DEFAULT_MAPKIT_LIBRARIES } from '../../src/nuxt/runtime/defaults.js'
import { createFakeMapKit } from '../../src/testing/index.js'

import {
  headEntries,
  installTestHead,
  resetNuxtImportsStub,
  setTestRuntimeConfig,
} from './nuxt-imports.js'

import type { FakeMapKitHandle } from '../../src/testing/index.js'
import type { VueWrapper } from '@vue/test-utils'

const MAPKIT_SCRIPT = 'script[src*="mapkit.core.js"]'

let fake: FakeMapKitHandle
let uninstallFake: (() => void) | null
let head: ReturnType<typeof createHead>
let wrappers: VueWrapper[]

function mapKitScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(MAPKIT_SCRIPT)]
}

/**
 * The `<script>` the server put in `<head>`: Apple's own attributes, rendered
 * through unhead's own SSR renderer -- the same two steps `useMapKitPreload()`
 * takes on the server (its output is pinned in `preload-ssr.test.ts`).
 *
 * `hiddenNonce` models buoystat.us: narduk-core's CSP (nuxt-security) stamps a
 * nonce on every SSR `<script>`, and Chrome's nonce hiding then blanks the
 * content attribute to `nonce=""` while keeping `.nonce`. Measured in Chrome on
 * a built Nuxt 4.5.2 fixture, 2026-09-18.
 */
async function serverRenderedPreload(options: { hiddenNonce?: boolean } = {}): Promise<void> {
  const serverHead = createServerHead()
  const attributes = renderHTMLAttributes({
    libraries: [...DEFAULT_MAPKIT_LIBRARIES],
    version: '6',
  })
  // Apple types the attributes as a plain record; unhead wants `src` named.
  serverHead.push({ script: [attributes] } as unknown as Parameters<typeof serverHead.push>[0])
  const { headTags } = await renderSSRHead(serverHead)
  document.head.innerHTML = headTags
  if (options.hiddenNonce) {
    const script = document.head.querySelector(MAPKIT_SCRIPT)!
    script.setAttribute('nonce', '')
  }
  expect(mapKitScripts()).toHaveLength(1)
}

/** What `mapkit.core.js` does when it executes: define `window.mapkit`. */
function mapKitCoreExecutes(): void {
  uninstallFake = fake.install()
}

function mountMap(): VueWrapper {
  const wrapper = mount(AppMapKit, {
    attachTo: document.body,
    props: {
      createPinElement: () => ({ element: document.createElement('span') }),
      itemLabel: () => 'Station',
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

async function untilReady(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(() => {
    expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
  })
}

/** Nuxt renders the client head once the page has hydrated; so does this. */
async function hydrateHead(): Promise<void> {
  await renderDOMHead(head, { document })
}

beforeEach(() => {
  resetNuxtImportsStub()
  setTestRuntimeConfig({ public: {} })
  head = createHead({ document })
  installTestHead(head as unknown as Parameters<typeof installTestHead>[0])
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ expiresAt: Date.now() + 1_800_000, token: 'test.jwt.value' }), {
      status: 200,
    })) as unknown as typeof fetch
  fake = createFakeMapKit()
  uninstallFake = null
  wrappers = []
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  uninstallFake?.()
  resetMapKitClientStateForTests()
  resetMapKitComposableStateForTests()
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('SSR page load, then hydration (narduk-libs#469)', () => {
  it('keeps the one server-rendered tag when a CSP nonce is hidden on it', async () => {
    await serverRenderedPreload({ hiddenNonce: true })
    mapKitCoreExecutes()

    const wrapper = mountMap()
    await untilReady(wrapper)
    await hydrateHead()

    expect(mapKitScripts()).toHaveLength(1)
    expect(mapKitScripts()[0]!.getAttribute('nonce')).toBe('')
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.configurationChanges).toStrictEqual(['Initialized'])
  })

  it('keeps the one server-rendered tag without a nonce too', async () => {
    await serverRenderedPreload()
    mapKitCoreExecutes()

    const wrapper = mountMap()
    await untilReady(wrapper)
    await hydrateHead()

    expect(mapKitScripts()).toHaveLength(1)
    expect(fake.inspect.tokenCalls).toBe(1)
  })

  it('adopts the server tag while it is still downloading instead of injecting another', async () => {
    await serverRenderedPreload({ hiddenNonce: true })
    const serverTag = mapKitScripts()[0]!

    const wrapper = mountMap()
    await hydrateHead()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-mapkit-state="loading"]').exists()).toBe(true)
    })
    expect(mapKitScripts()).toStrictEqual([serverTag])

    // The download finishes: mapkit.core.js defines `window.mapkit`, then fires load.
    mapKitCoreExecutes()
    serverTag.dispatchEvent(new Event('load'))
    await untilReady(wrapper)
    await hydrateHead()

    expect(mapKitScripts()).toStrictEqual([serverTag])
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.configurationChanges).toStrictEqual(['Initialized'])
  })

  it('asks the client head for no MapKit script at all', async () => {
    await serverRenderedPreload({ hiddenNonce: true })
    mapKitCoreExecutes()

    const wrapper = mountMap()
    await untilReady(wrapper)

    expect(JSON.stringify(headEntries)).not.toContain('mapkit.core.js')
  })
})

describe('client-side navigation to a map page (no SSR tag)', () => {
  it("injects exactly one tag, through Apple's loader, with the requested libraries", async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { libraries: ['map', 'annotations'] } } })
    expect(mapKitScripts()).toHaveLength(0)
    mapKitCoreExecutes()

    const wrapper = mountMap()
    await untilReady(wrapper)
    await hydrateHead()

    const scripts = mapKitScripts()
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.src).toBe('https://cdn.apple-mapkit.com/mk/6/mapkit.core.js')
    expect(scripts[0]!.dataset['libraries']).toBe('map,annotations')
    expect(scripts[0]!.dataset['callback']).toBe('initMapKitLoaderV2')
    expect(fake.inspect.tokenCalls).toBe(1)
  })

  it('stays at one tag when a second map mounts on the same page', async () => {
    mapKitCoreExecutes()

    await untilReady(mountMap())
    await untilReady(mountMap())
    await hydrateHead()

    expect(mapKitScripts()).toHaveLength(1)
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.maps).toHaveLength(2)
  })
})

describe('K-11: <AppMapKit> mounts after MapKit JS is already loaded', () => {
  it('still builds the map, off the one server-rendered tag', async () => {
    await serverRenderedPreload({ hiddenNonce: true })
    mapKitCoreExecutes()
    const { ready } = useMapKit()
    await vi.waitFor(() => {
      expect(ready.value).toBe(true)
    })
    await hydrateHead()

    const wrapper = mountMap()
    await untilReady(wrapper)
    await hydrateHead()

    expect(fake.inspect.maps).toHaveLength(1)
    expect(wrapper.emitted('map-ready')).toHaveLength(1)
    expect(mapKitScripts()).toHaveLength(1)
    expect(fake.inspect.tokenCalls).toBe(1)
  })
})
