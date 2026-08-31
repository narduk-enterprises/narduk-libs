import { expect } from '@playwright/test'

import type { Page, TestInfo } from '@playwright/test'

/**
 * Axe-driven WCAG conformance for Narduk apps, asserted against a recorded
 * baseline rather than against zero.
 *
 * WHY A BASELINE AND NOT A CLEAN GATE. An app that has never run axe almost
 * always has debt on its first run — usually contrast on state colours a design
 * system produces, which is a token change rather than a CSS edit and often a
 * design decision rather than an engineering one. A gate that demands zero on
 * day one gets disabled by the first person it blocks; a gate that reports and
 * passes teaches nothing. This asserts in BOTH directions instead:
 *
 *   - a rule that fires and is NOT in the baseline fails. New debt cannot land
 *     silently, which is the property that actually matters.
 *   - a rule in the baseline that no longer fires ALSO fails, asking for the
 *     baseline to be lowered. Debt cannot be quietly re-accrued behind a stale
 *     allowance, and paying it down is rewarded rather than ignored.
 *
 * The baseline file is therefore a ledger that only ever shrinks.
 *
 * WHAT AXE CAN AND CANNOT SETTLE. It catches contrast, missing accessible
 * names, landmark and heading structure, invalid ARIA, and form labelling —
 * mechanically and repeatably. It cannot judge whether a reading order makes
 * sense, whether an accessible name is *useful*, or whether a person using a
 * screen reader can complete a task. Those need a person, and a conformance
 * claim resting on this alone should say so.
 *
 * `@axe-core/playwright` is a peer dependency: the consuming app owns its
 * Playwright version, and a second copy of the runner in this package's tree is
 * how matcher globals end up installed twice.
 */

/**
 * The tag set that composes a WCAG 2.2 AA claim.
 *
 * `best-practice` is deliberately absent. Best-practice findings are advice
 * rather than the standard, and mixing them makes a red gate ambiguous about
 * whether the product is non-conforming or merely unfashionable.
 */
export const WCAG_2_2_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

export interface AxeViolationNode {
  target: string[]
}

export interface AxeViolation {
  id: string
  impact?: string | null
  help?: string
  nodes: AxeViolationNode[]
}

export interface AxeResults {
  violations: AxeViolation[]
}

/** A ledger of known violations, keyed by whatever identifies the surface. */
export type AccessibilityBaseline = Record<string, string[]>

/**
 * Flatten violations into something a failure message can name. Three nodes per
 * rule is enough to find the offender and short enough to read in CI output.
 */
export function describeViolations(violations: AxeViolation[]) {
  return violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }))
}

export interface AssertAgainstBaselineOptions {
  /** Where the ledger lives, for the message that asks callers to update it. */
  baselinePath?: string
  /** Defaults to `info.title`. Pass a route when titles are not unique. */
  key?: string
}

/**
 * Assert a scan against the ledger, in both directions.
 *
 * Deliberately takes results rather than a page: the caller owns how the scan
 * is built — `AxeBuilder` options, disabled rules, `include`/`exclude` — and a
 * helper that also constructed the scan would have to grow a parameter for
 * every one of those.
 */
export function assertAgainstAccessibilityBaseline(
  info: TestInfo,
  results: AxeResults,
  baseline: AccessibilityBaseline,
  options: AssertAgainstBaselineOptions = {}
): void {
  const key = options.key ?? info.title
  const where = options.baselinePath ?? 'the accessibility baseline'
  const known = [...(baseline[key] ?? [])].sort()
  const found = [...new Set(results.violations.map((violation) => violation.id))].sort()

  const appeared = found.filter((id) => !known.includes(id))
  expect(
    appeared,
    `NEW accessibility violation on "${key}" — ${JSON.stringify(
      describeViolations(results.violations.filter((v) => appeared.includes(v.id))),
      null,
      1
    )}`
  ).toEqual([])

  const fixed = known.filter((id) => !found.includes(id))
  expect(
    fixed,
    `"${key}" no longer violates ${fixed.join(', ')} — remove it from ${where} `
    + 'so the debt cannot be re-accrued'
  ).toEqual([])
}

/**
 * Three properties axe has no rule for, each of which a design system can
 * promise and silently lose. Registered as plain assertions rather than tests
 * so the consuming app decides how they are grouped and named.
 */

export interface TextZoomOptions {
  /** A landmark or heading that must survive the zoom. */
  mustRemainVisible?: string
  /** Percentage to scale the ROOT font size to. WCAG 1.4.4 asks for 200. */
  percent?: number
}

/**
 * WCAG 1.4.4 is about scaling TEXT, so this scales the root font size rather
 * than the viewport — zooming a viewport out passes while real 200% text still
 * overflows, which is the version of this check that proves nothing.
 */
export async function expectNoOverflowAtTextZoom(
  page: Page,
  options: TextZoomOptions = {}
): Promise<void> {
  const percent = options.percent ?? 200
  await page.addStyleTag({ content: `html { font-size: ${percent}% !important }` })
  await page.waitForTimeout(150)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow, `sideways scroll at ${percent}% text`).toBeLessThanOrEqual(1)

  if (options.mustRemainVisible) {
    await expect(page.locator(options.mustRemainVisible)).toBeVisible()
  }
}

/**
 * State must never be carried by colour alone (WCAG 1.4.1). The cheap proof is
 * that every state indicator also carries text: if the words still name the
 * state, the hue was decoration rather than the message.
 */
export async function expectStateNotCarriedByColourAlone(
  page: Page,
  selector: string
): Promise<void> {
  const indicators = page.locator(selector)
  const count = await indicators.count()
  expect(count, `no state indicators matched ${selector}`).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await expect(indicators.nth(index)).not.toHaveText('')
  }
}

/**
 * `prefers-reduced-motion` must REMOVE transitions, not merely shorten them.
 * A 40ms transition still animates, and the users this setting exists for are
 * the ones a shortened animation does not help.
 *
 * The caller supplies a context already created with `reducedMotion: 'reduce'`;
 * creating one here would hide from the caller that a second browser context is
 * being opened.
 */
export async function expectNoTransitionsUnderReducedMotion(
  page: Page,
  selector: string
): Promise<void> {
  const moving = await page.evaluate((sel) =>
    Array.from(document.querySelectorAll<HTMLElement>(sel))
      .map((node) => getComputedStyle(node).transitionDuration)
      .filter((duration) => duration !== '0s' && duration !== ''), selector)
  expect(moving, 'a transition survived prefers-reduced-motion').toEqual([])
}
