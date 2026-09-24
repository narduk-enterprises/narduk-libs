// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'

import AppLightbox from '../runtime/app/components/shared/AppLightbox.vue'
import { railIndexForKey } from '../runtime/app/utils/lightboxRails'

import { nuxtUiStubs } from './fixtures/nuxt-ui-stubs'

import type { LightboxItem, LightboxRail } from '../runtime/app/components/shared/AppLightbox.vue'

const ITEMS: LightboxItem[] = [
  { alt: 'Dawn', src: '/dawn.jpg' },
  { alt: 'Noon', src: '/noon.jpg' },
  { alt: 'Dusk', src: '/dusk.jpg' },
]

const RAILS: LightboxRail[] = [
  {
    label: 'Time of day',
    items: [
      { alt: 'Dawn thumb', itemIndex: 0, src: '/dawn-thumb.jpg' },
      { alt: 'Noon thumb', itemIndex: 1, src: '/noon-thumb.jpg' },
    ],
  },
  {
    label: 'Cameras',
    items: [
      { alt: 'Cam A', itemIndex: 0, src: '/cam-a-thumb.jpg' },
      { alt: 'Cam C', itemIndex: 2, src: '/cam-c-thumb.jpg' },
    ],
  },
]

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function render(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  const wrapper = mount(AppLightbox, {
    attachTo: document.body,
    props: {
      items: ITEMS,
      modelValue: true,
      ...props,
    },
    slots,
    global: {
      components: nuxtUiStubs,
      stubs: { Transition: false, transition: false },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

function qs(selector: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`missing ${selector}`)
  }
  return element
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('AppLightbox rails keyboard axes', () => {
  it('maps rail 1 to left/right and rail 2 to up/down', () => {
    expect(railIndexForKey('ArrowLeft', 2)).toBe(0)
    expect(railIndexForKey('ArrowRight', 2)).toBe(0)
    expect(railIndexForKey('ArrowUp', 2)).toBe(1)
    expect(railIndexForKey('ArrowDown', 2)).toBe(1)
    expect(railIndexForKey('ArrowUp', 1)).toBeNull()
    expect(railIndexForKey('ArrowRight', 0)).toBeNull()
  })

  it('keeps left/right on the gallery when rails are omitted', async () => {
    const wrapper = render()

    expect(document.body.querySelector('[data-testid="app-lightbox-rails"]')).toBeNull()
    expect(qs('[data-testid="app-lightbox-image"]').getAttribute('src')).toBe('/dawn.jpg')

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(qs('[data-testid="app-lightbox-image"]').getAttribute('src')).toBe('/noon.jpg')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('moves rail 1 with ArrowLeft/ArrowRight and updates the main picture', async () => {
    const wrapper = render({ rails: RAILS })

    const rail = qs('[data-testid="app-lightbox-rail-0"]')
    expect(rail.getAttribute('aria-label')).toBe('Time of day')
    expect(rail.getAttribute('tabindex')).toBe('0')
    expect(qs('[data-testid="app-lightbox-rail-0-item-0"]').getAttribute('aria-current')).toBe(
      'true',
    )

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(qs('[data-testid="app-lightbox-image"]').getAttribute('src')).toBe('/noon.jpg')
    expect(qs('[data-testid="app-lightbox-rail-0-item-1"]').getAttribute('aria-current')).toBe(
      'true',
    )
    expect(wrapper.emitted('select')).toEqual([[{ railIndex: 0, itemIndex: 1 }]])
  })

  it('moves rail 2 with ArrowUp/ArrowDown and updates the main picture', async () => {
    const wrapper = render({ rails: RAILS })

    expect(qs('[data-testid="app-lightbox-rail-1"]').getAttribute('aria-label')).toBe('Cameras')

    press('ArrowDown')
    await wrapper.vm.$nextTick()

    expect(qs('[data-testid="app-lightbox-image"]').getAttribute('src')).toBe('/dusk.jpg')
    expect(qs('[data-testid="app-lightbox-rail-1-item-1"]').getAttribute('aria-current')).toBe(
      'true',
    )
    expect(wrapper.emitted('select')).toEqual([[{ railIndex: 1, itemIndex: 1 }]])
  })
})

describe('AppLightbox side slot', () => {
  it('renders the side slot with the current item and index', async () => {
    const wrapper = render(
      {},
      {
        side: ({ item, index }: { index: number; item: LightboxItem }) =>
          h('p', { class: 'side-copy' }, `${item.alt} #${index}`),
      },
    )

    const side = qs('[data-testid="app-lightbox-side"]')
    expect(side.textContent).toBe('Dawn #0')
    expect(qs('[data-testid="app-lightbox-stage"]').className).toContain('md:flex-row')
    expect(qs('[data-testid="app-lightbox-stage"]').className).toContain('flex-col')

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(side.textContent).toBe('Noon #1')
  })
})
