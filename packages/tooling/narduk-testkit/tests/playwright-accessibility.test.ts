import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AXE_IMPACT_ORDER,
  ESTATE_DISABLED_AXE_RULES,
  WCAG_2_1_AA_TAGS,
  WCAG_2_2_AA_TAGS,
  analyzeWithAxeBuilder,
  assertAgainstAccessibilityBaseline,
  countViolationsByImpact,
  describeViolations,
  expectAccessible,
  isImpactAtOrAbove,
  partitionViolationsByImpact,
  resolveAxeBuilder,
  runEstateAxeScan,
  summarizeViolation,
  textScalingVerdict,
} from '../src/playwright/accessibility.js'

import type { AccessibilityReport, EstateAxeScan } from '../src/playwright/accessibility.js'
import type { AxeResults, AxeViolationLike } from './accessibility-types.js'

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

  it('requires very nearly the full requested scaling by default', () => {
    // 0.9 tolerance on a 200% request => 1.9x floor. A page that scales fully
    // sits at 2.0x and clears it with room for sub-pixel rounding.
    const verdict = textScalingVerdict(16, 30.4, 200)
    expect(verdict.ok).toBe(true)
    expect(verdict.required).toBeCloseTo(1.9)
  })

  it('rejects PARTIAL scaling, not merely absent scaling', () => {
    // A clamp() ceiling that damps 200% down to 1.6x is itself a 1.4.4
    // finding. The default surfaces it rather than absorbing it.
    const verdict = textScalingVerdict(16, 26, 200)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/1\.63x against a required 1\.90x/)
  })

  it('lets a consumer with a real ceiling loosen the floor explicitly', () => {
    // Explicit, so the deviation is visible in that app's own test file.
    expect(textScalingVerdict(16, 26, 200, 0.5).ok).toBe(true)
  })

  it('scales its requirement with the requested percentage', () => {
    // 150% at the default tolerance requires 1.45x, not 1.9x.
    expect(textScalingVerdict(16, 24, 150).ok).toBe(true)
    expect(textScalingVerdict(16, 20, 150).ok).toBe(false)
  })

  it('refuses a probe that measured nothing rather than dividing by zero', () => {
    expect(textScalingVerdict(0, 32, 200).ok).toBe(false)
    expect(textScalingVerdict(16, Number.NaN, 200).ok).toBe(false)
    expect(textScalingVerdict(16, Number.NaN, 200).reason).toMatch(/zero or not a number/)
  })
})

/* ------------------------------------------------------------------------ */
/* The estate bar                                                            */
/* ------------------------------------------------------------------------ */

/** Just enough Page for the helper: it reads the URL and hands the rest to axe. */
const fakePage = (url = 'https://example.test/map') =>
  ({ url: () => url }) as unknown as Parameters<typeof expectAccessible>[0]

interface RecordedAttachment {
  name: string
  contentType?: string
  body?: string
}

/** A TestInfo that records attachments instead of writing a report. */
const fakeTestInfo = () => {
  const attachments: RecordedAttachment[] = []
  const info = {
    attach: (name: string, options: { body?: Buffer | string; contentType?: string }) => {
      attachments.push({
        body: typeof options.body === 'string' ? options.body : options.body?.toString('utf8'),
        contentType: options.contentType,
        name,
      })
      return Promise.resolve()
    },
    title: 'a fake test',
  } as unknown as NonNullable<Parameters<typeof expectAccessible>[1]>['testInfo']
  return { attachments, info }
}

const violation = (
  id: string,
  impact: string | null,
  nodes: string[],
  helpUrl?: string,
): AxeViolationLike => ({
  help: `${id} help`,
  helpUrl,
  id,
  impact,
  nodes: nodes.map((target) => ({ target: [target] })),
})

/** A runner that returns a canned scan and records what it was asked to run. */
const fakeAxe = (...violations: AxeViolationLike[]) => {
  const scans: EstateAxeScan[] = []
  const runAxe = (_page: unknown, scan: EstateAxeScan) => {
    scans.push(scan)
    return Promise.resolve({ violations } as AxeResults)
  }
  return { runAxe: runAxe as NonNullable<Parameters<typeof expectAccessible>[1]>['runAxe'], scans }
}

describe('the WCAG 2.1 AA tag set', () => {
  it('is the level the blocking bar asserts, without best-practice', () => {
    expect([...WCAG_2_1_AA_TAGS]).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    expect([...WCAG_2_1_AA_TAGS]).not.toContain('best-practice')
  })

  it('excludes the rules a disable list would otherwise be written for', () => {
    /*
     * region, landmark-one-main, page-has-heading-one and heading-order are
     * best-practice-tagged, so they never reach the gate. This is the reason
     * ESTATE_DISABLED_AXE_RULES is empty, and if the tag set ever grows
     * best-practice that reason evaporates silently — hence the assertion
     * above, and this note beside it.
     */
    expect([...WCAG_2_1_AA_TAGS].every((tag) => tag.startsWith('wcag'))).toBe(true)
  })
})

describe('the estate disable list', () => {
  it('is empty, because a shared silence is not how a real finding gets fixed', () => {
    expect(ESTATE_DISABLED_AXE_RULES).toEqual([])
  })

  it('requires a reason and a link from any entry that is ever added', () => {
    for (const rule of ESTATE_DISABLED_AXE_RULES) {
      expect(rule.reason.length, `${rule.id} needs a reason`).toBeGreaterThan(20)
      expect(rule.link, `${rule.id} needs checkable evidence`).toMatch(/^https?:\/\//)
    }
  })
})

describe('impact ranking', () => {
  it('ranks axe impacts weakest first', () => {
    expect([...AXE_IMPACT_ORDER]).toEqual(['minor', 'moderate', 'serious', 'critical'])
  })

  it('blocks at and above the threshold and lets everything below through', () => {
    expect(isImpactAtOrAbove('critical', 'serious')).toBe(true)
    expect(isImpactAtOrAbove('serious', 'serious')).toBe(true)
    expect(isImpactAtOrAbove('moderate', 'serious')).toBe(false)
    expect(isImpactAtOrAbove('minor', 'serious')).toBe(false)
    expect(isImpactAtOrAbove('minor', 'minor')).toBe(true)
  })

  it('fails CLOSED on an absent or unrecognised impact', () => {
    /*
     * The asymmetry is the whole argument: calling an unranked violation
     * blocking costs a conversation, calling it reportable ships an unknown
     * violation silently.
     */
    expect(isImpactAtOrAbove(null, 'serious')).toBe(true)
    expect(isImpactAtOrAbove(undefined, 'serious')).toBe(true)
    expect(isImpactAtOrAbove('', 'serious')).toBe(true)
    expect(isImpactAtOrAbove('catastrophic', 'serious')).toBe(true)
  })
})

describe('partitionViolationsByImpact', () => {
  it('splits a scan into what fails and what is only recorded', () => {
    const { blocking, reported } = partitionViolationsByImpact(
      [
        violation('color-contrast', 'serious', ['.a']),
        violation('aria-required-attr', 'critical', ['.b']),
        violation('landmark-unique', 'moderate', ['.c']),
        violation('empty-heading', 'minor', ['.d']),
      ],
      'serious',
    )
    expect(blocking.map((v) => v.id)).toEqual(['color-contrast', 'aria-required-attr'])
    expect(reported.map((v) => v.id)).toEqual(['landmark-unique', 'empty-heading'])
  })
})

describe('summarizeViolation', () => {
  it('names the rule, the impact, the first selector and the help URL', () => {
    const line = summarizeViolation(
      violation('color-contrast', 'serious', ['.card > .muted'], 'https://deque.test/cc'),
    )
    expect(line).toBe('[serious] color-contrast — .card > .muted — https://deque.test/cc')
  })

  it('counts the remaining nodes rather than listing them', () => {
    expect(summarizeViolation(violation('link-name', 'serious', ['.a', '.b', '.c']))).toBe(
      '[serious] link-name — .a (+2 more)',
    )
  })

  it('says so when axe reported no impact rather than inventing one', () => {
    expect(summarizeViolation(violation('odd-rule', null, ['.a']))).toContain('[unknown-impact]')
  })
})

describe('countViolationsByImpact', () => {
  it('counts rules AND nodes, because one rule over sixty nodes is a day of work', () => {
    expect(
      countViolationsByImpact([
        violation('color-contrast', 'serious', ['.a', '.b', '.c']),
        violation('link-name', 'serious', ['.d']),
        violation('empty-heading', 'minor', ['.e', '.f']),
      ]),
    ).toEqual({
      minor: { nodes: 2, rules: 1 },
      serious: { nodes: 4, rules: 2 },
    })
  })
})

describe('resolveAxeBuilder', () => {
  const builder = function AxeBuilder() {} as unknown

  it('accepts the ESM namespace shape', () => {
    expect(resolveAxeBuilder({ AxeBuilder: builder, default: builder })).toBe(builder)
  })

  it('accepts the CommonJS shape, where the class IS module.exports', () => {
    expect(resolveAxeBuilder(builder)).toBe(builder)
  })

  it('accepts one more default wrapper from a bundler in between', () => {
    expect(resolveAxeBuilder({ default: { default: builder } })).toBe(builder)
  })

  it('fails loudly rather than returning something that is not a constructor', () => {
    expect(() => resolveAxeBuilder({ notTheBuilder: 1 })).toThrow(/exported no AxeBuilder/)
    expect(() => resolveAxeBuilder(undefined)).toThrow(/exported no AxeBuilder/)
  })
})

describe('runEstateAxeScan', () => {
  it('asks for the optional peer by name when it is not installed', async () => {
    /*
     * This package deliberately does not depend on @axe-core/playwright, so
     * this assertion doubles as the proof of that: the day it acquires the
     * dependency, this test goes red and someone has to decide that on
     * purpose.
     */
    await expect(
      runEstateAxeScan(fakePage(), { disabledRuleIds: [], tags: [...WCAG_2_1_AA_TAGS] }),
    ).rejects.toThrow(/@axe-core\/playwright/)
  })
})

describe('expectAccessible', () => {
  it('passes a page whose only findings are below the bar', async () => {
    const axe = fakeAxe(violation('landmark-unique', 'moderate', ['.a']))
    const { attachments, info } = fakeTestInfo()
    const report = await expectAccessible(fakePage(), { runAxe: axe.runAxe, testInfo: info })
    expect(report.blocking).toEqual([])
    expect(attachments).toHaveLength(1)
  })

  it('fails on a serious violation and says which one, where, and what to read', async () => {
    const axe = fakeAxe(violation('color-contrast', 'serious', ['.badge'], 'https://deque.test/cc'))
    const { info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), { key: '/map', runAxe: axe.runAxe, testInfo: info }),
    ).rejects.toThrow(/\[serious\] color-contrast — \.badge — https:\/\/deque\.test\/cc/)
  })

  it('names the route and the bar in the failure', async () => {
    const axe = fakeAxe(violation('aria-required-attr', 'critical', ['.x']))
    const { info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), { key: '/map', runAxe: axe.runAxe, testInfo: info }),
    ).rejects.toThrow(/"\/map"[\s\S]*zero serious\/critical/)
  })

  it('attaches the report even when it fails — the evidence outlives the assertion', async () => {
    const axe = fakeAxe(
      violation('color-contrast', 'serious', ['.a']),
      violation('empty-heading', 'minor', ['.b']),
    )
    const { attachments, info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), { key: '/', runAxe: axe.runAxe, testInfo: info }),
    ).rejects.toThrow()

    expect(attachments).toHaveLength(1)
    const attached = attachments[0]!
    expect(attached.contentType).toBe('application/json')
    /* "/" slugifies to nothing, so the name falls back rather than ending up bare. */
    expect(attached.name).toBe('accessibility-page.json')
    const report = JSON.parse(attached.body ?? '{}') as AccessibilityReport
    expect(report.violations.map((v) => v.id)).toEqual(['color-contrast', 'empty-heading'])
    expect(report.counts).toEqual({
      minor: { nodes: 1, rules: 1 },
      serious: { nodes: 1, rules: 1 },
    })
  })

  it('keeps sub-threshold findings in the attachment, not just in the count', async () => {
    const axe = fakeAxe(violation('empty-heading', 'minor', ['.b']))
    const { attachments, info } = fakeTestInfo()
    await expectAccessible(fakePage(), { key: '/', runAxe: axe.runAxe, testInfo: info })
    const report = JSON.parse(attachments[0]?.body ?? '{}') as AccessibilityReport
    expect(report.violations.map((v) => v.id)).toEqual(['empty-heading'])
    expect(report.blocking).toEqual([])
  })

  it('mentions the findings it did NOT fail on, so they are not invisible', async () => {
    const axe = fakeAxe(
      violation('color-contrast', 'serious', ['.a']),
      violation('empty-heading', 'minor', ['.b']),
    )
    const { info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), { runAxe: axe.runAxe, testInfo: info }),
    ).rejects.toThrow(/1 further violation\(s\) below serious[\s\S]*empty-heading/)
  })

  it('runs the estate tag set and the estate disable list by default', async () => {
    const axe = fakeAxe()
    const { info } = fakeTestInfo()
    await expectAccessible(fakePage(), { runAxe: axe.runAxe, testInfo: info })
    expect(axe.scans[0]).toEqual({
      disabledRuleIds: ESTATE_DISABLED_AXE_RULES.map((rule) => rule.id),
      exclude: undefined,
      include: undefined,
      tags: [...WCAG_2_1_AA_TAGS],
    })
  })

  it('adds a caller’s disabled rules to the estate list rather than replacing it', async () => {
    const axe = fakeAxe()
    const { info } = fakeTestInfo()
    const report = await expectAccessible(fakePage(), {
      disableRules: [{ id: 'color-contrast', link: 'https://example.test/i/1', reason: 'why' }],
      runAxe: axe.runAxe,
      testInfo: info,
    })
    expect(axe.scans[0]?.disabledRuleIds).toEqual([
      ...ESTATE_DISABLED_AXE_RULES.map((rule) => rule.id),
      'color-contrast',
    ])
    /* The report records what was silenced, so a green run still shows it. */
    expect(report.disabledRules.map((rule) => rule.id)).toEqual([
      ...ESTATE_DISABLED_AXE_RULES.map((rule) => rule.id),
      'color-contrast',
    ])
  })

  it('lowers the bar only when asked, and then reports against the lower one', async () => {
    const axe = fakeAxe(violation('landmark-unique', 'moderate', ['.a']))
    const { info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), {
        runAxe: axe.runAxe,
        severity: 'moderate',
        testInfo: info,
      }),
    ).rejects.toThrow(/\[moderate\] landmark-unique/)
  })

  it('fails on a violation axe gave no impact, at the default bar', async () => {
    const axe = fakeAxe(violation('odd-rule', null, ['.a']))
    const { info } = fakeTestInfo()
    await expect(
      expectAccessible(fakePage(), { runAxe: axe.runAxe, testInfo: info }),
    ).rejects.toThrow(/\[unknown-impact\] odd-rule/)
  })

  it('keys off the page URL when the caller does not name the surface', async () => {
    const axe = fakeAxe()
    const { attachments, info } = fakeTestInfo()
    const report = await expectAccessible(fakePage('https://example.test/fleet'), {
      runAxe: axe.runAxe,
      testInfo: info,
    })
    expect(report.key).toBe('https://example.test/fleet')
    expect(report.url).toBe('https://example.test/fleet')
    expect(attachments[0]?.name).toBe('accessibility-https-example-test-fleet.json')
  })

  it('still asserts when there is no test to attach to', async () => {
    /*
     * A helper that only works inside a Playwright worker cannot be used from
     * a script that sweeps routes to build an inventory, which is the first
     * thing anyone adopting this wants to do.
     */
    const axe = fakeAxe(violation('color-contrast', 'serious', ['.a']))
    await expect(expectAccessible(fakePage(), { runAxe: axe.runAxe })).rejects.toThrow(
      /color-contrast/,
    )
  })

  it('forwards include and exclude to the scan', async () => {
    const axe = fakeAxe()
    const { info } = fakeTestInfo()
    await expectAccessible(fakePage(), {
      exclude: ['.third-party-widget'],
      include: ['main'],
      runAxe: axe.runAxe,
      testInfo: info,
    })
    expect(axe.scans[0]?.include).toEqual(['main'])
    expect(axe.scans[0]?.exclude).toEqual(['.third-party-widget'])
  })
})

describe('analyzeWithAxeBuilder', () => {
  /** A stand-in for AxeBuilder that records the calls rather than running axe. */
  const stubBuilder = () => {
    const calls: Array<[string, unknown]> = []
    class StubAxeBuilder {
      constructor(public options: { page: unknown }) {
        calls.push(['constructor', options])
      }
      withTags(tags: string | string[]) {
        calls.push(['withTags', tags])
        return this
      }
      disableRules(rules: string | string[]) {
        calls.push(['disableRules', rules])
        return this
      }
      include(selector: string | string[]) {
        calls.push(['include', selector])
        return this
      }
      exclude(selector: string | string[]) {
        calls.push(['exclude', selector])
        return this
      }
      analyze() {
        calls.push(['analyze', undefined])
        return Promise.resolve({ violations: [] } as AxeResults)
      }
    }
    return {
      calls,
      constructor: StubAxeBuilder as unknown as Parameters<typeof analyzeWithAxeBuilder>[0],
    }
  }

  it('hands the page to the builder and asks for the estate tags', async () => {
    const stub = stubBuilder()
    const page = fakePage()
    await analyzeWithAxeBuilder(stub.constructor, page, {
      disabledRuleIds: [],
      tags: [...WCAG_2_1_AA_TAGS],
    })
    expect(stub.calls).toEqual([
      ['constructor', { page }],
      ['withTags', [...WCAG_2_1_AA_TAGS]],
      ['analyze', undefined],
    ])
  })

  it('does NOT call disableRules with an empty list', async () => {
    /*
     * The reason this function exists separately. `disableRules([])` is an
     * instruction to axe rather than a no-op, and a version that read it as
     * "disable everything" would produce a permanently green scan that looks
     * exactly like a clean page.
     */
    const stub = stubBuilder()
    await analyzeWithAxeBuilder(stub.constructor, fakePage(), {
      disabledRuleIds: [],
      tags: ['wcag2a'],
    })
    expect(stub.calls.map(([name]) => name)).not.toContain('disableRules')
  })

  it('passes disabled rules through as one list', async () => {
    const stub = stubBuilder()
    await analyzeWithAxeBuilder(stub.constructor, fakePage(), {
      disabledRuleIds: ['color-contrast', 'link-name'],
      tags: ['wcag2a'],
    })
    expect(stub.calls).toContainEqual(['disableRules', ['color-contrast', 'link-name']])
  })

  it('calls include and exclude once per selector', async () => {
    /*
     * axe reads an ARRAY argument as a frame selector chain, not as a list of
     * separate roots, so passing the list wholesale would scan the wrong thing
     * and still come back green.
     */
    const stub = stubBuilder()
    await analyzeWithAxeBuilder(stub.constructor, fakePage(), {
      disabledRuleIds: [],
      exclude: ['.widget'],
      include: ['main', '#footer'],
      tags: ['wcag2a'],
    })
    expect(stub.calls).toContainEqual(['include', 'main'])
    expect(stub.calls).toContainEqual(['include', '#footer'])
    expect(stub.calls).toContainEqual(['exclude', '.widget'])
  })
})
