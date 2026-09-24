// @vitest-environment happy-dom
import { createMapKitCalloutController } from '@narduk-enterprises/narduk-mapkit/client'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, provide, shallowRef } from 'vue'

import { appMapKitCalloutInjectionKey } from '../src/runtime/callouts'
import AppMapKitCallout from '../src/runtime/components/AppMapKitCallout.vue'

import type { AppMapKitCalloutContext, AppMapKitCalloutEntry } from '../src/runtime/callouts'
import type { MapKitCalloutController } from '@narduk-enterprises/narduk-mapkit/client'
import type { InjectionKey, Ref } from 'vue'

interface Station {
  id: string
  lat: number
  lng: number
  name: string
  reading: string
}

interface Coordinate {
  lat: number
  lng: number
}

/**
 * Nuxt UI's components read their configuration from an ancestor `<UApp>`
 * through `provide`/`inject`, and that is exactly what a second mounted Vue
 * app inside the callout host would lose. This stands in for it: if the
 * injected value reaches the card, real `UCard` and `UButton` reach theirs.
 */
const uiConfigKey: InjectionKey<{ variant: string }> = Symbol('ui-config')

const CardLike = defineComponent({
  name: 'CardLike',
  emits: ['dismiss'],
  setup(_props, { emit, slots }) {
    const config = inject(uiConfigKey, { variant: 'missing-app-config' })
    return () =>
      h('section', { class: `card card--${config.variant}`, 'data-testid': 'card' }, [
        h('header', { 'data-testid': 'card-header' }, slots.header?.()),
        h('div', { 'data-testid': 'card-body' }, slots.default?.()),
        h(
          'button',
          { 'data-testid': 'card-dismiss', onClick: () => emit('dismiss'), type: 'button' },
          'Dismiss',
        ),
      ])
  },
})

interface Harness {
  container: HTMLElement
  controller: MapKitCalloutController<Station, Coordinate>
  entries: Ref<AppMapKitCalloutEntry[]>
  open: (station: Station) => void
  wrapper: ReturnType<typeof mount>
}

function createHarness(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const controller = createMapKitCalloutController<Station, Coordinate>({
    container,
    coordinateSpace: 'container',
    mode: 'multi',
    projectCoordinate: () => ({ x: 200, y: 200 }),
  })

  // Shallow, exactly as AppMapKit holds it: no reactive proxy around a DOM node.
  const entries = shallowRef<AppMapKitCalloutEntry[]>([])
  controller.subscribe(() => {
    const next: AppMapKitCalloutEntry[] = []
    for (const key of controller.openKeys) {
      const host = controller.hostFor(key) as HTMLElement | null
      const item = controller.itemFor(key)
      if (host && item) next.push({ host, item, key })
    }
    entries.value = next
  })

  const open = (station: Station): void => {
    controller.open({ coordinate: station, item: station, key: station.id })
  }

  const context: AppMapKitCalloutContext = {
    close: (key) => (key === undefined ? controller.closeAll() : controller.close(key)),
    entries,
    open: () => {},
    reposition: () => controller.reposition(),
  }

  const Root = defineComponent({
    name: 'Root',
    setup() {
      provide(appMapKitCalloutInjectionKey, context)
      provide(uiConfigKey, { variant: 'from-app' })
      return () =>
        h('div', { class: 'map-wrapper' }, [
          h(AppMapKitCallout, null, {
            default: (slotProps: { close: () => void; item: unknown }) => {
              const station = slotProps.item as Station
              return h(
                CardLike,
                { onDismiss: slotProps.close },
                {
                  default: () => station.reading,
                  header: () => station.name,
                },
              )
            },
          }),
        ])
    },
  })

  return { container, controller, entries, open, wrapper: mount(Root) }
}

function stationOf(id: string, name: string, reading: string): Station {
  return { id, lat: 1, lng: 2, name, reading }
}

function hostOf(harness: Harness, key: string): HTMLElement {
  const host = harness.controller.hostFor(key) as HTMLElement | null
  if (!host) throw new Error(`no callout host for "${key}"`)
  return host
}

describe('AppMapKitCallout mounted content', () => {
  it('mounts real Vue content into the controller-owned host', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    await nextTick()

    const host = hostOf(harness, 'a')
    expect(host.querySelector('[data-testid="card-header"]')?.textContent).toBe('Alpha')
    expect(host.querySelector('[data-testid="card-body"]')?.textContent).toBe('12.4C')
    // The content really is inside the map container, not left where it was written.
    expect(harness.container.contains(host)).toBe(true)

    harness.wrapper.unmount()
  })

  it('reaches the teleported content with app-level provide/inject', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    await nextTick()

    // A second `createApp()` mounted into the host would render the fallback
    // here; a Teleport keeps the parent chain, so Nuxt UI's own config arrives.
    expect(hostOf(harness, 'a').querySelector('[data-testid="card"]')?.className).toContain(
      'card--from-app',
    )

    harness.wrapper.unmount()
  })

  it('lands a reactive update inside an already-open callout', async () => {
    const harness = createHarness()
    const station = stationOf('a', 'Alpha', '12.4C')
    harness.controller.open({ coordinate: station, item: station, key: 'a' })
    await nextTick()
    const host = hostOf(harness, 'a')
    expect(host.querySelector('[data-testid="card-body"]')?.textContent).toBe('12.4C')

    // Re-opening the same key updates the entry the slot reads from, without
    // recreating the host element the content is teleported into.
    harness.controller.open({
      coordinate: station,
      item: stationOf('a', 'Alpha', '13.9C'),
      key: 'a',
    })
    await nextTick()

    expect(harness.controller.hostFor('a')).toBe(host)
    expect(host.querySelector('[data-testid="card-body"]')?.textContent).toBe('13.9C')

    harness.wrapper.unmount()
  })

  it('routes an event from mounted content back through the controller', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    await nextTick()

    const dismiss = hostOf(harness, 'a').querySelector<HTMLElement>('[data-testid="card-dismiss"]')
    dismiss?.click()
    await nextTick()

    expect(harness.controller.isOpen('a')).toBe(false)
    expect(harness.container.querySelector('[data-mapkit-callout]')).toBeNull()
  })

  it('mounts and unmounts one subtree per open callout in multi mode', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    harness.open(stationOf('b', 'Bravo', '9.1C'))
    await nextTick()

    expect(harness.container.querySelectorAll('[data-testid="card"]')).toHaveLength(2)

    harness.controller.close('a')
    await nextTick()

    expect(harness.container.querySelectorAll('[data-testid="card"]')).toHaveLength(1)
    expect(harness.container.querySelector('[data-testid="card-header"]')?.textContent).toBe(
      'Bravo',
    )

    harness.wrapper.unmount()
  })

  it('leaves no content behind when the component unmounts while open', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    await nextTick()
    const host = hostOf(harness, 'a')
    expect(host.childElementCount).toBe(1)

    harness.wrapper.unmount()
    await nextTick()

    // The Teleport's own teardown emptied the host, so nothing is stranded in
    // a detached element.
    expect(host.childElementCount).toBe(0)
  })

  it('leaves no content behind when the controller is destroyed while open', async () => {
    const harness = createHarness()
    harness.open(stationOf('a', 'Alpha', '12.4C'))
    await nextTick()
    const host = hostOf(harness, 'a')

    harness.controller.destroy()
    await nextTick()

    expect(host.childElementCount).toBe(0)
    expect(harness.container.querySelector('[data-mapkit-callout-layer]')).toBeNull()
    expect(harness.container.querySelectorAll('[data-testid="card"]')).toHaveLength(0)

    harness.wrapper.unmount()
  })

  it('does not forward fallthrough attributes onto teleported content', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const controller = createMapKitCalloutController<Station, Coordinate>({
      container,
      coordinateSpace: 'container',
      mode: 'single',
      projectCoordinate: () => ({ x: 200, y: 200 }),
    })
    const entries = shallowRef<AppMapKitCalloutEntry[]>([])
    controller.subscribe(() => {
      const next: AppMapKitCalloutEntry[] = []
      for (const key of controller.openKeys) {
        const host = controller.hostFor(key) as HTMLElement | null
        const item = controller.itemFor(key)
        if (host && item) next.push({ host, item, key })
      }
      entries.value = next
    })
    const context: AppMapKitCalloutContext = {
      close: (key) => (key === undefined ? controller.closeAll() : controller.close(key)),
      entries,
      open: () => {},
      reposition: () => controller.reposition(),
    }
    const wrapper = mount(
      defineComponent({
        name: 'AttrRoot',
        setup() {
          provide(appMapKitCalloutInjectionKey, context)
          return () =>
            h(
              AppMapKitCallout,
              { class: 'from-parent', 'data-from-parent': '' },
              {
                default: () => h('p', { 'data-testid': 'callout-body' }, 'body'),
              },
            )
        },
      }),
    )
    controller.open({
      coordinate: { lat: 1, lng: 2 },
      item: stationOf('a', 'Alpha', '12.4C'),
      key: 'a',
    })
    await nextTick()

    const host = controller.hostFor('a') as HTMLElement
    const body = host.querySelector('[data-testid="callout-body"]')
    expect(body).not.toBeNull()
    expect(body?.classList.contains('from-parent')).toBe(false)
    expect(host.hasAttribute('data-from-parent')).toBe(false)
    expect(body?.hasAttribute('data-from-parent')).toBe(false)

    wrapper.unmount()
    controller.destroy()
  })

  it('refuses to render outside a map that provides the callout context', () => {
    const Orphan = defineComponent({
      name: 'Orphan',
      setup: () => () => h(AppMapKitCallout, null, { default: () => 'x' }),
    })

    expect(() => mount(Orphan)).toThrow('<AppMapKitCallout> must be used inside')
  })
})
