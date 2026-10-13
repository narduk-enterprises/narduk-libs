import type { GeneratedFile } from './types.js'

/**
 * Starting palettes for `Config/brand.json`. Each is a complete, contrast-checked
 * set (ink and paper clear 12:1; the accent or primary clears 3:1 on ink), so a
 * new app's favicon and share card are already distinct and deliberate. The
 * app is expected to replace it with its own art direction; it is a start,
 * never a look every app shares.
 */
export const BRAND_PALETTES = [
  { name: 'prairie', primary: '#1f6f5c', accent: '#f2b33d', ink: '#0f1f1b', paper: '#f4efe4' },
  { name: 'brick', primary: '#b5462f', accent: '#f0c75e', ink: '#1c1612', paper: '#f7f1e8' },
  { name: 'harbor', primary: '#1d4e89', accent: '#ff8a5b', ink: '#0b1626', paper: '#f2f5f8' },
  { name: 'ozark', primary: '#3f5f2a', accent: '#e8a33d', ink: '#141a10', paper: '#f3f0e3' },
  { name: 'high-desert', primary: '#c0652b', accent: '#2f6f73', ink: '#221812', paper: '#f8efe2' },
  { name: 'civic', primary: '#23395d', accent: '#d9a441', ink: '#0d1522', paper: '#f5f2ea' },
  { name: 'plum', primary: '#6b2d5c', accent: '#f4a259', ink: '#1a0f18', paper: '#f7f0f2' },
  { name: 'lagoon', primary: '#0f766e', accent: '#fb7185', ink: '#082321', paper: '#effaf8' },
  { name: 'signal', primary: '#d62828', accent: '#fcbf49', ink: '#14110f', paper: '#fbf6ee' },
  { name: 'ink-blue', primary: '#3a4fd8', accent: '#ffd23f', ink: '#0e1033', paper: '#f4f4fb' },
] as const

const LAYOUTS = ['poster', 'split', 'stamp', 'ledger'] as const
const PATTERNS = ['grid', 'dots', 'contours', 'diagonal'] as const

/** FNV-1a: the same app name always scaffolds the same brand. */
function hash(value: string): number {
  let h = 0x81_1c_9d_c5
  for (const char of value) {
    h ^= char.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01_00_01_93) >>> 0
  }
  return h
}

export function starterBrand(appName: string, displayName: string, description: string) {
  const seed = hash(appName)
  const palette = BRAND_PALETTES[seed % BRAND_PALETTES.length] ?? BRAND_PALETTES[0]
  const { name: _name, ...colors } = palette
  return {
    schemaVersion: 1,
    name: displayName.slice(0, 60),
    ...(description ? { tagline: description.slice(0, 160) } : {}),
    colors,
    og: {
      layout: LAYOUTS[(seed >>> 4) % LAYOUTS.length],
      pattern: PATTERNS[(seed >>> 8) % PATTERNS.length],
    },
  }
}

export function brandFiles(
  appName: string,
  displayName: string,
  description: string,
): GeneratedFile[] {
  return [
    {
      path: 'apps/web/Config/brand.json',
      contents: JSON.stringify(starterBrand(appName, displayName, description), null, 2) + '\n',
    },
  ]
}
