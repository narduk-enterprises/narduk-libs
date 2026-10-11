import type { ChartTheme } from '../types'

const THEME_CLASS: Record<Exclude<ChartTheme, 'default'>, string> = {
  'high-contrast': 'narduk-chart--theme-high-contrast',
  print: 'narduk-chart--theme-print',
  'colorblind-safe': 'narduk-chart--theme-colorblind-safe',
}

export function chartThemeClass(theme?: ChartTheme): string {
  if (!theme || theme === 'default') return ''
  return THEME_CLASS[theme] ?? ''
}

/** Modifier class on the chart box for `look="studio"`. */
export const STUDIO_LOOK_CLASS = 'narduk-chart--look-studio'

/**
 * Classes for the surrounding `<figure>` when the look is studio: the title and
 * description are its children, outside the chart box, so they need the look and
 * the theme tokens (dark mode, high contrast) too. `undefined` for the classic
 * look, which keeps the figure's markup unchanged.
 */
export function studioFigureClasses(rootClasses: readonly string[]): string[] | undefined {
  if (!rootClasses.includes(STUDIO_LOOK_CLASS)) return undefined
  return [...rootClasses.filter(c => c !== 'narduk-chart'), 'narduk-chart-figure--look-studio']
}
