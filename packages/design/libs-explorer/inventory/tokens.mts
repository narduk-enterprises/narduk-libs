/**
 * Design tokens, read from the coded stylesheets rather than restated.
 *
 * `narduk-ui/tokens.css` (the `--ns-*` status system) and
 * `narduk-shell/theme.css` (the `--ne-*` layer and its `--ui-*` bridge) are
 * authoritative. PostCSS parses them, so strings, escapes and comments inside
 * a value survive exactly as written.
 *
 * What counts as a token:
 *
 * - A custom property declared directly inside a top-level rule whose selector
 *   list names `:root` or `.light` (the light scheme) or `.dark` (the dark
 *   scheme). A rule naming both sets both.
 * - Declarations nested in a condition (`@media`, `@supports`, a nested
 *   `@media` inside the rule itself) are responsive or conditional overrides
 *   of a token, not tokens of their own, and are skipped. The unconditional
 *   declarations of the same rule are kept.
 * - Rules under a top-level at-rule, and rules for any other selector (a
 *   product `[data-app]` scope, say), are skipped.
 *
 * `dark: null` means the stylesheet declares no dark value, so the light value
 * is inherited in both schemes. An explicit dark declaration is kept even when
 * it repeats the light value.
 */
import postcss, { type Declaration, type Rule } from 'postcss'

export type TokenGroup =
  'Color' | 'Typography' | 'Spacing' | 'Radius' | 'Elevation' | 'Layout' | 'Nuxt UI bridge'

/** How the Foundations page draws a token. `none` means text only. */
export type TokenPreview =
  | 'color'
  | 'channels'
  | 'shadow'
  | 'radius'
  | 'font-family'
  | 'font-size'
  | 'line-height'
  | 'tracking'
  | 'font-weight'
  | 'length'
  | 'none'

export interface DesignToken {
  name: string
  /** Which stylesheet declares it, e.g. `narduk-shell/theme.css`. */
  source: string
  group: TokenGroup
  preview: TokenPreview
  light: string | null
  dark: string | null
}

type Scheme = 'light' | 'dark'

const LIGHT_SELECTORS = new Set([':root', '.light', ':root.light'])
const DARK_SELECTORS = new Set(['.dark', ':root.dark'])

function schemesFor(rule: Rule): Scheme[] {
  const schemes = new Set<Scheme>()
  for (const selector of rule.selectors.map((part) => part.trim())) {
    if (LIGHT_SELECTORS.has(selector)) schemes.add('light')
    if (DARK_SELECTORS.has(selector)) schemes.add('dark')
  }
  return [...schemes]
}

/** Unconditional custom-property declarations, per scheme, in source order. */
export function readDeclarations(css: string): { name: string; value: string; scheme: Scheme }[] {
  const out: { name: string; value: string; scheme: Scheme }[] = []
  for (const node of postcss.parse(css).nodes) {
    if (node.type !== 'rule') continue
    const schemes = schemesFor(node)
    if (schemes.length === 0) continue
    for (const child of node.nodes) {
      if (child.type !== 'decl' || !child.prop.startsWith('--')) continue
      const value = (child as Declaration).value.trim()
      for (const scheme of schemes) out.push({ name: child.prop, value, scheme })
    }
  }
  return out
}

const COLOR_LITERAL =
  /^(?:#[\da-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|transparent$|currentcolor$)/i
const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i
const CHANNELS = /^\d{1,3}(?:\s+\d{1,3}){2}$/
const LENGTH = /^-?\d*\.?\d+(?:px|rem|em)$/
const UNITLESS = /^-?\d*\.?\d+$/
const SHADOW = /(?:^|,)\s*(?:inset\s+)?-?\d*\.?\d+(?:px)?\s+-?\d*\.?\d+(?:px)?\s/

function referenceOf(value: string): string | null {
  return /^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? null
}

function classifyByName(name: string): { group: TokenGroup; preview: TokenPreview } | null {
  if (/shadow/.test(name) || /^--ns-(?:e\d|well|bezel)$/.test(name)) {
    return { group: 'Elevation', preview: 'shadow' }
  }
  if (/radius/.test(name) || /^--ns-r-/.test(name)) return { group: 'Radius', preview: 'radius' }
  if (/-font-|^--[a-z]+-font$/.test(name)) return { group: 'Typography', preview: 'font-family' }
  // `--ns-body-line` is a line height; `--ns-line` and `--ns-line-soft` are colours.
  if (/^--[a-z]+-.+-line$|leading/.test(name))
    return { group: 'Typography', preview: 'line-height' }
  if (/-track$|tracking/.test(name)) return { group: 'Typography', preview: 'tracking' }
  if (/weight/.test(name)) return { group: 'Typography', preview: 'font-weight' }
  if (/-size$|^--ne-text-/.test(name)) return { group: 'Typography', preview: 'font-size' }
  if (/-(?:space|gutter|margin|tap)(?:-|$)/.test(name))
    return { group: 'Spacing', preview: 'length' }
  if (/-(?:container|header-height)$/.test(name)) return { group: 'Layout', preview: 'none' }
  return null
}

function classifyByValue(value: string): { group: TokenGroup; preview: TokenPreview } | null {
  if (GRADIENT.test(value) || COLOR_LITERAL.test(value)) return { group: 'Color', preview: 'color' }
  if (CHANNELS.test(value)) return { group: 'Color', preview: 'channels' }
  if (SHADOW.test(value) && /(?:rgb|#|var\()/.test(value)) {
    return { group: 'Elevation', preview: 'shadow' }
  }
  if (LENGTH.test(value)) return { group: 'Layout', preview: 'none' }
  if (UNITLESS.test(value)) return { group: 'Layout', preview: 'none' }
  return null
}

/**
 * The token's family. The name decides first, because every family here is
 * named for what it is (`--ns-r-*`, `-track`, `--ne-shadow-*`). A value that is
 * only a `var()` reference takes the family of the token it points at; a
 * reference is not evidence of a colour by itself.
 */
export function classifyToken(
  name: string,
  value: string,
  resolve: (reference: string) => string | undefined = () => undefined,
  seen: Set<string> = new Set(),
): { group: TokenGroup; preview: TokenPreview } {
  if (name.startsWith('--ui-')) return { group: 'Nuxt UI bridge', preview: 'none' }
  const byName = classifyByName(name)
  if (byName) return byName
  const reference = referenceOf(value)
  if (reference && !seen.has(reference)) {
    const target = resolve(reference)
    if (target !== undefined) {
      seen.add(name)
      return classifyToken(reference, target, resolve, seen)
    }
  }
  return classifyByValue(value) ?? { group: 'Layout', preview: 'none' }
}

export function parseTokens(css: string, source: string): DesignToken[] {
  const tokens = new Map<string, DesignToken>()
  for (const { name, value, scheme } of readDeclarations(css)) {
    const token = tokens.get(name) ?? {
      name,
      source,
      group: 'Layout' as TokenGroup,
      preview: 'none' as TokenPreview,
      light: null,
      dark: null,
    }
    token[scheme] = value
    tokens.set(name, token)
  }
  return [...tokens.values()]
}

/** Classifies every token against the whole set, so references resolve across sheets. */
export function classifyTokens(tokens: DesignToken[]): DesignToken[] {
  const byName = new Map(tokens.map((token) => [token.name, token]))
  const resolve = (reference: string) => {
    const target = byName.get(reference)
    return target ? (target.light ?? target.dark ?? undefined) : undefined
  }
  return tokens.map((token) => ({
    ...token,
    ...classifyToken(token.name, token.light ?? token.dark ?? '', resolve),
  }))
}
