export const DEFAULT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
]

export function getColor(custom: string[] | undefined, index: number): string {
  const palette = custom?.length ? custom : DEFAULT_COLORS
  return palette[index % palette.length]
}
