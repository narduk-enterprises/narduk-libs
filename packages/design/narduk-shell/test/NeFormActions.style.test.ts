/*
 * NeFormActions' layout is its stylesheet: right-aligned on a desk, and below Tailwind's `sm`
 * stacked full width with the primary on top. A DOM test environment cannot resolve a media query,
 * so this reads the component's `<style>` block (the NeCollectionTable.style.test.ts pattern).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../src/runtime/components/NeFormActions.vue', import.meta.url),
  'utf8',
)
const css = /<style scoped>([\s\S]*)<\/style>/.exec(source)![1]!.replaceAll(/\s+/g, ' ')
const PHONE = '@media (width < 40rem) {'

/** The declarations of the first rule in `scope` whose selector list contains `selector`. */
function rule(scope: string, selector: string): string {
  const at = scope.indexOf(selector)
  expect(at, `selector ${selector}`).toBeGreaterThan(-1)
  return scope.slice(scope.indexOf('{', at) + 1, scope.indexOf('}', at))
}

describe('NeFormActions stylesheet', () => {
  const desk = css.slice(0, css.indexOf(PHONE))
  const phone = css.slice(css.indexOf(PHONE))

  it('has a phone block at the complement of Tailwind sm', () => {
    expect(css.indexOf(PHONE)).toBeGreaterThan(-1)
  })

  it('right-aligns the row and pins the lead to the far left on a desk', () => {
    expect(rule(desk, '.ne-form-actions {')).toContain('justify-content: flex-end')
    expect(rule(desk, '.ne-form-actions__lead {')).toContain('margin-inline-end: auto')
  })

  it('stacks below 40rem with the last button on top and every button full width', () => {
    expect(rule(phone, '.ne-form-actions {')).toContain('flex-direction: column-reverse')
    expect(rule(phone, '.ne-form-actions__lead {')).toContain('margin-inline-end: 0')
    const buttons = rule(phone, '.ne-form-actions > :deep(:where(button, a))')
    expect(buttons).toContain('width: 100%')
    expect(buttons).toContain('justify-content: center')
  })

  it('sets no colour: the row is layout only', () => {
    expect(css).not.toMatch(/color|background|#[0-9a-f]{3,8}\b/i)
  })
})
