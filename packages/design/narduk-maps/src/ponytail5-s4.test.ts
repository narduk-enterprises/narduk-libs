// @vitest-environment happy-dom
// ponytail-5 s4 audit regression tests
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import NardukMap from './components/NardukMap.vue'
import { markImage } from './gl-marks'
import { createMapView, fitBounds, resolveBounds } from './projection'
import { metricsFor, tokensFor } from './tokens'
import { points, towns } from './testing/fixtures'

import type { ShapeCollection } from './types'

const created = vi.hoisted(() => ({
  maps: [] as Array<{ fire(name: string, arg?: unknown): void }>,
}))

vi.mock('maplibre-gl', () => {
  class FakeMap {
    handlers: Record<string, Array<(arg?: unknown) => void>> = {}
    touchZoomRotate = { disableRotation() {} }
    constructor() {
      created.maps.push(this)
      return new Proxy(this, {
        get: (t, k) => (k in t ? (t as never)[k] : () => {}),
      })
    }
    on(name: string, cb: () => void) {
      ;(this.handlers[name] ??= []).push(cb)
      return this
    }
    once(name: string, cb: () => void) {
      return this.on(name, cb)
    }
    fire(name: string, arg?: unknown) {
      for (const cb of this.handlers[name] ?? []) cb(arg)
    }
  }
  return { default: { Map: FakeMap }, Map: FakeMap }
})

describe('maps-charts #8: a non-finite coordinate must not blank the map', () => {
  it('ignores a NaN point', () => {
    const b = resolveBounds(
      towns,
      [{ id: 'x', lon: Number.NaN, lat: 41.5, label: 'x', color: '#000', shape: 'dot' }],
      null,
    )
    expect(b.every(Number.isFinite)).toBe(true)
  })
  it('falls back for a polygon with no coordinates', () => {
    const empty = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
      ],
    } as ShapeCollection
    expect(resolveBounds(empty, [], null).every(Number.isFinite)).toBe(true)
  })
})

describe('maps-charts #9: bounds crossing longitude 180', () => {
  it('has a finite zoom and keeps both sides inside the view', () => {
    expect(Number.isFinite(fitBounds([170, -10, -170, 10], { width: 400, height: 300 }).zoom)).toBe(
      true,
    )
    const view = createMapView({ bounds: [170, -10, -170, 10], width: 400, height: 300 })
    for (const lon of [172, 178, -178, -172]) {
      const [x] = view.project(lon, 0)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(400)
    }
  })
})

describe('maps-charts #10: mark image id carries the size', () => {
  it('differs when markRadius changes', () => {
    const t = tokensFor('light', undefined)
    const a = markImage('dot', '#24689f', false, t, metricsFor({ markRadius: 7 }))
    const b = markImage('dot', '#24689f', false, t, metricsFor({ markRadius: 12 }))
    expect(a.id).not.toBe(b.id)
  })
})

async function liveMap(props: Record<string, unknown>) {
  created.maps.length = 0
  const wrapper = mount(NardukMap, {
    props: { shapes: towns, idKey: 'name', points, load: 'eager', ...props },
  })
  await vi.waitFor(() => expect(created.maps.length).toBe(1))
  return { wrapper, gl: created.maps[0]! }
}

describe('maps-charts #11: interactive shape buttons stay in the tab order', () => {
  it('marks the root so the poster is not visibility-hidden', async () => {
    const { wrapper } = await liveMap({ interactive: true })
    expect(wrapper.classes()).toContain('narduk-map--interactive')
    const css = readFileSync(resolve(process.cwd(), 'src/styles/map.css'), 'utf8')
    expect(css).toMatch(
      /\.narduk-map\.is-ready:not\(\.narduk-map--interactive\)\s+\.narduk-map__poster/,
    )
  })
})

describe('maps-charts #12: plain keeps the poster', () => {
  it('does not start the GL map', async () => {
    created.maps.length = 0
    mount(NardukMap, {
      props: { shapes: towns, idKey: 'name', points, load: 'eager', plain: true },
    })
    await new Promise(r => setTimeout(r, 50))
    expect(created.maps.length).toBe(0)
  })
})

describe('maps-charts #13: a WebGL failure keeps the poster', () => {
  it('does not become ready after a WebGL error', async () => {
    const { wrapper, gl } = await liveMap({})
    gl.fire('load')
    gl.fire('error', { error: new Error('WebGL context lost') })
    gl.fire('idle')
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('is-failed')
    expect(wrapper.classes()).not.toContain('is-ready')
  })
})
