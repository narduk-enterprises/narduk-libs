import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, resolveComponent } from 'vue'

import { expectVueWarn } from '../../../src/vue-strict'

/** Mounts whatever global component `name` resolves to, with a label as its slot. */
const using = (name: string, props: Record<string, unknown> = {}) =>
  defineComponent({ render: () => h(resolveComponent(name) as never, props, () => 'label') })

const Titled = defineComponent({
  props: { title: { type: String, required: true } },
  render() {
    return h('h1', this.title)
  },
})

describe('strict fixture', () => {
  it('unresolved child', () => {
    mount(using('KitTile'))
  })

  it('bad prop', () => {
    mount(Titled)
  })

  it('wrong prop type', () => {
    mount(Titled, { props: { title: 4 as never } })
  })

  it('good prop', () => {
    expect(mount(Titled, { props: { title: 'Runners' } }).text()).toBe('Runners')
  })

  it('stubbed Nuxt UI component', () => {
    const wrapper = mount(using('UButton', { class: 'cta' }))
    expect(wrapper.html()).toContain('data-stub="UButton"')
    expect(wrapper.text()).toBe('label')
    expect(wrapper.find('.cta').exists()).toBe(true)
  })

  it('stubbed app component', () => {
    expect(mount(using('KitTile')).text()).toBe('label')
  })

  it('NuxtLink keeps href and slot', () => {
    const wrapper = mount(using('NuxtLink', { to: '/runners' }))
    expect(wrapper.find('a').attributes('href')).toBe('/runners')
    expect(wrapper.find('a').text()).toBe('label')
  })

  it('ClientOnly and NuxtImg', () => {
    const wrapper = mount(
      defineComponent({
        render: () =>
          h(resolveComponent('ClientOnly') as never, null, () => [
            h(resolveComponent('NuxtImg') as never, { src: '/a.png', alt: 'A', quality: 80 }),
          ]),
      }),
    )
    expect(wrapper.html()).toBe('<img src="/a.png" alt="A">')
  })

  it('a real component beats the pattern stub', () => {
    const Real = defineComponent({ render: () => h('button', 'real') })
    const wrapper = mount(using('UButton'), { global: { components: { UButton: Real } } })
    expect(wrapper.html()).toBe('<button>real</button>')
  })

  it('expects a warning that fires', () => {
    expectVueWarn(/Missing required prop/, () => {
      mount(Titled)
    })
  })

  it('expects a warning that never fires', () => {
    expectVueWarn(/Missing required prop/, () => {
      mount(Titled, { props: { title: 'ok' } })
    })
  })

  it('is clean afterwards', () => {
    expect(1).toBe(1)
  })
})
