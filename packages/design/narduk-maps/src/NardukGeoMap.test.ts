// @vitest-environment happy-dom
import { renderToString } from '@vue/server-renderer'
import { mount } from '@vue/test-utils'
import { createSSRApp, h } from 'vue'
import { describe, expect, it } from 'vitest'

import NardukGeoMap from './components/NardukGeoMap.vue'
import { labelBox, labelHitsObstacle } from './labels'
import { markReach } from './marks'
import { mercatorY, polygonsOf, projectionStats, unmercatorY } from './projection'
import { DEFAULT_METRICS } from './tokens'
import { aquidneckCutout, counties, marcCutout, points, towns } from './testing/fixtures'

import type { CutoutBasemap, GeoMapProps, MapPoint, ShapeFeature } from './types'

/** A lon/lat inside a feature: the first vertex of its first ring, nudged inwards. */
function labelLonLat(feature: ShapeFeature): [number, number] {
  const ring = polygonsOf(feature.geometry)[0]?.[0] ?? []
  const n = ring.length
  const cx = ring.reduce((a, p) => a + (p[0] as number), 0) / n
  const cy = ring.reduce((a, p) => a + (p[1] as number), 0) / n
  return [cx, cy]
}

const aquidneck: GeoMapProps = { shapes: towns, idKey: 'name', points, highlight: 'p3' }

const marc: GeoMapProps = {
  shapes: counties,
  idKey: 'fips',
  water: false,
  fills: { '29095': '#9fc5e3', '20091': '#dbe9f4' },
  hatch: { '29177': true },
  levelText: { '29095': 'Low' },
}

describe('NardukGeoMap markup', () => {
  it('draws one path per shape and one mark per point', () => {
    const wrapper = mount(NardukGeoMap, { props: aquidneck })
    expect(wrapper.findAll('[data-shape-id]')).toHaveLength(towns.features.length)
    expect(wrapper.findAll('[data-point-id]')).toHaveLength(points.length)
  })

  it('gives every point an invisible hit target of at least 24px', () => {
    const wrapper = mount(NardukGeoMap, { props: aquidneck })
    const hits = wrapper.findAll('[data-point-id] .narduk-geomap__hit')
    expect(hits).toHaveLength(points.length)
    for (const hit of hits) expect(Number(hit.attributes('r'))).toBeGreaterThanOrEqual(12)
  })

  it('has no <title> or <desc> anywhere, so no native tooltip', () => {
    for (const props of [aquidneck, marc, { ...aquidneck, interactive: true, table: true }]) {
      const html = mount(NardukGeoMap, { props }).html()
      expect(html).not.toMatch(/<title/i)
      expect(html).not.toMatch(/<desc/i)
    }
  })

  it('is a group, never an image holding interactive children', () => {
    const wrapper = mount(NardukGeoMap, { props: { ...marc, interactive: true } })
    expect(wrapper.find('svg').attributes('role')).toBe('group')
    expect(wrapper.findAll('[role="button"]')).toHaveLength(counties.features.length)
    expect(wrapper.findAll('[role="img"] [role="button"]')).toHaveLength(0)
  })

  it('makes a point with an href a link and one without a focusable element', () => {
    const wrapper = mount(NardukGeoMap, { props: aquidneck })
    const link = wrapper.find('[data-point-id="p1"]')
    expect(link.element.tagName.toLowerCase()).toBe('a')
    expect(link.attributes('aria-label')).toContain('Culvert')
    const plain = wrapper.find('[data-point-id="p2"]')
    expect(plain.attributes('tabindex')).toBe('0')
    expect(plain.attributes('aria-label')).toBe('Road ranking')
  })

  it('print mode has no tab stops and draws the level text under each name', () => {
    const wrapper = mount(NardukGeoMap, {
      props: { ...marc, plain: true, interactive: true },
    })
    expect(wrapper.find('svg').attributes('role')).toBe('img')
    expect(wrapper.find('[tabindex]').exists()).toBe(false)
    expect(wrapper.find('[role="button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Low')
  })

  it('emits select for a keyboard-activated shape', async () => {
    const wrapper = mount(NardukGeoMap, { props: { ...marc, interactive: true } })
    await wrapper.find('[data-shape-id="29095"]').trigger('keydown.enter')
    expect(wrapper.emitted('select')?.[0]).toEqual(['29095'])
  })

  it('shows a tooltip card on point hover and emits point-hover', async () => {
    const wrapper = mount(NardukGeoMap, { props: aquidneck })
    await wrapper.find('[data-point-id="p2"]').trigger('pointerenter')
    expect(wrapper.find('.narduk-geomap__tooltip').text()).toContain('Road ranking')
    expect(wrapper.emitted('point-hover')?.[0]).toEqual(['p2'])
    await wrapper.find('[data-point-id="p2"]').trigger('pointerleave')
    expect(wrapper.find('.narduk-geomap__tooltip').exists()).toBe(false)
  })

  it('renders the optional table and the tooltip slot', async () => {
    const wrapper = mount(NardukGeoMap, {
      props: { ...aquidneck, table: true },
      slots: {
        tooltip: (slot: { title: string }) => h('b', { class: 'custom' }, `${slot.title}!`),
      },
    })
    expect(wrapper.find('table').exists()).toBe(true)
    await wrapper.find('[data-point-id="p2"]').trigger('pointerenter')
    expect(wrapper.find('.custom').text()).toBe('Road ranking!')
  })

  it('draws the hatch pattern only over no-data shapes', () => {
    const wrapper = mount(NardukGeoMap, { props: marc })
    expect(wrapper.findAll('.narduk-geomap__nodata')).toHaveLength(1)
    expect(wrapper.find('pattern').exists()).toBe(true)
  })

  it('defaults an unfilled shape to the land token', () => {
    const wrapper = mount(NardukGeoMap, { props: marc })
    const path = wrapper.find('[data-shape-id="20121"]')
    expect(path.attributes('style')).toContain('var(--color-map-land)')
  })
})

describe('SSR identity', () => {
  const strip = (html: string) =>
    html.replaceAll(/<!--[\s\S]*?-->/g, '').replaceAll(/\sdata-v-[\da-f]+=""/g, '')

  for (const [name, props] of [
    ['Aquidneck', aquidneck],
    ['MARC', marc],
    ['MARC plain', { ...marc, plain: true }],
  ] as const) {
    it(`server and client markup are identical for ${name}`, async () => {
      const server = await renderToString(createSSRApp({ render: () => h(NardukGeoMap, props) }))
      const client = mount(NardukGeoMap, { props }).html({ raw: true })
      expect(strip(client).replaceAll(/\s+/g, '')).toBe(strip(server).replaceAll(/\s+/g, ''))
    })
  }

  it('renders the same twice (no clock, no counter, no measurement)', async () => {
    const render = () => renderToString(createSSRApp({ render: () => h(NardukGeoMap, aquidneck) }))
    expect(await render()).toBe(await render())
  })
})

describe('path cache through the component', () => {
  it('re-projects nothing when only the fills change', async () => {
    const wrapper = mount(NardukGeoMap, { props: marc })
    const before = projectionStats.rings
    const d = wrapper.find('[data-shape-id="29095"]').attributes('d')
    for (const color of ['#f2c45a', '#e07b39', '#bf3b2c']) {
      await wrapper.setProps({ fills: { '29095': color } })
    }
    expect(projectionStats.rings).toBe(before)
    expect(wrapper.find('[data-shape-id="29095"]').attributes('d')).toBe(d)
    expect(wrapper.find('[data-shape-id="29095"]').attributes('style')).toContain('#bf3b2c')
  })
})

describe('label placement through the component', () => {
  it('never lets a mark cover a name, on real towns and marks', () => {
    // A crowd of marks, several on top of town centres, to make the nudging earn its keep.
    const crowd: MapPoint[] = [
      ...points,
      ...towns.features.flatMap((f, i) => {
        const [lon, lat] = labelLonLat(f)
        return [
          { id: `c${i}a`, lon, lat, color: '#24689f', shape: 'dot' as const, label: `a${i}` },
          {
            id: `c${i}b`,
            lon: lon + 0.004,
            lat: lat - 0.002,
            color: '#c98f1a',
            shape: 'ring' as const,
            label: `b${i}`,
          },
        ]
      }),
    ]
    const wrapper = mount(NardukGeoMap, { props: { shapes: towns, idKey: 'name', points: crowd } })
    const labels = wrapper.findAll('[data-label-id]')
    expect(labels).toHaveLength(towns.features.length)
    const obstacles = crowd.map(p => {
      const circle = wrapper.find(`[data-point-id="${p.id}"] circle`).attributes()
      return {
        x: Number(circle.cx),
        y: Number(circle.cy),
        r: markReach(p.shape, false, DEFAULT_METRICS),
      }
    })
    const [vbW, vbH] = (wrapper.find('svg').attributes('viewBox') ?? '')
      .split(' ')
      .slice(2)
      .map(Number)
    for (const label of labels) {
      const a = label.attributes()
      const box = labelBox(
        { id: a['data-label-id'] as string, text: label.text(), x: Number(a.x), y: Number(a.y) },
        {
          width: vbW as number,
          height: vbH as number,
          fontSize: DEFAULT_METRICS.labelSize,
          charWidth: DEFAULT_METRICS.labelCharWidth,
        },
      )
      expect(labelHitsObstacle(box, obstacles), label.text()).toBe(false)
      // And inside the frame.
      expect(box.x0).toBeGreaterThanOrEqual(0)
      expect(box.x1).toBeLessThanOrEqual(vbW as number)
      expect(box.y0).toBeGreaterThanOrEqual(0)
      expect(box.y1).toBeLessThanOrEqual(vbH as number)
    }
  })
})

describe('baked basemap frame', () => {
  // A hand-made 200 x 200 cutout of one degree around the equator, projected the way the
  // baking step does: scale = viewBox width over the bbox's mercator width, origin at the
  // north-west corner.
  const basemap: CutoutBasemap = {
    name: 'tiny',
    bbox: [-1, -1, 1, 1],
    viewBox: [200, 200],
    zoom: 9,
    attribution: 'Test data, public domain',
    layers: [
      { id: 'green', d: 'M0 0L50 0L50 50L0 50Z' },
      { id: 'water', d: 'M100 100L200 100L200 200L100 200Z' },
      { id: 'shore', d: 'M100 100L200 100L200 200L100 200Z' },
      { id: 'roadMinor', d: 'M0 100L200 100' },
      { id: 'roadMajor', d: 'M100 0L100 200' },
      { id: 'state', d: 'M0 20L200 20' },
    ],
    labels: [
      { text: 'Testville', x: 100, y: 40, kind: 'place', rank: 0 },
      { text: 'Edgeton', x: 4, y: 190, kind: 'place', rank: 1 },
      { text: 'Lake Test', x: 150, y: 170, kind: 'water', rank: 2 },
    ],
  }

  const shapes = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { id: 's', name: 'Square' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
              [-0.5, -0.5],
            ],
          ],
        },
      },
    ],
  }

  const dot = (id: string, lon: number, lat: number): MapPoint => ({
    id,
    lon,
    lat,
    color: '#000',
    shape: 'dot',
    label: id,
  })
  const centreOf = (wrapper: ReturnType<typeof mount>, id: string) => {
    const a = wrapper.find(`[data-point-id="${id}"] circle`).attributes()
    return [Number(a.cx), Number(a.cy)] as const
  }

  it('lands the bbox centre on the viewBox centre, within half a pixel', () => {
    for (const cutout of [basemap, aquidneckCutout, marcCutout]) {
      const [w, s, e, n] = cutout.bbox
      // The centre of a web mercator frame is the mercator midpoint, not the latitude midpoint.
      const midLat = unmercatorY((mercatorY(s) + mercatorY(n)) / 2)
      const wrapper = mount(NardukGeoMap, {
        props: {
          basemap: cutout,
          width: 999,
          padding: 40,
          points: [dot('mid', (w + e) / 2, midLat), dot('sw', w, s)],
        },
      })
      const [vw, vh] = cutout.viewBox
      expect(wrapper.find('svg').attributes('viewBox')).toBe(`0 0 ${vw} ${vh}`)
      const [x, y] = centreOf(wrapper, 'mid')
      expect(Math.abs(x - vw / 2), cutout.name).toBeLessThan(0.5)
      expect(Math.abs(y - vh / 2), cutout.name).toBeLessThan(0.5)
      // The bbox is already widened to the frame's aspect: its south-west corner is the
      // viewBox's bottom-left corner.
      const [sx, sy] = centreOf(wrapper, 'sw')
      expect(Math.abs(sx), cutout.name).toBeLessThan(0.5)
      expect(Math.abs(sy - vh), cutout.name).toBeLessThan(0.5)
    }
  })

  it('lands a point at a known pixel: half a degree east of the centre is a quarter across', () => {
    const wrapper = mount(NardukGeoMap, {
      props: { basemap, points: [dot('east', 0.5, 0), dot('corner', -1, 1)] },
    })
    const [x, y] = centreOf(wrapper, 'east')
    expect(x).toBeCloseTo(150, 0)
    expect(y).toBeCloseTo(100, 0)
    const [cx, cy] = centreOf(wrapper, 'corner')
    expect(cx).toBeCloseTo(0, 1)
    expect(cy).toBeCloseTo(0, 1)
  })

  it('paints land, green, the shapes, water, shore, roads, state, then boundaries, labels and points', () => {
    const wrapper = mount(NardukGeoMap, {
      props: { basemap, shapes, labels: 'shapes', points: [dot('p', 0, 0)] },
    })
    const html = wrapper.html()
    const order = [
      'narduk-geomap__bm--land',
      'narduk-geomap__bm--green',
      'narduk-geomap__shapes',
      'narduk-geomap__bm--water',
      'narduk-geomap__bm--shore-halo',
      'narduk-geomap__bm--shore"',
      'narduk-geomap__bm--roadMinor',
      'narduk-geomap__bm--roadMajor',
      'narduk-geomap__bm--state',
      'narduk-geomap__boundary',
      'narduk-geomap__labels',
      'narduk-geomap__points',
    ].map(needle => html.indexOf(needle))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('clips the shore halo to the water and draws it once with the line', () => {
    const wrapper = mount(NardukGeoMap, { props: { basemap } })
    const halo = wrapper.find('.narduk-geomap__bm--shore-halo')
    const id = /url\(#(.+)\)/.exec(halo.attributes('clip-path') ?? '')?.[1]
    expect(id).toBeTruthy()
    expect(wrapper.find(`clipPath[id="${id}"] path`).attributes('d')).toBe(basemap.layers[1]?.d)
    expect(wrapper.findAll('.narduk-geomap__bm--shore')).toHaveLength(1)
  })

  it('writes the attribution into the frame, bottom right', () => {
    const wrapper = mount(NardukGeoMap, { props: { basemap } })
    const text = wrapper.find('.narduk-geomap__attribution')
    expect(text.text()).toBe('Test data, public domain')
    expect(Number(text.attributes('x'))).toBeGreaterThan(150)
    expect(Number(text.attributes('y'))).toBeGreaterThan(150)
  })

  it('drops a baked label that leaves the frame instead of clipping it', () => {
    const wrapper = mount(NardukGeoMap, { props: { basemap } })
    const names = wrapper.findAll('[data-label-id]').map(l => l.text())
    expect(names).toContain('Testville')
    expect(names).not.toContain('Edgeton')
  })

  it('nudges a baked label off a pin, and drops it when nothing clears', () => {
    // A pin right on Testville moves the name.
    const pinned = mount(NardukGeoMap, { props: { basemap, points: [dot('on', 0, 0.6)] } })
    const [px, py] = centreOf(pinned, 'on')
    const label = pinned.findAll('[data-label-id]').find(l => l.text() === 'Testville')
    expect(label).toBeTruthy()
    const box = labelBox(
      {
        id: 'x',
        text: 'Testville',
        x: Number(label?.attributes('x')),
        y: Number(label?.attributes('y')),
      },
      {
        width: 200,
        height: 200,
        fontSize: DEFAULT_METRICS.labelSize,
        charWidth: DEFAULT_METRICS.labelCharWidth,
      },
    )
    expect(
      labelHitsObstacle(box, [{ x: px, y: py, r: markReach('dot', false, DEFAULT_METRICS) }]),
    ).toBe(false)
    expect([Number(label?.attributes('x')), Number(label?.attributes('y'))]).not.toEqual([100, 40])
  })

  it('draws no tiles and keeps shapes transparent over the baked land', () => {
    const wrapper = mount(NardukGeoMap, { props: { basemap, shapes } })
    expect(wrapper.find('[data-shape-id="s"]').attributes('style')).toContain('transparent')
    expect(wrapper.find('mask').exists()).toBe(false)
    expect(wrapper.html()).not.toMatch(/<image|https?:\/\/tiles/)
  })

  it('keeps the baked layers out of the pointer path', async () => {
    const wrapper = mount(NardukGeoMap, { props: { basemap, shapes, interactive: true } })
    await wrapper.find('[data-shape-id="s"]').trigger('keydown.enter')
    expect(wrapper.emitted('select')?.[0]).toEqual(['s'])
    expect(
      wrapper.findAll('.narduk-geomap__basemap').every(g => g.attributes('aria-hidden') === 'true'),
    ).toBe(true)
  })
})
