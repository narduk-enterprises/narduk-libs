import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

import { NE_SHELL_COMPONENTS } from '../src/registry'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'src')
const runtimeRoot = join(sourceRoot, 'runtime', 'components')

function stripMarkupComments(markup: string): string {
  return markup.replaceAll(/<!--[\s\S]*?-->/g, '')
}

/**
 * Block and line comments, with `://` spared so a URL in code is not truncated
 * into a false negative.
 */
function stripCodeComments(code: string): string {
  return code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(?<![:/])\/\/[^\n]*/g, '')
}

/**
 * Everything a component can style with, comments removed.
 *
 * Parsed with `vue/compiler-sfc` rather than matched with a regex: an SFC's
 * root `<template>` contains nested `<template #slot>` blocks, and a non-greedy
 * `<template>([\s\S]*?)</template>` stops at the first inner closing tag — it
 * scanned a fragment of `NePageHeader` and of `NeConfirmDialog` and called it
 * the file.
 *
 * The script block is scanned too, because that is where a component's colour
 * and tone maps live (`NeStatusBadge`'s `ok: 'success'`), and a hardcoded value
 * reaches the screen from there exactly as well as from a class attribute.
 * Comments are removed first so an issue ref like `operator-portal#183` is not
 * read as a hex colour.
 */
function styleableSource(sfc: string, filename: string): string {
  const { descriptor, errors } = parse(sfc, { filename })
  expect(errors, `${filename} does not parse as a single-file component`).toEqual([])

  return [
    stripMarkupComments(descriptor.template?.content ?? ''),
    stripCodeComments(descriptor.script?.content ?? ''),
    stripCodeComments(descriptor.scriptSetup?.content ?? ''),
    ...descriptor.styles.map((style) => stripCodeComments(style.content)),
  ].join('\n')
}

/**
 * Derived from the registry, never hand-written.
 *
 * A hand-written map is how this contract came to cover two of five
 * components while three of the others violated it: not being listed was
 * enough to bypass the suite's "canonical" styling guardrail, silently. Every
 * component `src/module.ts` registers is scanned here the moment it is
 * registered, and `src/registry.ts` is the same list the module walks, so
 * there is no second place to remember to update.
 */
const sources = new Map(
  NE_SHELL_COMPONENTS.map((component) => {
    // `filePath` is resolved against `src/module.ts` by the module's own
    // resolver, so it resolves against `src/` here.
    const path = join(sourceRoot, component.filePath)
    return [component.name, styleableSource(readFileSync(path, 'utf8'), path)] as const
  }),
)

/**
 * The suite's styling contract (plan §1 / narduk-ui guardrail 3): components
 * read tokens and never hardcode a colour, radius, shadow or font.
 *
 * Nuxt UI semantic colour classes (`text-highlighted`, `text-muted`,
 * `text-primary`, `text-error`, `border-default`) and `UBadge`'s
 * `color` / `variant` / `size` props are legal. A hex or `rgb()`/`hsl()`/
 * `oklch()` literal, a raw `font-family`, `box-shadow` or `border-radius`
 * declaration, and Tailwind's named radius and shadow steps are not.
 *
 * ## The type scale is a token read, and the rule says so
 *
 * This list used to forbid every Tailwind type-size and font-weight utility.
 * That was written against two header components, which take their size from
 * the heading element they are handed and so never needed one — and it was
 * wrong about the rest of the suite, in a way that only stayed invisible while
 * the map above listed those same two components.
 *
 * Under Tailwind v4 (the version Nuxt UI 4.6.0 builds on) `text-sm` compiles
 * to `font-size: var(--text-sm)` and `font-medium` to
 * `font-weight: var(--font-weight-medium)`. They *are* reads of the theme's
 * type scale — the same kind of thing `text-muted` is for colour — not
 * hardcoded values, so forbidding them does not serve the contract's purpose.
 * The rule that does serve it is about hierarchy: a shared component must not
 * choose display-level type, because the page's type hierarchy belongs to the
 * app and reaches the component through the heading element it renders.
 *
 * So the body end of the scale (`text-xs`, `text-sm`, `text-base`) and the one
 * emphasis weight (`font-medium`, plus the explicit `font-normal` reset) are
 * allowed for body copy — an eyebrow, a secondary message, an error line — and
 * the display sizes (`text-lg` and up) and display weights (`font-semibold`
 * and heavier, and the light end) stay forbidden. Narrowed here once, on
 * purpose, in the single place the contract is stated; the alternative was to
 * restyle two shipped components with no visual proof in the same change.
 */
/**
 * A declaration whose whole value is one token read — `var(--ne-radius-tag)`,
 * `var(--ui-radius)` — reads a token; anything else in the value is raw.
 *
 * The three rules below used to reject the property name outright, which was
 * right while every component styled itself through Nuxt UI utility classes
 * and never wrote a declaration at all. `NeMeter` (narduk-libs#601) is the
 * suite's first plain-element instrument with a `<style scoped>` block, and
 * `font-family: var(--ne-font-mono)` is the contract working, not a breach of
 * it: the token table says `--ne-font-mono` is for every measured number.
 * Narrowed to exactly one `var()` of an NE or Nuxt UI token, with no fallback
 * — a fallback is where a literal would hide.
 */
const TOKEN_READ_ONLY = String.raw`(?!\s*var\(--(?:ne|ui)-[a-z0-9-]+\)\s*(?:[;}]|$))`

const FORBIDDEN = [
  { name: 'hex colour', pattern: /#[0-9a-f]{3,8}\b/i },
  { name: 'rgb/hsl/oklch colour', pattern: /\b(?:rgba?|hsla?|oklch)\s*\(/ },
  {
    name: 'font-family',
    pattern: new RegExp(String.raw`\bfont-family\s*:` + TOKEN_READ_ONLY, 'm'),
  },
  { name: 'box-shadow', pattern: new RegExp(String.raw`\bbox-shadow\s*:` + TOKEN_READ_ONLY, 'm') },
  {
    name: 'border-radius',
    pattern: new RegExp(String.raw`\bborder-radius\s*:` + TOKEN_READ_ONLY, 'm'),
  },
  {
    name: 'Tailwind radius or shadow step',
    pattern: /\b(?:rounded-(?:md|lg|xl)|shadow-(?:md|lg))\b/,
  },
  {
    name: 'Tailwind display font-weight',
    pattern: /\bfont-(?:thin|extralight|light|semibold|bold|extrabold|black)\b/,
  },
  {
    name: 'Tailwind display type-size',
    pattern: /\btext-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/,
  },
]

describe('styling contract', () => {
  it('lets a declaration read one token, and still rejects a raw or fallback value', () => {
    const rule = (name: string) => FORBIDDEN.find((entry) => entry.name === name)!.pattern
    // Token reads: allowed.
    expect('font-family: var(--ne-font-mono);').not.toMatch(rule('font-family'))
    expect('border-radius: var(--ne-radius-tag);').not.toMatch(rule('border-radius'))
    expect('box-shadow: var(--ne-shadow-1)\n}').not.toMatch(rule('box-shadow'))
    expect('border-radius:var(--ui-radius)}').not.toMatch(rule('border-radius'))
    // Raw values, fallbacks and compound values: still rejected.
    expect("font-family: 'IBM Plex Mono', monospace;").toMatch(rule('font-family'))
    expect('font-family: var(--ne-font-mono, monospace);').toMatch(rule('font-family'))
    expect('border-radius: 9999px;').toMatch(rule('border-radius'))
    expect('border-radius: calc(var(--ne-radius-base) * 2);').toMatch(rule('border-radius'))
    expect('box-shadow: 0 1px 2px var(--ne-hairline);').toMatch(rule('box-shadow'))
    expect('box-shadow: var(--app-shadow);').toMatch(rule('box-shadow'))
  })

  it('covers every registered component', () => {
    expect(sources.size).toBe(NE_SHELL_COMPONENTS.length)
    expect(sources.size).toBeGreaterThan(0)
    for (const source of sources.values()) expect(source.length).toBeGreaterThan(0)
  })

  it('leaves no shipped runtime component outside the registry, and so outside this scan', () => {
    // The registry is the contract's source of truth, which only holds if a
    // component cannot ship beside it unregistered.
    const onDisk = readdirSync(runtimeRoot)
      .filter((entry) => entry.endsWith('.vue'))
      .sort()
    expect(onDisk).toEqual(
      NE_SHELL_COMPONENTS.map((component) => component.filePath.split('/').pop()).sort(),
    )
  })

  for (const [name, source] of sources) {
    it(`${name} does not hardcode colour, radius, shadow or display type`, () => {
      for (const { name: rule, pattern } of FORBIDDEN) {
        expect(source, `${name} contains a hardcoded ${rule}`).not.toMatch(pattern)
      }
    })
  }
})
