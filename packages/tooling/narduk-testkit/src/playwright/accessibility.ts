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
  options: AssertAgainstBaselineOptions = {},
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
      1,
    )}`,
  ).toEqual([])

  const fixed = known.filter((id) => !found.includes(id))
  expect(
    fixed,
    `"${key}" no longer violates ${fixed.join(', ')} — remove it from ${where} ` +
      'so the debt cannot be re-accrued',
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
  /**
   * The element whose computed size proves the text actually scaled. Defaults
   * to `body`, which is where a px-based type system betrays itself.
   */
  probe?: string
  /**
   * How much of the requested scaling must reach the probe, 0..1. At the
   * default 0.9 a 200% request must produce at least 1.9x text.
   *
   * Deliberately strict. An earlier draft defaulted to 0.5 on the argument
   * that `clamp()` ceilings and container queries legitimately damp the top
   * end — true, but the wrong default for a conformance check. Partial
   * scaling is itself a 1.4.4 finding, and a lenient default hides it in
   * every consumer at once. A page with a real ceiling passes
   * `scaleTolerance` explicitly, which puts the deviation in that app's own
   * test file where a reader can weigh it.
   *
   * Not 1.0, because sub-pixel rounding on a fractional base size should not
   * fail a page that is behaving correctly.
   */
  scaleTolerance?: number
}

/**
 * Decide whether text scaled enough, given the sizes either side of the zoom.
 *
 * Pulled out of the Playwright helper deliberately: it is the entire judgement
 * that check makes, and as long as it lived inside a browser call it could not
 * be tested. That is how the original shipped unable to fail.
 */
export function textScalingVerdict(
  before: number,
  after: number,
  percent: number,
  scaleTolerance = 0.9,
): { ok: boolean; actual: number; required: number; reason?: string } {
  if (!(before > 0) || !(after > 0)) {
    return {
      actual: 0,
      ok: false,
      reason: 'a probe font size was zero or not a number',
      required: 0,
    }
  }
  const requested = percent / 100
  const required = 1 + (requested - 1) * scaleTolerance
  const actual = after / before
  if (actual >= required) return { actual, ok: true, required }
  return {
    actual,
    ok: false,
    reason:
      actual <= 1.0001
        ? `text did not scale at all (${before}px before and after). The root font ` +
          'size changed and nothing followed it, so this page cannot satisfy WCAG ' +
          '1.4.4 by that route — typography is most likely declared in px rather ' +
          'than rem. Note the overflow assertion below would have PASSED, because ' +
          'nothing moved.'
        : `text scaled ${actual.toFixed(2)}x against a required ${required.toFixed(2)}x`,
    required,
  }
}

/**
 * WCAG 1.4.4 is about scaling TEXT, so this scales the root font size rather
 * than the viewport — zooming a viewport out passes while real 200% text still
 * overflows, which is the version of this check that proves nothing.
 *
 * IT ALSO PROVES THE TEXT MOVED, and that half is not optional. The first
 * version of this helper raised the root font size and went straight to the
 * overflow assertion. On a page whose typography is declared in px, nothing
 * scales — so there is no overflow, the assertion passes, and the helper
 * reports WCAG 1.4.4 conformance for a page that has none. Found in production
 * on 2026-09-01, on an app this very helper was written for.
 *
 * A check that cannot fail is worse than an absent one: it gets cited as
 * evidence. So the probe is measured either side of the zoom and must actually
 * have grown before the layout assertions are allowed to mean anything.
 */
export async function expectNoOverflowAtTextZoom(
  page: Page,
  options: TextZoomOptions = {},
): Promise<void> {
  const percent = options.percent ?? 200
  const probe = options.probe ?? 'body'

  const sizeOf = () =>
    page.evaluate((sel) => {
      const node = document.querySelector(sel)
      return node ? Number.parseFloat(getComputedStyle(node).fontSize) : Number.NaN
    }, probe)

  const before = await sizeOf()
  expect(Number.isFinite(before), `probe "${probe}" was not found or has no font size`).toBe(true)

  await page.addStyleTag({ content: `html { font-size: ${percent}% !important }` })
  await page.waitForTimeout(150)

  const after = await sizeOf()
  const verdict = textScalingVerdict(before, after, percent, options.scaleTolerance)
  expect(
    verdict.ok,
    `text did not respond to a ${percent}% root font size — ${verdict.reason}`,
  ).toBe(true)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
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
  selector: string,
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
  selector: string,
): Promise<void> {
  const moving = await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .map((node) => getComputedStyle(node).transitionDuration)
        .filter((duration) => duration !== '0s' && duration !== ''),
    selector,
  )
  expect(moving, 'a transition survived prefers-reduced-motion').toEqual([])
}
