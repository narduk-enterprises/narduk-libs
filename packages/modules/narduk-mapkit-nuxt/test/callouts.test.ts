import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/runtime/components/AppMapKit.vue', import.meta.url)
const calloutUrl = new URL('../src/runtime/components/AppMapKitCallout.vue', import.meta.url)
const moduleUrl = new URL('../src/module.ts', import.meta.url)

describe('AppMapKit callout opt-in contract', () => {
  it('keeps callouts off and single-open by default', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('callouts?: boolean')
    expect(source).toContain('callouts: false')
    expect(source).toContain("calloutMode: 'single'")
    expect(source).toContain("calloutPlacement: 'above'")
    expect(source).toContain('calloutFollowSelection: true')
    expect(source).toContain("calloutFocus: 'keyboard'")
  })

  it('never constructs the controller during SSR, or without the opt-in', async () => {
    // `isClientEnvironment()` wraps `import.meta.client` here (not the plain
    // macro read the way `ensureFullscreenController()` still uses) so a
    // mount test can force this branch true with `vi.mock(...)` -- see
    // `app-map-kit-mount.test.ts`'s "callout wiring" suite, which is the
    // real behavioral coverage this source-regex check cannot be (narduk-libs#269).
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain(
      'if (!isClientEnvironment() || !props.callouts || !mapWrapper.value || !map) return null',
    )
  })

  it('anchors callouts to the wrapper, so they clip to the map and follow it fullscreen', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('container: mapWrapper.value')
    expect(source).not.toContain('container: mapContainer.value')
  })

  it('projects coordinates through the live map rather than importing MapKit into core', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('map.convertCoordinateToPointOnPage(')
    expect(source).toContain('projectCoordinate:')
  })

  it('re-emits controller events and exposes imperative control', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain("emit('callout-open', event)")
    expect(source).toContain("emit('callout-close', event)")
    expect(source).toContain("'callout-open': [event: MapKitCalloutEvent<T>]")
    expect(source).toContain("'callout-close': [event: MapKitCalloutEvent<T>]")
    for (const exposed of [
      'closeCallout',
      'closeCallouts',
      'getCalloutController',
      'openCallout',
    ]) {
      expect(source).toContain(`${exposed},`)
    }
  })

  it('provides the callout context and renders a default slot for the templates', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('provide(appMapKitCalloutInjectionKey, {')
    expect(source).toContain('<slot />')
  })

  it('destroys the controller before unmount so no teleport is stranded', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('calloutController?.destroy()')
    expect(source).toContain('calloutController = null')
    expect(source).toContain('calloutEntries.value = []')
  })

  it('keeps selection and callouts in step in both directions', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('if (newId) openCallout(newId)')
    expect(source).toContain(
      'if (props.calloutFollowSelection && selectedId.value === event.key) selectedId.value = null',
    )
  })

  it('opens the callout for a selection that predates the map', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain(
      'if (props.callouts && props.calloutFollowSelection && selectedId.value) {',
    )
  })

  it('styles only the caret, leaving the callout surface to the slot content', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain(':deep([data-mapkit-callout-caret])')
    expect(source).toContain('--mapkit-callout-caret-background')
    // The content wrapper is positioned so it paints over the caret's inner half.
    expect(source).toContain(':deep([data-mapkit-callout-content])')
  })
})

describe('AppMapKitCallout template contract', () => {
  it('teleports the slot into the controller-owned host', async () => {
    const source = await readFile(calloutUrl, 'utf8')
    expect(source).toContain('<Teleport')
    expect(source).toContain(':to="entry.host"')
    expect(source).toContain('appMapKitCalloutInjectionKey')
  })

  it('repositions when its own content changes size', async () => {
    const source = await readFile(calloutUrl, 'utf8')
    expect(source).toContain('onUpdated(() => callouts.reposition())')
  })
})

describe('narduk-mapkit Nuxt module registration', () => {
  it('registers the callout component and composable alongside the map', async () => {
    const source = await readFile(moduleUrl, 'utf8')
    expect(source).toContain("name: 'AppMapKitCallout'")
    expect(source).toContain('./runtime/components/AppMapKitCallout.vue')
    expect(source).toContain("name: 'useMapKitCallouts'")
  })
})
