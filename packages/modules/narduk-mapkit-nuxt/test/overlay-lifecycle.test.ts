import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/runtime/components/AppMapKit.vue', import.meta.url)

describe('AppMapKit GeoJSON ownership contract', () => {
  it('registers one stable selection listener instead of one per redraw', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source.match(/addEventListener\('select'/g)).toHaveLength(1)
    expect(source).toContain("removeEventListener('select', handleOverlaySelect)")
  })

  it('removes only component-owned GeoJSON overlays', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain('ownedGeoJSONOverlays.push(overlay)')
    expect(source).toContain('map.removeOverlays([...ownedGeoJSONOverlays])')
    expect(source).not.toContain('removeOverlays(map.overlays)')
  })

  it('preserves polygon rings with even-odd filling', async () => {
    const source = await readFile(componentUrl, 'utf8')
    expect(source).toContain("fillRule: styleCfg.fillRule ?? 'evenodd'")
    expect(source).toContain('const coordinates = rings.length === 1 ? rings[0] : rings')
  })
})
