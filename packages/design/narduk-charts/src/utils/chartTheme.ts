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
