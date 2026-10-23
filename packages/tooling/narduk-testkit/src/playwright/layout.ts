import { expect } from '@playwright/test'

import type { Page, TestInfo } from '@playwright/test'

/**
 * Two layout properties no linter and no axe rule settles: a page that scrolls
 * sideways on a narrow phone, and controls too small to hit.
 *
 * THE SPLIT. Each check is one small `page.evaluate` that returns plain facts,
 * plus pure exported functions that turn facts into findings. The judgement is
 * deliberately outside the browser call: a verdict trapped in `page.evaluate`
 * cannot be unit tested, which is how `playwright/accessibility` once shipped a
 * check that could not fail.
 *
 * Findings are asserted against a recorded baseline per surface, at check-id
 * level (`horizontal-overflow`, `touch-target-24`, `touch-target-44`) and in
 * both directions, like the axe ledger: new debt fails, and debt paid down must
 * be removed from the ledger. Node selectors are not baselined; they flap with
 * every markup change and would make the ledger a chore rather than a ratchet.
 */

export type LayoutCheckId = 'horizontal-overflow' | 'touch-target-24' | 'touch-target-44'

/** WCAG 2.2 SC 2.5.8 (AA) is 24; 44 is the AAA / Apple bar. */
export type TouchTargetSize = 24 | 44

export interface LayoutFinding {
  id: LayoutCheckId
  message: string
  /** Up to `MAX_NAMED_NODES` offenders, enough to find the first one. */
  nodes: string[]
}

export const MAX_NAMED_NODES = 5

/** The default narrow width: the smallest viewport WCAG 1.4.10 (reflow) names. */
export const DEFAULT_OVERFLOW_WIDTH = 320

/**
 * Elements a pointer or finger is expected to hit. `[tabindex]` is included
 * because a custom control is only reachable by keyboard through it; a
 * scrollable region given `tabindex=0` is counted too, and is a case for the
 * baseline rather than for the selector.
 */
export const TOUCH_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[role=button]',
  '[role=link]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=switch]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=option]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface OverflowOffender {
  selector: string
  /** Right edge in CSS px from the left of the viewport. */
  right: number
}

export interface OverflowMeasurement {
  scrollWidth: number
  innerWidth: number
  /** Leaf elements poking past the right edge; empty when nothing overflows. */
  offenders: OverflowOffender[]
}

export interface TouchTargetCandidate {
  selector: string
  tag: string
  width: number
  height: number
  /** Computed `display` of the element. */
  display: string
  /** Rendered and not hidden by `display`, `visibility` or `content-visibility`. */
  visible: boolean
  /** Self or an ancestor is `aria-hidden="true"` or `inert`. */
  ariaHidden: boolean
  /** Natively disabled or `aria-disabled="true"`. */
  disabled: boolean
  /** Characters of text in the parent that are not the element's own. */
  siblingTextLength: number
}

/**
 * Horizontal overflow beyond this many pixels is a finding. One pixel absorbs
 * sub-pixel rounding between `scrollWidth` and `innerWidth`, the same slack
 * `expectNoOverflowAtTextZoom` allows.
 */
export const OVERFLOW_TOLERANCE_PX = 1

export function overflowFindings(
  measurement: OverflowMeasurement,
  tolerance = OVERFLOW_TOLERANCE_PX,
): LayoutFinding[] {
  const overflow = measurement.scrollWidth - measurement.innerWidth
  if (!(overflow > tolerance)) return []
  return [
    {
      id: 'horizontal-overflow',
      message: `page scrolls sideways by ${overflow}px at ${measurement.innerWidth}px wide`,
      nodes: measurement.offenders
        .slice(0, MAX_NAMED_NODES)
        .map((offender) => `${offender.selector} (right edge ${Math.round(offender.right)}px)`),
    },
  ]
}

/**
 * Why a candidate does not count as a target, or null when it does.
 *
 * A box of at most 1x1 CSS px is a visually-hidden control (the usual custom
 * checkbox pattern), not a tiny one. An inline link inside a sentence is
 * exempt under SC 2.5.8's inline exception. The spacing exception (a small
 * target with 24px of clear space around it) is NOT implemented, so a
 * well-spaced small target is reported at 24.
 */
export function touchTargetExemption(candidate: TouchTargetCandidate): string | null {
  if (!candidate.visible) return 'hidden'
  if (candidate.width <= 1 && candidate.height <= 1) return 'zero-size'
  if (candidate.ariaHidden) return 'aria-hidden'
  if (candidate.disabled) return 'disabled'
  if (candidate.tag === 'a' && candidate.display === 'inline' && candidate.siblingTextLength > 0) {
    return 'inline-link'
  }
  return null
}

/** Sub-pixel layout makes a 24px control measure 23.98; half a pixel of slack absorbs it. */
export const TOUCH_TARGET_TOLERANCE_PX = 0.5

export function touchTargetFindings(
  candidates: readonly TouchTargetCandidate[],
  size: TouchTargetSize = 24,
  tolerance = TOUCH_TARGET_TOLERANCE_PX,
): LayoutFinding[] {
  const small = candidates.filter(
    (candidate) =>
      touchTargetExemption(candidate) === null &&
      (candidate.width < size - tolerance || candidate.height < size - tolerance),
  )
  if (small.length === 0) return []
  return [
    {
      id: size === 44 ? 'touch-target-44' : 'touch-target-24',
      message: `${small.length} touch target(s) smaller than ${size}x${size} CSS px`,
      nodes: small
        .slice(0, MAX_NAMED_NODES)
        .map(
          (candidate) =>
            `${candidate.selector} (${Math.round(candidate.width)}x${Math.round(candidate.height)})`,
        ),
    },
  ]
}

/** Let a resize reach layout before measuring; two frames cover a media-query reflow. */
async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/**
 * Measure sideways overflow at `width` CSS px, restoring the viewport after.
 * The evaluate callback is serialised into the page, so it references nothing
 * from this module.
 */
export async function measureHorizontalOverflow(
  page: Page,
  width = DEFAULT_OVERFLOW_WIDTH,
): Promise<OverflowMeasurement> {
  const original =
    page.viewportSize() ??
    (await page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })))
  await page.setViewportSize({ height: original.height, width })
  try {
    await settleLayout(page)
    return await page.evaluate((limit) => {
      const viewportWidth = window.innerWidth
      const scrollWidth = document.documentElement.scrollWidth
      if (scrollWidth - viewportWidth <= limit) {
        return { innerWidth: viewportWidth, offenders: [], scrollWidth }
      }

      const describe = (element: Element) => {
        const id = element.id ? `#${element.id}` : ''
        const classes = [...element.classList]
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('')
        return `${element.tagName.toLowerCase()}${id}${classes}`
      }
      const isClipped = (element: Element) => {
        for (let node = element.parentElement; node; node = node.parentElement) {
          if (node === document.documentElement) break
          if (getComputedStyle(node).overflowX !== 'visible') return true
        }
        return false
      }

      const poking = new Set<Element>()
      for (const element of document.body.querySelectorAll('*')) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.right <= viewportWidth + limit) continue
        // Fixed elements do not widen the document; clipped ones scroll inside a container.
        if (getComputedStyle(element).position === 'fixed' || isClipped(element)) continue
        poking.add(element)
      }
      // The deepest offender is the cause; its ancestors only inherit the overflow.
      const leaves = [...poking].filter(
        (element) => ![...poking].some((other) => other !== element && element.contains(other)),
      )
      return {
        innerWidth: viewportWidth,
        offenders: leaves
          .map((element) => ({
            right: element.getBoundingClientRect().right,
            selector: describe(element),
          }))
          .sort((a, b) => b.right - a.right)
          .slice(0, 20),
        scrollWidth,
      }
    }, OVERFLOW_TOLERANCE_PX)
  } finally {
    await page.setViewportSize(original)
  }
}

/** Collect raw facts about every interactive element at the current viewport. */
export async function measureTouchTargets(page: Page): Promise<TouchTargetCandidate[]> {
  return await page.evaluate((selector) => {
    const describe = (element: Element) => {
      const id = element.id ? `#${element.id}` : ''
      const classes = [...element.classList]
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('')
      const label = (element.getAttribute('aria-label') ?? element.textContent ?? '')
        .trim()
        .replaceAll(/\s+/gu, ' ')
        .slice(0, 30)
      return `${element.tagName.toLowerCase()}${id}${classes}${label ? ` "${label}"` : ''}`
    }

    return [...document.querySelectorAll(selector)].map((element) => {
      // A control's label is part of its target: clicking the label toggles a checkbox.
      const boxes = [element.getBoundingClientRect()]
      for (const label of (element as HTMLInputElement).labels ?? []) {
        boxes.push(label.getBoundingClientRect())
      }
      const box = boxes.reduce((best, next) =>
        next.width * next.height > best.width * best.height ? next : best,
      )
      // Only prose around the link counts: a row of links in a <nav> is not a sentence.
      const parent = element.parentElement
      const targetText = [
        ...(parent?.querySelectorAll('a, button, [role="link"], [role="button"]') ?? []),
      ].reduce((total, target) => total + (target.textContent ?? '').trim().length, 0)
      return {
        ariaHidden: element.closest('[aria-hidden="true"], [inert]') !== null,
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        display: getComputedStyle(element).display,
        height: box.height,
        selector: describe(element),
        siblingTextLength: Math.max(0, (parent?.textContent ?? '').trim().length - targetText),
        tag: element.tagName.toLowerCase(),
        visible: element.checkVisibility({ checkVisibilityCSS: true }),
        width: box.width,
      }
    })
  }, TOUCH_TARGET_SELECTOR)
}

export interface LayoutCheckOptions {
  /** Viewport width for the overflow check, or `false` to skip it. Defaults to 320. */
  overflowWidth?: number | false
  /** Touch-target bars to check at the current viewport. Defaults to `[24]`; `[]` skips. */
  touchTargetSizes?: TouchTargetSize[]
}

/**
 * Run the layout checks and return findings; asserting is left to the caller
 * (`assertAgainstLayoutBaseline`, or `expect(findings).toEqual([])` on a
 * clean app). The touch-target scan runs at the page's own viewport, so size
 * it for the device you mean before calling.
 */
export async function collectLayoutFindings(
  page: Page,
  options: LayoutCheckOptions = {},
): Promise<LayoutFinding[]> {
  const findings: LayoutFinding[] = []
  if (options.overflowWidth !== false) {
    findings.push(
      ...overflowFindings(
        await measureHorizontalOverflow(page, options.overflowWidth ?? DEFAULT_OVERFLOW_WIDTH),
      ),
    )
  }
  const sizes = options.touchTargetSizes ?? [24]
  if (sizes.length > 0) {
    const candidates = await measureTouchTargets(page)
    for (const size of sizes) findings.push(...touchTargetFindings(candidates, size))
  }
  return findings
}

/** A ledger of known layout debt, keyed by surface. */
export type LayoutBaseline = Record<string, LayoutCheckId[]>

export interface AssertAgainstLayoutBaselineOptions {
  /** Where the ledger lives, for the message that asks callers to update it. */
  baselinePath?: string
  /** Defaults to `info.title`. Pass a route when titles are not unique. */
  key?: string
}

/**
 * Assert findings against the ledger in both directions: a check that fires and
 * is not baselined fails, and a baselined check that no longer fires fails too,
 * so the ledger only ever shrinks.
 */
export function assertAgainstLayoutBaseline(
  info: TestInfo,
  findings: readonly LayoutFinding[],
  baseline: LayoutBaseline,
  options: AssertAgainstLayoutBaselineOptions = {},
): void {
  const key = options.key ?? info.title
  const where = options.baselinePath ?? 'the layout baseline'
  const known = [...(baseline[key] ?? [])].sort()
  const found = [...new Set(findings.map((finding) => finding.id))].sort()

  const appeared = found.filter((id) => !known.includes(id))
  expect(
    appeared,
    `NEW layout finding on "${key}" — ${JSON.stringify(
      findings.filter((finding) => appeared.includes(finding.id)),
      null,
      1,
    )}`,
  ).toEqual([])

  const fixed = known.filter((id) => !found.includes(id))
  expect(
    fixed,
    `"${key}" no longer fails ${fixed.join(', ')} — remove it from ${where} ` +
      'so the debt cannot be re-accrued',
  ).toEqual([])
}
