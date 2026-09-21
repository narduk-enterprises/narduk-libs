/**
 * Design tokens, read from the coded stylesheets rather than restated.
 *
 * `narduk-ui/tokens.css` (the `--ns-*` status system) and
 * `narduk-shell/theme.css` (the `--ne-*` layer and its `--ui-*` bridge) are
 * authoritative. The Foundations page lists every custom property declared in
 * a top-level `:root` / `.light` rule (the light scheme) or `.dark` rule (the
 * dark scheme). Declarations inside `@media`, `@supports` or a product
 * `[data-app]` scope are overrides of those values, not tokens of their own,
 * and are skipped.
 */

export interface DesignToken {
  name: string
  /** Which stylesheet declares it, e.g. `narduk-shell/theme.css`. */
  source: string
  group: TokenGroup
  light: string | null
  dark: string | null
}

export type TokenGroup = 'Color' | 'Type' | 'Radius' | 'Elevation' | 'Layout' | 'Nuxt UI bridge'

const COLOR_VALUE = /^(#|rgb|hsl|oklch|oklab|color-mix|transparent|currentcolor)/i

export function groupFor(name: string, value: string): TokenGroup {
  if (name.startsWith('--ui-')) return 'Nuxt UI bridge'
  if (/radius/.test(name)) return 'Radius'
  if (/shadow/.test(name)) return 'Elevation'
  if (/font|text|leading|tracking|weight/.test(name) && !COLOR_VALUE.test(value)) return 'Type'
  if (COLOR_VALUE.test(value) || /var\(--(ne|ns)-/.test(value)) return 'Color'
  return 'Layout'
}

type Scheme = 'light' | 'dark'

function schemeFor(selector: string): Scheme | null {
  const parts = selector.split(',').map((part) => part.trim())
  if (parts.some((part) => part === '.dark' || part === ':root.dark')) return 'dark'
  if (parts.some((part) => part === ':root' || part === '.light' || part === ':root.light')) {
    return 'light'
  }
  return null
}

/** Top-level rules only: `{ selector, body }` for each rule at brace depth 0. */
export function topLevelRules(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: { selector: string; body: string }[] = []
  let depth = 0
  let selectorStart = 0
  let bodyStart = 0
  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index]
    if (character === '{') {
      if (depth === 0) bodyStart = index + 1
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth < 0) throw new Error('Unbalanced "}" in stylesheet')
      if (depth === 0) {
        const selector = stripped.slice(selectorStart, bodyStart - 1).trim()
        const body = stripped.slice(bodyStart, index)
        if (!selector.startsWith('@')) rules.push({ selector, body })
        selectorStart = index + 1
      }
    } else if (character === ';' && depth === 0) {
      // An at-rule statement such as `@import '…';` ends outside any block.
      selectorStart = index + 1
    }
  }
  if (depth !== 0) throw new Error('Unbalanced "{" in stylesheet')
  return rules
}

export function parseTokens(css: string, source: string): DesignToken[] {
  const tokens = new Map<string, DesignToken>()
  for (const { selector, body } of topLevelRules(css)) {
    const scheme = schemeFor(selector)
    if (!scheme || body.includes('{')) continue
    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
      const name = match[1] ?? ''
      const value = (match[2] ?? '').trim()
      const token = tokens.get(name) ?? {
        name,
        source,
        group: groupFor(name, value),
        light: null,
        dark: null,
      }
      token[scheme] = value
      tokens.set(name, token)
    }
  }
  return [...tokens.values()]
}
