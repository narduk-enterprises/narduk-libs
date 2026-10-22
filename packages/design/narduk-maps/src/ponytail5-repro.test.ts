// @vitest-environment happy-dom
// ponytail-5 audit regression tests
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NardukGeoMap from './components/NardukGeoMap.vue'
import { points, towns } from './testing/fixtures'

describe('maps-charts #14: point href must not accept javascript: URLs', () => {
  it('omits a javascript: href from the SVG anchor and the table link', () => {
    const bad = points.map((p, i) => (i === 0 ? { ...p, href: 'javascript:alert(1)' } : p))
    const wrapper = mount(NardukGeoMap, {
      props: { shapes: towns, idKey: 'name', points: bad, interactive: true, table: true },
    })
    expect(wrapper.html()).not.toMatch(/href="javascript:/i)
  })
})
