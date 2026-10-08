/*
 * The phone layout of NeCollectionTable ships once, as rules in the component's stylesheet
 * (narduk-libs#1704), because a cell's markup is only a role class. A DOM test environment cannot
 * resolve media queries, so this reads the compiled-in `<style>` block and holds each breakpoint to
 * the rules the per-cell utilities used to carry. The mount and SSR tests prove the markup side.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../src/runtime/components/NeCollectionTable.vue', import.meta.url),
  'utf8',
)
// Prettier wraps long selectors; compare on one line.
const css = /<style>([\s\S]*)<\/style>/.exec(source)![1]!.replaceAll(/\s+/g, ' ')

const BREAKPOINTS = { lg: '64rem', md: '48rem', sm: '40rem' } as const

/** The declarations of the rule whose selector list contains `selector`, within `scope`. */
function rule(scope: string, selector: string): string {
  const at = scope.indexOf(selector)
  expect(at, `selector ${selector}`).toBeGreaterThan(-1)
  return scope.slice(scope.indexOf('{', at) + 1, scope.indexOf('}', at))
}

function below(breakpoint: keyof typeof BREAKPOINTS): string {
  const head = `@media (width < ${BREAKPOINTS[breakpoint]}) {`
  const start = css.indexOf(head)
  expect(start, head).toBeGreaterThan(-1)
  const next = css.indexOf('/* ---- below', start)
  return css.slice(start, next === -1 ? undefined : next)
}

describe.each(Object.keys(BREAKPOINTS) as Array<keyof typeof BREAKPOINTS>)(
  'NeCollectionTable stylesheet, below %s',
  (breakpoint) => {
    const scope = below(breakpoint)
    const root = `[data-ne-collection-table][data-ne-stack-below='${breakpoint}']`
    const cards = `${root}[data-ne-phone-layout='cards']`

    it('hides dropped columns, header cells and cells alike', () => {
      expect(rule(scope, `${root} .ne-cell--drop {`)).toContain('display: none')
      expect(scope).toContain(`${root} .ne-head--drop`)
    })

    it('makes the row a card with one divider, and its cells none', () => {
      const row = rule(scope, `${cards} .ne-row {`)
      expect(row).toContain('display: flex')
      expect(row).toContain('flex-direction: column')
      expect(row).toContain('border-bottom: 1px solid var(--ui-border)')
      expect(rule(scope, `${cards} .ne-cell:not(.ne-cell--drop) {`)).toContain('border-width: 0')
      expect(rule(scope, `${cards} .ne-row--hit {`)).toContain('min-height: 2.75rem')
    })

    it('lays a cell out as label then value, never wider than the card', () => {
      const cell = rule(
        scope,
        `${cards} .ne-cell:not(.ne-cell--drop):not(.ne-cell--pri):not(.ne-cell--free) {`,
      )
      expect(cell).toContain('display: flex')
      expect(cell).toContain('flex-wrap: wrap')
      expect(scope).toContain('flex-basis: 7.5rem')
      expect(scope).toMatch(/> \*\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*flex: 1 1 0%/)
      expect(rule(scope, `${cards} .ne-cell:not(.ne-cell--drop) {`)).toContain('max-width: 100%')
    })

    it('prints the label from data-ne-label on every cell but the primary one', () => {
      const label = rule(scope, '.ne-cell--pri)::before {')
      expect(label).toContain("content: attr(data-ne-label) / ''")
      expect(label).toContain('color: var(--ui-text-muted)')
    })

    it('drops a cell with nothing to say', () => {
      expect(scope).toContain(':empty,')
      expect(scope).toContain(':has(> [data-ne-empty]:only-child)')
    })

    it('clamps free text to two lines and tints the sorted column above the line', () => {
      expect(rule(scope, '.ne-cell--free {')).toContain('-webkit-line-clamp: 2')
      expect(css).toContain(`@media (width >= ${BREAKPOINTS[breakpoint]}) {`)
    })

    it('keeps the 44px floor on a `columns` layout header button', () => {
      expect(rule(scope, `${root}[data-ne-phone-layout='columns'] .ne-head button {`)).toContain(
        'min-height: 2.75rem',
      )
    })
  },
)
