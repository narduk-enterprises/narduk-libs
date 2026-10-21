/*
 * theme.css owns one focus ring and two safe-area utilities (README § Focus
 * ring, § Safe areas). The sheet is plain CSS, so a regex reader is enough.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const themeCss = readFileSync(join(packageRoot, 'theme.css'), 'utf8')
const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')
const css = themeCss.replaceAll(/\/\*[\s\S]*?\*\//g, '')

const body = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('the global focus ring', () => {
  it('is a 2px accent outline, 2px off the element, on :focus-visible', () => {
    const rule = body(':where(:focus-visible)')
    expect(rule).toMatch(/outline:\s*2px solid var\(--ne-accent\);/)
    expect(rule).toMatch(/outline-offset:\s*2px;/)
  })

  it('has zero specificity, so a component that draws its own ring wins', () => {
    expect(css).toContain(':where(:focus-visible) {')
    expect(css).not.toMatch(/^\s*(?:\*|html|body|:root)[^{]*:focus-visible/m)
  })

  it('is never removed without a replacement: theme.css has no `outline: none`', () => {
    expect(css).not.toMatch(/outline\s*:\s*(?:none|0)\b/)
  })

  it('is documented', () => {
    expect(readme).toMatch(/^### Focus ring$/m)
    expect(readme).toContain(':focus-visible')
  })
})

describe('the safe-area utilities', () => {
  it('pad by the inset, and let a caller add to it', () => {
    expect(body(':where(.ne-safe-top)')).toMatch(
      /padding-top:\s*calc\(var\(--ne-safe-extra-top, 0px\) \+ env\(safe-area-inset-top, 0px\)\);/,
    )
    expect(body(':where(.ne-safe-bottom)')).toMatch(
      /padding-bottom:\s*calc\(var\(--ne-safe-extra-bottom, 0px\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
    )
  })

  it('are documented', () => {
    expect(readme).toMatch(/^### Safe areas$/m)
    expect(readme).toContain('.ne-safe-top')
    expect(readme).toContain('.ne-safe-bottom')
  })
})
