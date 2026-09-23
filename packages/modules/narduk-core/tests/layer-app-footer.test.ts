// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref } from 'vue'

import LayerAppFooter from '../runtime/app/components/app/LayerAppFooter.vue'
import { footerAfterComponents } from '../runtime/app/utils/footerExtensions'

// The SFC relies on Nuxt auto-imports; give it the few it reads.
let appConfig: Record<string, unknown> = {}
beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useSsrNow', () => ref(0))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { appName: 'Fixture' } }))
  vi.stubGlobal('useAppConfig', () => appConfig)
})
afterEach(() => {
  vi.unstubAllGlobals()
  appConfig = {}
})

const NetworkRow = defineComponent({
  name: 'NetworkRow',
  render: () => h('section', { 'data-testid': 'network-row' }, 'network'),
})

function render(slots: Record<string, () => unknown> = {}) {
  return mount(LayerAppFooter, {
    global: { components: { NetworkRow }, stubs: { NuxtTime: true } },
    slots,
  })
}

describe('footerAfterComponents', () => {
  it('reads nardukCore.footer.after, dropping non-strings and duplicates', () => {
    expect(footerAfterComponents(undefined)).toEqual([])
    expect(footerAfterComponents({ nardukCore: { footer: { after: 'NetworkRow' } } })).toEqual([])
    expect(
      footerAfterComponents({
        nardukCore: { footer: { after: ['NetworkRow', '', 7, 'NetworkRow', 'Other'] } },
      }),
    ).toEqual(['NetworkRow', 'Other'])
  })
})

describe('LayerAppFooter', () => {
  it('renders nothing after its content when no module asked for a row', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('Fixture')
    expect(wrapper.find('[data-testid="network-row"]').exists()).toBe(false)
  })

  it('renders a component a module listed in app config, inside the footer', () => {
    appConfig = { nardukCore: { footer: { after: ['NetworkRow'] } } }
    const wrapper = render()
    const row = wrapper.find('footer [data-testid="network-row"]')
    expect(row.exists()).toBe(true)
    // Below the padded content container, not inside it.
    expect(row.element.previousElementSibling?.className).toContain('py-6')
  })

  it('lets the app replace the listed rows through the after slot', () => {
    appConfig = { nardukCore: { footer: { after: ['NetworkRow'] } } }
    const wrapper = render({ after: () => h('p', { 'data-testid': 'custom' }, 'custom') })
    expect(wrapper.find('[data-testid="custom"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="network-row"]').exists()).toBe(false)
  })
})
