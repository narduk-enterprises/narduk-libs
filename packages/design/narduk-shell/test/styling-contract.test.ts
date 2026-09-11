import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'components')

const sources = {
  NePageHeader: readFileSync(join(runtimeRoot, 'NePageHeader.vue'), 'utf8'),
  NeSectionHeader: readFileSync(join(runtimeRoot, 'NeSectionHeader.vue'), 'utf8'),
}

/**
 * The suite's styling contract (plan §1 / narduk-ui guardrail 3): components
 * read tokens and never hardcode a colour, radius, shadow or font.
 *
 * Nuxt UI semantic colour classes (`text-highlighted`, `text-muted`,
 * `text-primary`) and UBadge's `color` / `variant` / `size` props are legal.
 * Hex, rgb(), a raw font-family, box-shadow, border-radius, and Tailwind
 * font-weight / type-size utilities are not.
 */
const FORBIDDEN = [
  { name: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'rgb/hsl colour', pattern: /\b(?:rgba?|hsla?)\s*\(/ },
  { name: 'font-family', pattern: /\bfont-family\s*:/ },
  { name: 'box-shadow', pattern: /\bbox-shadow\s*:/ },
  { name: 'border-radius', pattern: /\bborder-radius\s*:/ },
  {
    name: 'Tailwind font-weight',
    pattern: /\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/,
  },
  {
    name: 'Tailwind type-size',
    pattern: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/,
  },
]

describe('styling contract', () => {
  for (const [name, source] of Object.entries(sources)) {
    it(`${name} does not hardcode colour, radius, shadow or font`, () => {
      for (const { name: rule, pattern } of FORBIDDEN) {
        expect(source, `${name} contains a hardcoded ${rule}`).not.toMatch(pattern)
      }
    })
  }
})
