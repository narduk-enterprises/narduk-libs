/**
 * @vitest-environment happy-dom
 *
 * The basemap seam (narduk-libs#422 K-3, K-4).
 *
 * Both halves are framework-free, so they are driven here against the
 * deterministic fake rather than through a mounted component: what is under
 * test is the value MapKit is handed, and when.
 */
import { describe, expect, it } from 'vitest'

import { applyMapKitBasemap, resolveMapKitMapType } from '../../src/nuxt/runtime/basemap.js'
import { createFakeMapKit } from '../../src/testing/index.js'

import type { MapKitMapLike } from '../../src/nuxt/runtime/mapkit-surface.js'

function fakeMap(options: { colorScheme?: string; mapType?: string } = {}): MapKitMapLike {
  const fake = createFakeMapKit()
  const host = document.createElement('div')
  document.body.append(host)
  return new fake.mapkit.Map(host, options) as unknown as MapKitMapLike
}

describe('resolveMapKitMapType (K-3)', () => {
  it("translates this library's 'muted' into Apple's own value", () => {
    // `mapkit.MapType.MutedStandard` is 'mutedStandard'. 2.1.0 documented
    // 'muted' on the prop and handed MapKit that string verbatim, which is not
    // a value MapKit JS knows.
    expect(resolveMapKitMapType('muted')).toBe('mutedStandard')
  })

  it("accepts Apple's spelling too, so an app may name the real value", () => {
    expect(resolveMapKitMapType('mutedStandard')).toBe('mutedStandard')
  })

  it('passes every other MapKit value through untouched', () => {
    expect(resolveMapKitMapType('hybrid')).toBe('hybrid')
    expect(resolveMapKitMapType('satellite')).toBe('satellite')
    expect(resolveMapKitMapType('standard')).toBe('standard')
  })

  it('agrees with the fake, which carries Apple’s enum verbatim', () => {
    const fake = createFakeMapKit()
    expect(resolveMapKitMapType('muted')).toBe(fake.mapkit.MapType.MutedStandard)
    expect(resolveMapKitMapType('hybrid')).toBe(fake.mapkit.MapType.Hybrid)
  })
})

describe('applyMapKitBasemap (K-4)', () => {
  it('writes both members onto a LIVE map, which 2.1.0 never did', () => {
    const map = fakeMap({ colorScheme: 'light', mapType: 'standard' })

    applyMapKitBasemap(map, { colorScheme: 'dark', mapType: 'muted' })

    expect(map.mapType).toBe('mutedStandard')
    expect(map.colorScheme).toBe('dark')
  })

  it('is idempotent, so a watcher may fire more often than the value changes', () => {
    const map = fakeMap({ colorScheme: 'light', mapType: 'standard' })

    applyMapKitBasemap(map, { colorScheme: 'light', mapType: 'satellite' })
    applyMapKitBasemap(map, { colorScheme: 'light', mapType: 'satellite' })

    expect(map.mapType).toBe('satellite')
    expect(map.colorScheme).toBe('light')
  })
})
