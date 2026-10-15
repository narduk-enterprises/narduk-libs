import { describe, expect, it } from 'vitest'

import { BRAND_PALETTES, brandFiles, starterBrand } from '../src/brand'

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('starter brand', () => {
  it.each(BRAND_PALETTES)('$name keeps card text readable', (palette) => {
    expect(contrast(palette.ink, palette.paper)).toBeGreaterThan(12)
    // Poster eyebrow and rings: the accent (or the primary) reads on ink.
    expect(
      Math.max(contrast(palette.accent, palette.ink), contrast(palette.primary, palette.ink)),
    ).toBeGreaterThanOrEqual(3)
  })

  it('gives the same app the same brand, and different apps different ones', () => {
    expect(starterBrand('newton', 'Newton', '')).toEqual(starterBrand('newton', 'Newton', ''))
    const looks = new Set(
      ['newton', 'edgerton', 'greenhills', 'cskt', 'crpc-ceds', 'bluebonnet'].map((name) =>
        JSON.stringify({ ...starterBrand(name, 'X', ''), name: undefined }),
      ),
    )
    expect(looks.size).toBeGreaterThan(3)
  })

  it('writes Config/brand.json with the tagline and a layout', () => {
    const [file] = brandFiles('newton', 'Newton County Broadband', 'Where fiber reaches.')
    expect(file?.path).toBe('apps/web/Config/brand.json')
    const brand = JSON.parse(file?.contents ?? '{}')
    expect(brand).toMatchObject({
      schemaVersion: 1,
      name: 'Newton County Broadband',
      tagline: 'Where fiber reaches.',
    })
    expect(['poster', 'split', 'stamp', 'ledger']).toContain(brand.og.layout)
    expect(Object.keys(brand.colors)).toEqual(['primary', 'accent', 'ink', 'paper'])
  })
})
