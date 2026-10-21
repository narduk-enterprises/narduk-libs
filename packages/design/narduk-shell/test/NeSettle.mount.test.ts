// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import NeSettle from '../src/runtime/components/NeSettle.vue'

afterEach(() => vi.unstubAllGlobals())

it('starts at rest, preserves its child for the same key and replaces it for a new key', async () => {
  const wrapper = mount(NeSettle, {
    props: { motionKey: 'yard' },
    slots: { default: '<p>Trailer arrived</p>' },
  })
  const child = wrapper.get('[data-ne-settle]').element
  expect(wrapper.text()).toBe('Trailer arrived')
  expect(wrapper.findComponent({ name: 'Transition' }).props('appear')).toBe(false)
  await wrapper.setProps({ motionKey: 'yard' })
  expect(wrapper.get('[data-ne-settle]').element).toBe(child)
  await wrapper.setProps({ motionKey: 'dock' })
  expect(wrapper.get('[data-ne-settle]').element).not.toBe(child)
  wrapper.unmount()
})

it('disables CSS motion explicitly and follows a changing reduced-motion preference', async () => {
  let change = () => {}
  const media = {
    matches: false,
    addEventListener: (_: string, listener: () => void) => {
      change = listener
    },
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', () => media)
  const wrapper = mount(NeSettle, { slots: { default: '<p>Arrived</p>' } })
  await nextTick()
  expect(wrapper.findComponent({ name: 'Transition' }).props('css')).toBe(true)
  media.matches = true
  change()
  await nextTick()
  expect(wrapper.findComponent({ name: 'Transition' }).props('css')).toBe(false)
  media.matches = false
  change()
  await wrapper.setProps({ disabled: true })
  expect(wrapper.findComponent({ name: 'Transition' }).props('css')).toBe(false)
  wrapper.unmount()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', change)
})
