/**
 * The Narduk design system's two font families, declared to `@nuxt/fonts`
 * (narduk-libs#1366).
 *
 * `@narduk-enterprises/narduk-ui/tokens.css` names Instrument Sans for
 * interface and prose (`--ns-font-text`) and IBM Plex Mono for every measured
 * number (`--ns-font-mono`); `@narduk-enterprises/narduk-shell/theme.css`
 * names the same two through `--ne-font-sans` / `--ne-font-mono`. Neither
 * bundles a font file. Status-runtime used to cover that with a render-blocking
 * Google Fonts stylesheet (about 900 ms of mobile first paint on riverstat.us);
 * `@nuxt/fonts` fetches the files at build time and serves them from `/_fonts/`
 * on the app's own origin with an immutable cache and metric-matched fallbacks.
 *
 * `global: true` is what makes that work. `@nuxt/fonts` only declares a family
 * it finds in a `font-family` value of a stylesheet it scans, and follows a
 * `var()` back to a literal name only within the same file. Both sheets set
 * the family in a custom property (`--ns-font-text: "Instrument Sans", ...`)
 * and read it elsewhere, so without `global` no `@font-face` is emitted and
 * every page renders the system fallback.
 *
 * Weights and styles match what the old stylesheet requested: Instrument Sans
 * 400/500/600/700 upright and IBM Plex Mono 400/500/600 upright.
 */
export interface DesignSystemFontFamily {
  global: true
  name: string
  provider: 'google'
  styles: ['normal']
  weights: number[]
}

export const DESIGN_SYSTEM_FONT_FAMILIES: readonly DesignSystemFontFamily[] = Object.freeze([
  {
    name: 'Instrument Sans',
    provider: 'google',
    weights: [400, 500, 600, 700],
    styles: ['normal'],
    global: true,
  },
  {
    name: 'IBM Plex Mono',
    provider: 'google',
    weights: [400, 500, 600],
    styles: ['normal'],
    global: true,
  },
])

/** Global stylesheets that name the design system's families. */
export const DESIGN_SYSTEM_STYLESHEETS = [
  '@narduk-enterprises/narduk-ui/tokens.css',
  '@narduk-enterprises/narduk-shell/theme.css',
] as const

const SHELL_MODULE = '@narduk-enterprises/narduk-shell'

interface FontsHost {
  css?: unknown
  fonts?: unknown
  modules?: unknown
}

function moduleEntry(entry: unknown): { name: string; options: unknown } | undefined {
  if (typeof entry === 'string') return { name: entry, options: undefined }
  if (Array.isArray(entry) && typeof entry[0] === 'string') {
    return { name: entry[0], options: entry[1] }
  }
  return undefined
}

/**
 * Whether the app loads a design-system stylesheet: a `css` entry naming the
 * tokens or the shell theme, or the shell module with its theme left on (it
 * adds `theme.css` itself, possibly after narduk-core has run).
 */
export function loadsDesignSystemFonts(options: FontsHost): boolean {
  const css = Array.isArray(options.css) ? options.css : []
  if (css.some((entry) => (DESIGN_SYSTEM_STYLESHEETS as readonly unknown[]).includes(entry))) {
    return true
  }
  const modules = Array.isArray(options.modules) ? options.modules : []
  return modules.some((candidate) => {
    const entry = moduleEntry(candidate)
    if (entry?.name !== SHELL_MODULE) return false
    const moduleOptions = entry.options as { theme?: unknown } | undefined
    return moduleOptions?.theme !== false
  })
}

function declaredFamilyNames(fonts: unknown): Set<string> {
  const names = new Set<string>()
  const families = (fonts as { families?: unknown } | undefined)?.families
  if (!Array.isArray(families)) return names
  for (const family of families) {
    const name = (family as { name?: unknown } | undefined)?.name
    if (typeof name === 'string') names.add(name.toLowerCase())
  }
  return names
}

/**
 * Add the design system's families to `nuxt.options.fonts` when the app loads
 * a design-system stylesheet, and return the names added. An app's own entry
 * for a family wins by name, so a narrower weight list, another provider or
 * `provider: 'none'` is respected. Must run before `@nuxt/fonts` installs: it
 * reads `nuxt.options.fonts` once, in its own setup.
 */
export function seedDesignSystemFonts(options: FontsHost): string[] {
  if (!loadsDesignSystemFonts(options)) return []
  const declared = declaredFamilyNames(options.fonts)
  const missing = DESIGN_SYSTEM_FONT_FAMILIES.filter(
    (family) => !declared.has(family.name.toLowerCase()),
  )
  if (missing.length === 0) return []
  const fonts = (options.fonts ??= {}) as { families?: unknown[] }
  fonts.families = [
    ...(Array.isArray(fonts.families) ? fonts.families : []),
    ...missing.map((family) => ({
      ...family,
      weights: [...family.weights],
      styles: [...family.styles],
    })),
  ]
  return missing.map((family) => family.name)
}
