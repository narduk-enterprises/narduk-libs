// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import NeKpiBand from '../src/runtime/components/NeKpiBand.vue'

import type { NeKpiBandProps } from '../src/runtime/components/NeKpiBand.vue'

function mountBand(props: NeKpiBandProps = {}) {
  return mount(NeKpiBand, {
    props,
    slots: {
      default: () => [h('div', { 'data-testid': 'tile-1' }), h('div', { 'data-testid': 'tile-2' })],
    },
  })
}

describe('NeKpiBand', () => {
  it('defaults to a single column when no columns prop is given', () => {
    const wrapper = mountBand()
    const grid = wrapper.get('[data-testid="ne-kpi-band"]')
    expect(grid.classes()).toContain('grid')
    expect(grid.classes()).toContain('grid-cols-1')
  })

  it('applies a base column count', () => {
    const wrapper = mountBand({ columns: { base: 2 } })
    expect(wrapper.get('[data-testid="ne-kpi-band"]').classes()).toContain('grid-cols-2')
  })

  it('applies every given breakpoint as its own literal responsive class', () => {
    const wrapper = mountBand({ columns: { base: 1, sm: 2, lg: 4 } })
    const classes = wrapper.get('[data-testid="ne-kpi-band"]').classes()
    expect(classes).toContain('grid-cols-1')
    expect(classes).toContain('sm:grid-cols-2')
    expect(classes).toContain('lg:grid-cols-4')
    // No breakpoint was asked for md or xl, so neither is present.
    expect(classes.some((name) => name.startsWith('md:grid-cols-'))).toBe(false)
    expect(classes.some((name) => name.startsWith('xl:grid-cols-'))).toBe(false)
  })

  it('supports every documented column count from 1 through 6', () => {
    for (let count = 1; count <= 6; count += 1) {
      const wrapper = mountBand({ columns: { base: count as 1 | 2 | 3 | 4 | 5 | 6 } })
      expect(wrapper.get('[data-testid="ne-kpi-band"]').classes()).toContain(`grid-cols-${count}`)
    }
  })

  it('lays out slot content without styling it', () => {
    const wrapper = mountBand()
    expect(wrapper.find('[data-testid="tile-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tile-2"]').exists()).toBe(true)
  })

  it('always carries the gap utility, regardless of columns', () => {
    const wrapper = mountBand({ columns: { base: 3, md: 6 } })
    expect(wrapper.get('[data-testid="ne-kpi-band"]').classes()).toContain('gap-4')
  })
})
