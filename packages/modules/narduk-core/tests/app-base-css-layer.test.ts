import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * narduk-core's `main.css` is appended to `nuxt.options.css` AFTER the
 * consuming app's own stylesheets, so anything it writes outside a cascade
 * layer wins over the app's theme no matter what the app does: in CSS,
 * unlayered declarations beat every layered one regardless of source order.
 *
 * That made element-level defaults here silently un-overridable. This suite
 * pins the shape that keeps an app's own `body` / heading rules on top.
 */
const CSS = readFileSync(
  fileURLToPath(new URL('../runtime/app/assets/css/main.css', import.meta.url)),
  'utf8',
)

interface StyleRule {
  /** Enclosing at-rule preludes, outermost first. */
  readonly enclosing: readonly string[]
  readonly selector: string
}

/**
 * The style rules in a stylesheet, each with the at-rules it nests inside.
 *
 * This is deliberately a scanner rather than a parser: it only needs selector
 * preludes and nesting depth, and `main.css` has no strings or comments that
 * carry braces. Declaration blocks are skipped wholesale, so a nested rule
 * inside a declaration block (`&:where(...)`) is not reported -- those cannot
 * change which element-level rules are layered.
 */
function styleRules(css: string): StyleRule[] {
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '')
  const rules: StyleRule[] = []
  const stack: string[] = []
  let prelude = ''

  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index]
    if (char === '{') {
      const head = prelude
        .trim()
        .replaceAll(/\s*,\s*/g, ', ')
        .replaceAll(/\s+/g, ' ')
      prelude = ''
      if (head.startsWith('@')) {
        stack.push(head)
        continue
      }
      rules.push({ enclosing: [...stack], selector: head })
      // Skip the declaration block, including any nested rules inside it.
      let depth = 1
      while (depth > 0 && index < withoutComments.length - 1) {
        index += 1
        if (withoutComments[index] === '{') depth += 1
        else if (withoutComments[index] === '}') depth -= 1
      }
      continue
    }
    if (char === '}') {
      stack.pop()
      prelude = ''
      continue
    }
    if (char === ';' && prelude.trim().startsWith('@')) {
      // A statement at-rule (`@import`, `@source`), not a block.
      prelude = ''
      continue
    }
    prelude += char
  }

  return rules
}

/** Selectors that style a bare HTML element rather than a class or id. */
const ELEMENT_SELECTOR = /^[a-z][a-z0-9]*$/

function elementRules(): StyleRule[] {
  return styleRules(CSS).filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => ELEMENT_SELECTOR.test(part)),
  )
}

describe('narduk-core main.css cascade layers', () => {
  it('parses its own style rules', () => {
    const selectors = styleRules(CSS).map((rule) => rule.selector)
    expect(selectors).toContain('body')
    expect(selectors).toContain('.shadow-card')
    expect(selectors).toContain('.font-display')
  })

  it('keeps every element-level default inside a cascade layer', () => {
    const unlayered = elementRules().filter(
      (rule) => !rule.enclosing.some((at) => at.startsWith('@layer')),
    )
    expect(
      unlayered.map((rule) => rule.selector),
      'an unlayered element rule here overrides the consuming app’s own theme',
    ).toEqual([])
  })

  it('styles body and the headings, in @layer base', () => {
    const layers = new Map(
      elementRules().map((rule) => [
        rule.selector,
        rule.enclosing.filter((at) => at.startsWith('@layer')),
      ]),
    )
    expect(layers.get('body')).toEqual(['@layer base'])
    expect(layers.get('h1, h2, h3, h4')).toEqual(['@layer base'])
  })

  it('leaves .font-display unlayered, because an app opts into it by name', () => {
    const optIn = styleRules(CSS).find((rule) => rule.selector === '.font-display')
    expect(optIn).toBeDefined()
    expect(optIn?.enclosing).toEqual([])
  })

  it('still applies the app font families it always did', () => {
    expect(CSS).toContain('font-family: var(--font-sans)')
    expect(CSS).toContain('font-family: var(--font-display)')
  })
})
