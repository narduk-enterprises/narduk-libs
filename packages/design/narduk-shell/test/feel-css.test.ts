/*
 * The feel utilities at the foot of theme.css keep their contract: 100-150ms
 * timing from tokens, only opacity and transform animate, controls revealed on
 * hover stay visible on touch and under focus, and reduced motion collapses it
 * all. The sheet is plain CSS, so a block reader is enough.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const themeCss = readFileSync(join(packageRoot, 'theme.css'), 'utf8')
const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')

const FEEL_START = themeCss.indexOf('Feel utilities')
const feel = themeCss
  .slice(themeCss.lastIndexOf('/*', FEEL_START))
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')

/** Every top-level rule or at-rule in the feel section, as `[prelude, body]`. */
function blocks(css: string): Array<[string, string]> {
  const found: Array<[string, string]> = []
  let depth = 0
  let start = 0
  let prelude = ''
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      if (depth === 0) {
        prelude = css.slice(start, index).trim()
        start = index + 1
      }
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        found.push([prelude, css.slice(start, index)])
        start = index + 1
      }
    }
  }
  return found
}

const rules = blocks(feel)
const reducedMotion = rules.find(
  ([prelude]) => prelude === '@media (prefers-reduced-motion: reduce)',
)
const rule = (selector: string) =>
  rules.find(([prelude]) => prelude === selector)?.[1] ?? expect.fail(`no rule for ${selector}`)

describe('feel tokens', () => {
  it('declares the 100-150ms timing and the ease-out curve', () => {
    expect(themeCss).toMatch(/--ne-feel-fast:\s*120ms;/)
    expect(themeCss).toMatch(/--ne-feel-base:\s*150ms;/)
    expect(themeCss).toMatch(/--ne-ease-out:\s*cubic-bezier\(0\.2,\s*0,\s*0,\s*1\);/)
  })

  it('documents each token in the README token table', () => {
    for (const token of ['--ne-feel-fast', '--ne-feel-base', '--ne-ease-out']) {
      expect(readme).toContain(`| \`${token}\``)
    }
  })
})

describe('feel utilities', () => {
  it('finds the section and every class the README documents', () => {
    expect(FEEL_START).toBeGreaterThan(0)
    for (const name of ['ne-press', 'ne-hover-reveal', 'ne-reveal', 'ne-fade-in', 'ne-skeleton']) {
      expect(feel, `${name} missing from theme.css`).toContain(`.${name}`)
      expect(readme, `${name} missing from the README`).toContain(`.${name}`)
    }
    expect(feel).toContain('.ne-fade-enter-active')
    expect(readme).toContain('<Transition name="ne-fade">')
  })

  it('animates only opacity and transform', () => {
    const properties = [...feel.matchAll(/transition-property\s*:([^;]+);/g)].map((m) => m[1])
    const shorthand = [...feel.matchAll(/(?<![-\w])transition\s*:([^;]+);/g)].map((m) =>
      m[1]!.trim(),
    )
    expect(properties).toEqual([])
    expect(shorthand.length).toBeGreaterThan(0)
    for (const value of shorthand) {
      for (const layer of value.split(',')) {
        const property = layer.trim().split(/\s+/)[0]
        expect(['opacity', 'transform'], `transition on ${property}`).toContain(property)
      }
    }
    for (const [, body] of rules.filter(([prelude]) => prelude.startsWith('@keyframes'))) {
      const keyframeProperties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
      expect(keyframeProperties.length).toBeGreaterThan(0)
      for (const property of keyframeProperties) {
        expect(['opacity', 'transform'], `keyframe animates ${property}`).toContain(property)
      }
    }
    expect(feel).not.toMatch(
      /transition(?:-property)?\s*:[^;]*\b(?:all|width|height|top|left|margin|padding)\b/,
    )
  })

  it('times every transition and animation from the tokens', () => {
    const timings = [...feel.matchAll(/(?<![-\w])(?:transition|animation)\s*:([^;]+);/g)].map((m) =>
      m[1]!.trim(),
    )
    expect(timings.length).toBeGreaterThan(3)
    for (const value of timings.filter((timing) => timing !== 'none')) {
      expect(value).toMatch(/var\(--ne-feel-(?:fast|base)\)|\d+(?:\.\d+)?s\b/)
      expect(value).toContain('var(--ne-ease-out)')
    }
    expect(rule(':where(.ne-press)')).toContain('var(--ne-feel-fast)')
    expect(rule(':where(.ne-fade-in)')).toContain('var(--ne-feel-base)')
  })

  it('keeps hover-revealed controls in the layout box and visible on touch and focus', () => {
    const hidden = rule(':where(.ne-hover-reveal .ne-reveal)')
    expect(hidden).toMatch(/opacity:\s*0;/)
    expect(hidden).not.toMatch(/display|visibility|width|height|position/)
    const shown = rules.find(([prelude]) => prelude.includes('.ne-hover-reveal:hover'))!
    expect(shown[0]).toContain('.ne-hover-reveal:focus-within .ne-reveal')
    expect(shown[1]).toMatch(/opacity:\s*1;/)
    const touch = rules.find(([prelude]) => prelude === '@media (hover: none)')!
    expect(touch[1]).toMatch(/\.ne-hover-reveal \.ne-reveal[\s\S]*opacity:\s*1;/)
  })

  it('does not press a disabled control', () => {
    const [prelude] = rules.find(([p]) => p.includes('.ne-press:active'))!
    expect(prelude).toContain(":not(:disabled, [aria-disabled='true'])")
  })

  it('has zero specificity: every selector sits in :where()', () => {
    // `@keyframes` stops are not selectors; at-rules wrap selectors that are checked below.
    const selectors = rules
      .filter(([prelude]) => !prelude.startsWith('@'))
      .map(([prelude]) => prelude)
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) expect(selector.startsWith(':where(')).toBe(true)
  })
})

describe('reduced motion', () => {
  it('collapses the durations, the press scale, the fade-in and the skeleton pulse', () => {
    expect(reducedMotion, 'no prefers-reduced-motion block in the feel section').toBeDefined()
    const body = reducedMotion![1]
    expect(body).toMatch(/--ne-feel-fast:\s*0ms;/)
    expect(body).toMatch(/--ne-feel-base:\s*0ms;/)
    expect(body).toMatch(/\.ne-press:active[\s\S]*transform:\s*none;/)
    expect(body).toMatch(/\.ne-fade-in\)\s*\{\s*animation:\s*none;/)
    expect(body).toMatch(/\.ne-skeleton\)\s*\{\s*animation:\s*none;/)
  })

  it('is the last block, so it wins every tie with the rules above it', () => {
    expect(rules.at(-1)?.[0]).toBe('@media (prefers-reduced-motion: reduce)')
  })
})
