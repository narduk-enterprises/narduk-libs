import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/runtime/components/AppMapKit.vue', import.meta.url)

describe('AppMapKit fullscreen opt-in contract', () => {
  it('keeps the fullscreen control off and viewport-mode by default', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('fullscreenControl?: boolean')
    expect(source).toContain('fullscreenControl: false')
    expect(source).toContain("fullscreenMode: 'viewport'")
  })

  it('renders the toggle only when the consumer opts in', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('v-if="fullscreenControl"')
    expect(source).toContain('@click="toggleFullscreen"')
    expect(source).toContain(':aria-pressed="isFullscreen"')
  })

  it('presents the wrapper, so the map chrome comes along', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('ref="mapWrapper"')
    expect(source).toContain('element: mapWrapper.value')
    expect(source).not.toContain('element: mapContainer.value')
  })

  it('refreshes MapKit geometry on every layout change', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('refreshMapKitMapLayout(map)')
    expect(source).toContain('onLayout:')
  })

  it('re-emits controller change events and exposes imperative control', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain("emit('fullscreen-change', event)")
    expect(source).toContain("'fullscreen-change': [event: MapKitFullscreenChangeEvent]")
    for (const exposed of ['enterFullscreen', 'exitFullscreen', 'toggleFullscreen']) {
      expect(source).toContain(`${exposed},`)
    }
  })

  it('destroys the controller before unmount so nothing is stranded', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('fullscreenController?.destroy()')
    expect(source).toContain('fullscreenController = null')
  })

  it('never constructs the controller during SSR', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('if (!import.meta.client || !mapWrapper.value) return null')
  })
})
