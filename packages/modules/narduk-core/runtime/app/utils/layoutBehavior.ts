const fullBleedLayouts = ['landing', 'blank', 'auth', 'dashboard'] as const
const rootHeaderHiddenLayouts = ['dashboard'] as const
const rootFooterHiddenLayouts = ['dashboard'] as const

const fullBleedLayoutSet = new Set<string>(fullBleedLayouts)
const rootHeaderHiddenLayoutSet = new Set<string>(rootHeaderHiddenLayouts)
const rootFooterHiddenLayoutSet = new Set<string>(rootFooterHiddenLayouts)

export function resolveLayoutName(layout: unknown): string {
  return typeof layout === 'string' ? layout : ''
}

export function isFullBleedLayout(layout: unknown): boolean {
  return fullBleedLayoutSet.has(resolveLayoutName(layout))
}

export function hidesRootShellHeader(layout: unknown): boolean {
  return rootHeaderHiddenLayoutSet.has(resolveLayoutName(layout))
}

export function hidesRootShellFooter(layout: unknown): boolean {
  return rootFooterHiddenLayoutSet.has(resolveLayoutName(layout))
}
