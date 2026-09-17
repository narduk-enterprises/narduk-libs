import { expect, test } from '@playwright/test'

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
  /** The offending markup, when axe reports it. Kept in the attachment. */
  html?: string
}

export interface AxeViolation {
  id: string
  impact?: string | null
  help?: string
  /** Deque's page for the rule. The single most useful field in a failure. */
  helpUrl?: string
  description?: string
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

/*
 * ---------------------------------------------------------------------------
 * The estate bar: zero serious/critical on the PR subset
 * ---------------------------------------------------------------------------
 *
 * The baseline ledger above and the bar below answer two different questions
 * and are meant to be run together, not chosen between.
 *
 *   - The LEDGER asks "did this change move the debt?", against the whole 2.2
 *     AA surface. It tolerates known debt by design, so it can be pointed at
 *     an app on day one without blocking anybody.
 *   - The BAR asks "is this change shippable?", and has exactly one answer:
 *     no serious or critical violation on the routes a PR is gated on
 *     (Logan, 2026-09-17: "Zero serious/critical in the PR subset"). Moderate
 *     and minor findings are recorded in the attachment and do not fail.
 *
 * A bar is only worth having if an app cannot quietly lower it, which is why
 * the tag set and the disable list live HERE rather than in each app's spec.
 */

/**
 * The tag set the blocking bar is asserted against: WCAG 2.1 AA.
 *
 * One level below `WCAG_2_2_AA_TAGS`, deliberately. The ledger may assert the
 * whole 2.2 surface because a ledger is free to carry debt; a gate that fails
 * a PR should fail it against the level the product actually claims, which is
 * the level the accessibility regulations Narduk apps are read against cite.
 *
 * `best-practice` is absent for the reason given on `WCAG_2_2_AA_TAGS`, and
 * that omission does more work here than it looks like. `region`,
 * `landmark-one-main`, `page-has-heading-one` and `heading-order` — the rules
 * that fire most readily on a component-library page, and the ones teams argue
 * with most — are all best-practice-tagged, so they never reach this gate.
 * That is most of why `ESTATE_DISABLED_AXE_RULES` below is empty.
 */
export const WCAG_2_1_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const

/** axe's impact scale, weakest first. The order IS the comparison. */
export const AXE_IMPACT_ORDER = ['minor', 'moderate', 'serious', 'critical'] as const

export type AxeImpact = (typeof AXE_IMPACT_ORDER)[number]

export interface DisabledAxeRule {
  /** The axe rule id, exactly as axe reports it. */
  id: string
  /** Why this rule is NOISE on this stack, rather than a finding being ducked. */
  reason: string
  /** Evidence a reader can check without taking the reason on faith. */
  link: string
}

/**
 * Rules the estate turns off everywhere.
 *
 * IT IS EMPTY, AND THE EMPTY LIST IS THE POSITION, not an unfinished chore.
 * A disabled rule is permanent silence on every route of every app, and it
 * outlives the component that justified it — so the bar for adding one is that
 * the rule is *wrong* on this stack, not that it is inconvenient here. Two
 * things that are NOT grounds:
 *
 *   - "the component library emits it". Then the library is the owning layer
 *     and the fix belongs there; silencing it in the shared test helper hides
 *     the finding from every consumer at once.
 *   - "it is noisy". Noise below the threshold already does not fail anything;
 *     it is recorded in the attachment instead.
 *
 * The usual candidates for a list like this are landmark, heading-order and
 * region rules, and none of them are eligible: they are best-practice-tagged
 * and `WCAG_2_1_AA_TAGS` already excludes them.
 *
 * An entry that does earn its place states the rule, why it is wrong here, and
 * a link — an upstream issue or the rule's own documentation — so a later
 * reader can retire it when upstream fixes it.
 */
export const ESTATE_DISABLED_AXE_RULES: readonly DisabledAxeRule[] = []

/**
 * Whether a violation's impact reaches the failing threshold.
 *
 * FAILS CLOSED on an impact that is missing or that axe has grown since this
 * was written. An unranked violation is the one case where guessing has an
 * asymmetric cost: guessing "blocking" costs someone a conversation, guessing
 * "reportable" ships an unknown violation silently.
 */
export function isImpactAtOrAbove(
  impact: string | null | undefined,
  threshold: AxeImpact,
): boolean {
  if (!impact) return true
  const rank = AXE_IMPACT_ORDER.indexOf(impact as AxeImpact)
  if (rank < 0) return true
  return rank >= AXE_IMPACT_ORDER.indexOf(threshold)
}

/** Split a scan into what fails the build and what is merely recorded. */
export function partitionViolationsByImpact(
  violations: AxeViolation[],
  threshold: AxeImpact,
): { blocking: AxeViolation[]; reported: AxeViolation[] } {
  const blocking: AxeViolation[] = []
  const reported: AxeViolation[] = []
  for (const violation of violations) {
    if (isImpactAtOrAbove(violation.impact, threshold)) blocking.push(violation)
    else reported.push(violation)
  }
  return { blocking, reported }
}

/**
 * One line a person can act on without opening the attachment: what broke,
 * how badly, where, and what to read. Deliberately the first node plus a
 * count rather than every node — the attachment holds the full list, and a
 * failure message long enough to scroll past is a failure message nobody
 * reads.
 */
export function summarizeViolation(violation: AxeViolation): string {
  const impact = violation.impact ?? 'unknown-impact'
  const target = violation.nodes[0]?.target.join(' ') ?? '(no node reported)'
  const more = violation.nodes.length > 1 ? ` (+${violation.nodes.length - 1} more)` : ''
  const help = violation.helpUrl ? ` — ${violation.helpUrl}` : ''
  return `[${impact}] ${violation.id} — ${target}${more}${help}`
}

export interface AccessibilityImpactCount {
  /** Distinct rules that fired at this impact. */
  rules: number
  /** DOM nodes those rules matched, which is the size of the actual repair. */
  nodes: number
}

export interface AccessibilityReport {
  /** What was scanned — a route, usually. */
  key: string
  url?: string
  /** The impact at and above which a violation failed the test. */
  threshold: AxeImpact
  tags: string[]
  disabledRules: DisabledAxeRule[]
  counts: Record<string, AccessibilityImpactCount>
  /** One line per blocking violation, the same lines as the failure message. */
  blocking: string[]
  /** EVERY violation at EVERY impact, unfiltered — this is the inventory. */
  violations: AxeViolation[]
}

/**
 * Count by impact, in rules AND in nodes.
 *
 * Both numbers, because they answer different questions: one `color-contrast`
 * rule over sixty nodes is one line in a summary and a day of work, and a
 * report that only counts rules makes those look identical.
 */
export function countViolationsByImpact(
  violations: AxeViolation[],
): Record<string, AccessibilityImpactCount> {
  const counts: Record<string, AccessibilityImpactCount> = {}
  for (const violation of violations) {
    const impact = violation.impact ?? 'unknown-impact'
    const entry = (counts[impact] ??= { nodes: 0, rules: 0 })
    entry.rules += 1
    entry.nodes += violation.nodes.length
  }
  return counts
}

export interface BuildAccessibilityReportInput {
  key: string
  url?: string
  threshold: AxeImpact
  tags: readonly string[]
  disabledRules: readonly DisabledAxeRule[]
  results: AxeResults
}

/** Assemble the attachment body. Pure, so the shape is testable without a browser. */
export function buildAccessibilityReport(
  input: BuildAccessibilityReportInput,
): AccessibilityReport {
  const { blocking } = partitionViolationsByImpact(input.results.violations, input.threshold)
  return {
    blocking: blocking.map(summarizeViolation),
    counts: countViolationsByImpact(input.results.violations),
    disabledRules: [...input.disabledRules],
    key: input.key,
    tags: [...input.tags],
    threshold: input.threshold,
    url: input.url,
    violations: input.results.violations,
  }
}

export interface EstateAxeScan {
  tags: string[]
  disabledRuleIds: string[]
  include?: string[]
  exclude?: string[]
}

export type AxeRunner = (page: Page, scan: EstateAxeScan) => Promise<AxeResults>

/**
 * The part of `AxeBuilder` this file uses, declared locally.
 *
 * Declared rather than imported because the module contract at the top of this
 * file is that THIS PACKAGE NEVER IMPORTS AXE — `@axe-core/playwright` is an
 * optional peer so that an app using only the baseline helpers is not made to
 * install a scanner it never runs. Importing the real type, even
 * `import type`, would make this package fail to typecheck without the peer
 * present and would put it in the dependency graph of every consumer.
 *
 * The cost is that this shape is a promise about someone else's API. It is a
 * small and long-stable one — these five methods are the whole documented
 * builder surface across axe-core 4.x — and `resolveAxeBuilder` below fails
 * loudly rather than silently if the module stops matching.
 */
interface AxeBuilderLike {
  withTags(tags: string | string[]): AxeBuilderLike
  disableRules(rules: string | string[]): AxeBuilderLike
  include(selector: string | string[]): AxeBuilderLike
  exclude(selector: string | string[]): AxeBuilderLike
  analyze(): Promise<AxeResults>
}

export type AxeBuilderConstructor = new (options: { page: Page }) => AxeBuilderLike

/**
 * Translate an `EstateAxeScan` into builder calls.
 *
 * Separated from the import so the translation can be tested against a stub
 * constructor. It is the only place this package encodes someone else's API,
 * and the mistakes it can make are silent ones: an `include` that replaces
 * instead of appending, or a `disableRules([])` that axe reads as "disable
 * nothing named" versus "disable everything" — both produce a green scan of
 * the wrong thing. `include`/`exclude` are called once per selector because
 * axe treats an ARRAY argument as a frame selector chain rather than as a
 * list of separate roots.
 */
export async function analyzeWithAxeBuilder(
  AxeBuilder: AxeBuilderConstructor,
  page: Page,
  scan: EstateAxeScan,
): Promise<AxeResults> {
  let builder = new AxeBuilder({ page }).withTags(scan.tags)
  if (scan.disabledRuleIds.length > 0) builder = builder.disableRules(scan.disabledRuleIds)
  for (const selector of scan.include ?? []) builder = builder.include(selector)
  for (const selector of scan.exclude ?? []) builder = builder.exclude(selector)
  return await builder.analyze()
}

/**
 * Held in a `string`-typed variable so TypeScript does not resolve it, which
 * is what keeps this package typecheckable without the optional peer.
 */
const AXE_PLAYWRIGHT_SPECIFIER: string = '@axe-core/playwright'

/**
 * Find the constructor in whatever the loader handed back.
 *
 * Three shapes are live at once for this package, and which one you get is a
 * property of the consumer's build rather than of axe: its ESM build exports
 * `{ AxeBuilder, default: AxeBuilder }`; its CommonJS build reassigns
 * `module.exports` to the class itself and hangs the named exports off it, so
 * Node's interop can present the class directly; and a bundler in between can
 * add one more `default` wrapper. Unwrapping until a function appears covers
 * all three without asserting which one is in play.
 */
export function resolveAxeBuilder(loaded: unknown): AxeBuilderConstructor {
  let candidate: unknown = loaded
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as AxeBuilderConstructor
    candidate = (candidate as { default?: unknown } | null | undefined)?.default
  }
  throw new Error(
    `'${AXE_PLAYWRIGHT_SPECIFIER}' loaded but exported no AxeBuilder constructor. ` +
      'Check the installed version against this package’s peer range.',
  )
}

/**
 * The default scan.
 *
 * The import is DYNAMIC for the reason given on `AxeBuilderLike`: a static one
 * would break every consumer that uses only the baseline helpers. An app that
 * calls `expectAccessible` without the optional peer installed gets the
 * sentence below instead of a module-resolution stack trace.
 */
export async function runEstateAxeScan(page: Page, scan: EstateAxeScan): Promise<AxeResults> {
  let AxeBuilder: AxeBuilderConstructor
  try {
    AxeBuilder = resolveAxeBuilder(await import(AXE_PLAYWRIGHT_SPECIFIER))
  } catch (cause) {
    throw new Error(
      `expectAccessible needs the optional peer '${AXE_PLAYWRIGHT_SPECIFIER}', which is ` +
        'not installed or did not load. Add it to the app that runs the scan: ' +
        'pnpm add -D @axe-core/playwright',
      { cause },
    )
  }

  return await analyzeWithAxeBuilder(AxeBuilder, page, scan)
}

export interface ExpectAccessibleOptions {
  /**
   * The lowest impact that FAILS. Defaults to `serious`, which is the estate
   * bar; everything below it is recorded in the attachment and passes.
   */
  severity?: AxeImpact
  /**
   * Extra rules disabled for this call only, on top of
   * `ESTATE_DISABLED_AXE_RULES`. Same evidence requirement: a reason and a
   * link, in the app's own spec where a reviewer of that app can weigh it.
   */
  disableRules?: readonly DisabledAxeRule[]
  /** Limit the scan to these selectors. */
  include?: string[]
  /** Exclude these selectors from the scan. */
  exclude?: string[]
  /** Override the tag set. Reach for this only with a reason worth writing down. */
  tags?: readonly string[]
  /** Names the surface in the report and the failure. Defaults to `page.url()`. */
  key?: string
  /** Where the report is attached. Defaults to the running test. */
  testInfo?: TestInfo
  /** Seam for this package's own tests, and for a caller that must build its own scan. */
  runAxe?: AxeRunner
}

function currentTestInfo(): TestInfo | undefined {
  try {
    return test.info()
  } catch {
    /* Called outside a Playwright test — there is nothing to attach to. */
    return undefined
  }
}

/** Attachment names end up as filenames in the HTML report. */
function attachmentName(key: string): string {
  const slug = key.replaceAll(/[^a-z0-9]+/gi, '-').replaceAll(/^-+|-+$/g, '') || 'page'
  return `accessibility-${slug.toLowerCase()}.json`
}

/**
 * Run the estate rule set against a page and fail on anything at or above the
 * threshold.
 *
 * ```ts
 * await page.goto('/')
 * await expectAccessible(page, { key: '/' })
 * ```
 *
 * WHAT A FAILURE GIVES YOU, and why it is both a message and an attachment.
 * The message carries one line per blocking violation — rule, impact, the
 * first selector, the help URL — because that is what fits in a CI log and is
 * usually enough to start the fix. The attachment carries every violation at
 * every impact as JSON, because the moderate and minor findings that did not
 * fail this run are the inventory the next piece of work is planned from, and
 * a gate that discards them makes the app look cleaner than it is.
 *
 * Returns the report, so a caller can aggregate several routes into an
 * inventory of its own.
 */
export async function expectAccessible(
  page: Page,
  options: ExpectAccessibleOptions = {},
): Promise<AccessibilityReport> {
  const threshold = options.severity ?? 'serious'
  const tags = [...(options.tags ?? WCAG_2_1_AA_TAGS)]
  const disabledRules = [...ESTATE_DISABLED_AXE_RULES, ...(options.disableRules ?? [])]
  const runAxe = options.runAxe ?? runEstateAxeScan

  const results = await runAxe(page, {
    disabledRuleIds: disabledRules.map((rule) => rule.id),
    exclude: options.exclude,
    include: options.include,
    tags,
  })

  const url = page.url()
  const key = options.key ?? url
  const report = buildAccessibilityReport({ disabledRules, key, results, tags, threshold, url })

  const info = options.testInfo ?? currentTestInfo()
  if (info) {
    await info.attach(attachmentName(key), {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    })
  }

  const { reported } = partitionViolationsByImpact(results.violations, threshold)
  const belowThreshold =
    reported.length > 0
      ? `\n\n${reported.length} further violation(s) below ${threshold} did not fail this ` +
        `test and are in the attachment:\n${reported.map(summarizeViolation).join('\n')}`
      : ''

  expect(
    report.blocking,
    `${report.blocking.length} accessibility violation(s) at "${threshold}" or above on ` +
      `"${key}". The estate bar is zero serious/critical on the PR subset, so this is a ` +
      'change to make rather than a number to record — and fix it in the layer that owns ' +
      `the markup, which for a shared component is the library.\n\n` +
      `${report.blocking.join('\n')}${belowThreshold}`,
  ).toEqual([])

  return report
}
