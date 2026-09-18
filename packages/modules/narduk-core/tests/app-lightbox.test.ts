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
    global: { components: nuxtUiStubs },
  })
  mounted.push(wrapper)
  return wrapper
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

    expect(wrapper.find('[data-testid="app-lightbox-rails"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="app-lightbox-image"]').attributes('src')).toBe('/dawn.jpg')

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="app-lightbox-image"]').attributes('src')).toBe('/noon.jpg')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('moves rail 1 with ArrowLeft/ArrowRight and updates the main picture', async () => {
    const wrapper = render({ rails: RAILS })

    const rail = wrapper.get('[data-testid="app-lightbox-rail-0"]')
    expect(rail.attributes('aria-label')).toBe('Time of day')
    expect(rail.attributes('tabindex')).toBe('0')
    expect(
      wrapper.get('[data-testid="app-lightbox-rail-0-item-0"]').attributes('aria-current'),
    ).toBe('true')

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="app-lightbox-image"]').attributes('src')).toBe('/noon.jpg')
    expect(
      wrapper.get('[data-testid="app-lightbox-rail-0-item-1"]').attributes('aria-current'),
    ).toBe('true')
    expect(wrapper.emitted('select')).toEqual([[{ railIndex: 0, itemIndex: 1 }]])
  })

  it('moves rail 2 with ArrowUp/ArrowDown and updates the main picture', async () => {
    const wrapper = render({ rails: RAILS })

    expect(wrapper.get('[data-testid="app-lightbox-rail-1"]').attributes('aria-label')).toBe(
      'Cameras',
    )

    press('ArrowDown')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="app-lightbox-image"]').attributes('src')).toBe('/dusk.jpg')
    expect(
      wrapper.get('[data-testid="app-lightbox-rail-1-item-1"]').attributes('aria-current'),
    ).toBe('true')
    expect(wrapper.emitted('select')).toEqual([[{ railIndex: 1, itemIndex: 1 }]])
  })
})

describe('AppLightbox side slot', () => {
  it('renders the side slot with the current item and index', async () => {
    const wrapper = render(
      {},
      {
        side: ({ item, index }: { item: LightboxItem; index: number }) =>
          h('p', { class: 'side-copy' }, `${item.alt} #${index}`),
      },
    )

    const side = wrapper.get('[data-testid="app-lightbox-side"]')
    expect(side.text()).toBe('Dawn #0')
    expect(wrapper.get('[data-testid="app-lightbox-stage"]').classes()).toContain('md:flex-row')
    expect(wrapper.get('[data-testid="app-lightbox-stage"]').classes()).toContain('flex-col')

    press('ArrowRight')
    await wrapper.vm.$nextTick()

    expect(side.text()).toBe('Noon #1')
  })
})
