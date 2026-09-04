import { describe, expect, it } from 'vitest'
import { DEFAULT_COLORS, SERIES_TOKEN_COUNT, getColor } from './colors'

describe('getColor series tokens', () => {
  it('returns a --color-chart-series-N reference so themes can repaint the palette', () => {
    expect(getColor(undefined, 0)).toBe('var(--color-chart-series-1, oklch(56% 0.17 268))')
    expect(getColor(undefined, 1)).toBe('var(--color-chart-series-2, oklch(62% 0.13 176))')
    expect(getColor([], 2)).toBe('var(--color-chart-series-3, oklch(74% 0.13 82))')
  })

  it('carries a literal fallback for every slot, for stylesheet-less SVG export', () => {
    expect(DEFAULT_COLORS).toHaveLength(SERIES_TOKEN_COUNT)
    for (let i = 0; i < SERIES_TOKEN_COUNT; i++) {
      expect(getColor(undefined, i)).toBe(`var(--color-chart-series-${i + 1}, ${DEFAULT_COLORS[i]})`)
    }
  })

  it('wraps past the last token instead of running out', () => {
    expect(getColor(undefined, SERIES_TOKEN_COUNT)).toBe(getColor(undefined, 0))
    expect(getColor(undefined, SERIES_TOKEN_COUNT * 3 + 4)).toBe(getColor(undefined, 4))
  })

  it('takes a custom palette literally, tokens not involved', () => {
    expect(getColor(['#ff0000', '#00ff00'], 0)).toBe('#ff0000')
    expect(getColor(['#ff0000', '#00ff00'], 3)).toBe('#00ff00')
  })

  it('never yields undefined for a negative index', () => {
    expect(getColor(undefined, -1)).toBe(`var(--color-chart-series-${SERIES_TOKEN_COUNT}, ${DEFAULT_COLORS[SERIES_TOKEN_COUNT - 1]})`)
  })
})
