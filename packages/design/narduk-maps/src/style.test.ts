import { describe, expect, it } from 'vitest'

import { createBasemapStyle, DARK_TOKENS, LIGHT_TOKENS } from './style'

const layerIds = (style: ReturnType<typeof createBasemapStyle>) => style.layers.map(l => l.id)

describe('createBasemapStyle', () => {
  const style = createBasemapStyle()

  it('is plain JSON data', () => {
    expect(JSON.parse(JSON.stringify(style))).toEqual(style)
    expect(style.version).toBe(8)
  })

  it('points at OpenFreeMap planet tiles and glyphs, with no sprite', () => {
    expect(style.sources.openmaptiles).toMatchObject({
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    })
    expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf')
    expect('sprite' in style).toBe(false)
    expect(JSON.stringify(style)).not.toMatch(/sprite|icon-image/)
  })

  it('draws no POIs, housenumbers or road names', () => {
    const sourceLayers = style.layers.map(l => l['source-layer'])
    expect(sourceLayers).not.toContain('poi')
    expect(sourceLayers).not.toContain('housenumber')
    expect(sourceLayers).not.toContain('transportation_name')
    expect(sourceLayers).not.toContain('aeroway')
    expect(layerIds(style).join(' ')).not.toMatch(/poi|housenumber|road-label|oneway|shield/)
  })

  it('keeps buildings to z14, minor roads to z12 and shows only places and water names as text', () => {
    const byId = Object.fromEntries(style.layers.map(l => [l.id, l]))
    expect((byId.building?.minzoom as number) >= 14).toBe(true)
    expect((byId['road-minor']?.minzoom as number) >= 12).toBe(true)
    expect(byId['road-major']?.minzoom as number).toBeLessThan(12)
    const text = style.layers.filter(l => l.type === 'symbol')
    expect(text.map(l => l['source-layer']).sort()).toEqual([
      'place',
      'place',
      'place',
      'water_name',
    ])
    for (const l of text)
      expect((l.layout as Record<string, unknown>)['icon-image']).toBeUndefined()
  })

  it('follows the approved harbor look, light and dark', () => {
    const paintOf = (scheme: 'light' | 'dark', id: string) => {
      const layer = createBasemapStyle({}, { scheme }).layers.find(l => l.id === id)
      return (layer?.paint ?? {}) as Record<string, unknown>
    }
    expect(paintOf('light', 'background')['background-color']).toBe('#f6f5f1')
    expect(paintOf('light', 'water')['fill-color']).toBe('#d3e2eb')
    expect(paintOf('light', 'shore')['line-color']).toBe('#8fb0c4')
    expect(paintOf('light', 'shore-halo')['line-color']).toBe('#b9d0de')
    expect(paintOf('light', 'landcover')).toMatchObject({ 'fill-color': '#e9eee2' })
    expect(paintOf('light', 'road-minor')['line-color']).toBe('#e4e1d8')
    expect(paintOf('light', 'road-major')['line-color']).toBe('#dcd7cb')
    expect(paintOf('light', 'boundary-region')['line-color']).toBe('#b7bec5')
    expect(paintOf('light', 'water-name')['text-color']).toBe('#5d7f95')
    expect(paintOf('light', 'place-town')).toMatchObject({
      'text-color': '#2b3742',
      'text-halo-color': '#f6f5f1',
      'text-opacity': 0.72,
    })
    expect(paintOf('dark', 'background')['background-color']).toBe('#1a2128')
    expect(paintOf('dark', 'water')['fill-color']).toBe('#0f1a22')
    expect(paintOf('dark', 'landcover')['fill-color']).toBe('#1c2620')
    expect(paintOf('dark', 'place-town')['text-color']).toBe('#d2dae1')
    expect(paintOf('dark', 'water-name')['text-color']).toBe('#7d9bb0')
  })

  it('sets place names in bold tracked capitals and water names in italic', () => {
    const byId = Object.fromEntries(style.layers.map(l => [l.id, l]))
    expect(byId['place-town']?.layout).toMatchObject({
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-font': ['Noto Sans Bold'],
    })
    expect(byId['water-name']?.layout).toMatchObject({ 'text-font': ['Noto Sans Italic'] })
  })

  it('paints land as the background and water from the tokens', () => {
    const byId = Object.fromEntries(style.layers.map(l => [l.id, l]))
    expect((byId.background?.paint as Record<string, string>)['background-color']).toBe(
      LIGHT_TOKENS.land,
    )
    expect((byId.water?.paint as Record<string, string>)['fill-color']).toBe(LIGHT_TOKENS.water)
  })

  it('declares where the caller layers go', () => {
    expect(style.metadata['narduk:slots']).toEqual({ fills: 'water', lines: 'water-name' })
    expect(layerIds(style)).toContain('water')
    expect(layerIds(style)).toContain('water-name')
  })

  it('dark uses its own values', () => {
    const dark = createBasemapStyle({}, { scheme: 'dark' })
    const bg = (s: typeof dark) =>
      (s.layers[0]?.paint as Record<string, string>)['background-color']
    expect(bg(dark)).toBe(DARK_TOKENS.land)
    expect(bg(dark)).not.toBe(bg(style))
  })

  it('labels: none draws no text at all', () => {
    const quiet = createBasemapStyle({}, { labels: 'none' })
    expect(quiet.layers.some(l => l.type === 'symbol')).toBe(false)
    expect(quiet.metadata['narduk:slots'].lines).toBeNull()
    expect('glyphs' in quiet).toBe(true)
  })

  it('token overrides replace the scheme value', () => {
    for (const custom of [
      createBasemapStyle({ water: '#123456' }),
      createBasemapStyle({}, { tokens: { water: '#123456' } }),
    ]) {
      const water = custom.layers.find(l => l.id === 'water')
      expect((water?.paint as Record<string, string>)['fill-color']).toBe('#123456')
    }
  })

  it('leaves out the names the caller draws', () => {
    const hidden = createBasemapStyle({}, { hideNames: ['Newport'] })
    expect(JSON.stringify(hidden)).toContain('Newport')
    expect(JSON.stringify(style)).not.toContain('Newport')
  })

  it('lets names step off pins: variable anchors on every text layer', () => {
    for (const layer of style.layers.filter(l => l.type === 'symbol')) {
      const layout = layer.layout as Record<string, unknown>
      expect(layout['text-variable-anchor'], layer.id).toEqual([
        'center',
        'top',
        'bottom',
        'left',
        'right',
      ])
      expect(layout['text-radial-offset'], layer.id).toBe(0.8)
    }
  })

  it('attributes OpenFreeMap, OpenMapTiles and OpenStreetMap', () => {
    expect(style.metadata['narduk:attribution']).toMatch(/OpenFreeMap/)
    expect(style.metadata['narduk:attribution']).toMatch(/OpenMapTiles/)
    expect(style.metadata['narduk:attribution']).toMatch(/OpenStreetMap/)
  })
})
