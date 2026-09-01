import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  WCAG_2_2_AA_TAGS,
  assertAgainstAccessibilityBaseline,
  describeViolations,
  textScalingVerdict,
} from '../src/playwright/accessibility.js'

import type { AxeResults } from './accessibility-types.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Enough of Playwright's TestInfo for the baseline assertion to key off. */
const info = (title: string) =>
  ({ title }) as unknown as Parameters<typeof assertAgainstAccessibilityBaseline>[0]

const results = (...ids: string[]): AxeResults => ({
  violations: ids.map((id) => ({
    help: `${id} help`,
    id,
    impact: 'serious',
    nodes: [{ target: [`.${id}`] }],
  })),
})

describe('the WCAG tag set', () => {
  it('composes 2.2 AA and deliberately excludes best-practice', () => {
    expect([...WCAG_2_2_AA_TAGS]).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

    /*
     * best-practice findings are advice rather than the standard. Including
     * them makes a red gate ambiguous about whether the product is
     * non-conforming or merely unfashionable, which is how a conformance gate
     * stops being trusted.
     */
    expect([...WCAG_2_2_AA_TAGS]).not.toContain('best-practice')
  })
})

describe('the baseline assertion', () => {
  it('passes when the scan matches the ledger exactly', () => {
    expect(() =>
      assertAgainstAccessibilityBaseline(info('/'), results('color-contrast'), {
        '/': ['color-contrast'],
      }),
    ).not.toThrow()
  })

  it('fails on a rule the ledger does not allow — new debt cannot land silently', () => {
    expect(() =>
      assertAgainstAccessibilityBaseline(
        info('/'),
        results('color-contrast', 'aria-required-attr'),
        {
          '/': ['color-contrast'],
        },
      ),
    ).toThrow(/NEW accessibility violation/)
  })

  it('fails when a known rule stops firing — debt cannot be quietly re-accrued', () => {
    /*
     * The direction that makes this a ledger rather than an allowlist. Without
     * it a baseline entry outlives its fix, and the next regression lands
     * inside a stale allowance without anyone noticing.
     */
    expect(() =>
      assertAgainstAccessibilityBaseline(info('/'), results(), { '/': ['color-contrast'] }),
    ).toThrow(/no longer violates color-contrast/)
  })

  it('names the ledger file so the failure says what to edit', () => {
    expect(() =>
      assertAgainstAccessibilityBaseline(
        info('/'),
        results(),
        { '/': ['color-contrast'] },
        {
          baselinePath: 'tests/e2e/a11y-baseline.json',
        },
      ),
    ).toThrow(/tests\/e2e\/a11y-baseline\.json/)
  })

  it('keys off an explicit key when titles are not unique', () => {
    expect(() =>
      assertAgainstAccessibilityBaseline(
        info('duplicate title'),
        results('color-contrast'),
        {
          '/products': ['color-contrast'],
        },
        { key: '/products' },
      ),
    ).not.toThrow()
  })

  it('treats an unlisted surface as required to be clean', () => {
    expect(() =>
      assertAgainstAccessibilityBaseline(info('/new-page'), results('color-contrast'), {}),
    ).toThrow(/NEW accessibility violation/)
  })
})

describe('describeViolations', () => {
  it('caps nodes at three so a failure stays readable in CI output', () => {
    const many = {
      violations: [
        {
          help: 'h',
          id: 'color-contrast',
          impact: 'serious',
          nodes: [1, 2, 3, 4, 5].map((n) => ({ target: [`.n${n}`] })),
        },
      ],
    }
    expect(describeViolations(many.violations)[0]!.nodes).toEqual(['.n1', '.n2', '.n3'])
  })
})

describe('the published surface', () => {
  it('exports the accessibility helpers on their own subpath', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      peerDependencies: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }

    expect(Object.keys(packageJson.exports)).toContain('./playwright/accessibility')

    /*
     * `@axe-core/playwright` is an OPTIONAL peer: the consuming app owns its
     * Playwright version, and apps that use the other testkit families should
     * not be made to install an axe runtime they never call.
     */
    expect(packageJson.peerDependencies['@axe-core/playwright']).toBeDefined()
    expect(packageJson.peerDependenciesMeta?.['@axe-core/playwright']?.optional).toBe(true)
  })

  it('keeps the module free of a direct axe import', () => {
    /*
     * The helpers take RESULTS rather than building the scan, so the package
     * never imports axe itself — which is what lets the peer stay optional.
     */
    const source = readFileSync(join(packageRoot, 'src/playwright/accessibility.ts'), 'utf8')
    expect(source).not.toContain("from '@axe-core/playwright'")
  })
})

describe('textScalingVerdict', () => {
  /*
   * This is the judgement the text-zoom check makes, and the reason it is a
   * separate function at all. The first version of that check raised the root
   * font size and asserted only that nothing overflowed — which a page with
   * px-declared typography passes trivially, because nothing moves. It could
   * not fail, and it was cited as WCAG 1.4.4 evidence. Found in production on
   * 2026-09-01.
   */

  it('fails a page whose text does not move at all — the defect that shipped', () => {
    const verdict = textScalingVerdict(16, 16, 200)
    expect(verdict.ok).toBe(false)
    expect(verdict.actual).toBe(1)
    expect(verdict.reason).toMatch(/did not scale at all/)
  })

  it('says plainly that the overflow assertion would have passed', () => {
    // The failure message has to explain why the surrounding check looked
    // green, or the next reader concludes the tool is broken.
    expect(textScalingVerdict(16, 16, 200).reason).toMatch(/would have PASSED/)
  })

  it('passes text that scales fully with the root', () => {
    expect(textScalingVerdict(16, 32, 200).ok).toBe(true)
  })

  it('accepts damped scaling above the tolerance floor', () => {
    // clamp() ceilings and container queries legitimately damp the top end.
    const verdict = textScalingVerdict(16, 26, 200)
    expect(verdict.ok).toBe(true)
    expect(verdict.required).toBeCloseTo(1.5)
  })

  it('rejects scaling below the tolerance floor', () => {
    const verdict = textScalingVerdict(16, 20, 200)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/1\.25x against a required 1\.50x/)
  })

  it('honours a stricter tolerance', () => {
    expect(textScalingVerdict(16, 26, 200, 1).ok).toBe(false)
    expect(textScalingVerdict(16, 32, 200, 1).ok).toBe(true)
  })

  it('scales its requirement with the requested percentage', () => {
    // 150% at the default tolerance requires 1.25x, not 1.5x.
    expect(textScalingVerdict(16, 20, 150).ok).toBe(true)
    expect(textScalingVerdict(16, 18, 150).ok).toBe(false)
  })

  it('refuses a probe that measured nothing rather than dividing by zero', () => {
    expect(textScalingVerdict(0, 32, 200).ok).toBe(false)
    expect(textScalingVerdict(16, Number.NaN, 200).ok).toBe(false)
    expect(textScalingVerdict(16, Number.NaN, 200).reason).toMatch(/zero or not a number/)
  })
})
