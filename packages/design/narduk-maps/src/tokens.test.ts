import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DARK_TOKENS, LIGHT_TOKENS, metricsFor, mix, tokensFor } from './tokens'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'styles/map.css'), 'utf8')

/** The custom properties of the first rule whose selector list starts with `selector`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const vars = new Map<string, string>()
  for (const declaration of css.slice(open + 1, close).split(';')) {
    const colon = declaration.indexOf(':')
    const name = declaration.slice(0, colon).trim()
    if (colon > 0 && name.startsWith('--')) vars.set(name, declaration.slice(colon + 1).trim())
  }
  return vars
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (const [i, ch] of [...text].entries()) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

/** Resolve hex, var() and `color-mix(in srgb, A p%, B)` to a hex, like the browser would. */
function resolveColor(value: string, scope: Map<string, string>): string {
  const v = value.trim()
  if (v.startsWith('var(') && v.endsWith(')')) {
    return resolveColor(scope.get(v.slice(4, -1).trim()) as string, scope)
  }
  if (v.startsWith('color-mix(in srgb,') && v.endsWith(')')) {
    // color-mix(in srgb, A p%, B): `p` of A, the rest of B.
    const [first = '', second = ''] = splitTopLevel(v.slice('color-mix(in srgb,'.length, -1))
    const cut = first.lastIndexOf(' ')
    const a = resolveColor(first.slice(0, cut), scope)
    const percent = Number.parseFloat(first.slice(cut + 1))
    return mix(a, resolveColor(second, scope), 1 - percent / 100)
  }
  return v.toLowerCase()
}

const names: Record<string, keyof typeof LIGHT_TOKENS> = {
  '--color-map-water': 'water',
  '--color-map-land': 'land',
  '--color-map-shore': 'shore',
  '--color-map-shore-halo': 'shoreHalo',
  '--color-map-road-major': 'roadMajor',
  '--color-map-boundary': 'boundary',
  '--color-map-ink': 'ink',
  '--color-map-muted': 'muted',
  '--color-map-place-ink': 'placeInk',
  '--color-map-road': 'road',
  '--color-map-mark-ring': 'markRing',
  '--color-map-mark-core': 'markCore',
  '--color-map-hatch': 'hatch',
  '--color-map-green': 'green',
}

describe('tokens', () => {
  for (const [scheme, tokens, selector] of [
    ['light', LIGHT_TOKENS, ':root'],
    ['dark', DARK_TOKENS, '.narduk-map--dark'],
  ] as const) {
    it(`the ${scheme} CSS custom properties match the TypeScript tokens`, () => {
      const scope = new Map([...block(':root'), ...(scheme === 'dark' ? block(selector) : [])])
      for (const [prop, key] of Object.entries(names)) {
        expect(resolveColor(scope.get(prop) as string, scope), `${scheme} ${prop}`).toBe(
          tokens[key],
        )
      }
    })
  }

  it('dark has its own chosen values, not an inversion of light', () => {
    expect(DARK_TOKENS.water).not.toBe(LIGHT_TOKENS.water)
    expect(DARK_TOKENS.land).not.toBe(LIGHT_TOKENS.land)
    // Land stays lighter than water in light and the reverse is not forced in dark.
    expect(DARK_TOKENS.ink).not.toBe(LIGHT_TOKENS.land)
  })

  it('overrides win over the scheme', () => {
    expect(tokensFor('light', { water: '#000000' }).water).toBe('#000000')
    expect(tokensFor('dark').water).toBe(DARK_TOKENS.water)
    expect(metricsFor({ markRadius: 9 }).markRadius).toBe(9)
  })

  it('mix is sRGB colour-mix', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.3)).toBe('#102030')
  })
})
