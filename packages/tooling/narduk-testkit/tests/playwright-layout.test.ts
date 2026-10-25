import { describe, expect, it } from 'vitest'

import {
  MAX_NAMED_NODES,
  TOUCH_TARGET_SELECTOR,
  assertAgainstLayoutBaseline,
  collectLayoutFindings,
  measureHorizontalOverflow,
  overflowFindings,
  touchTargetExemption,
  touchTargetFindings,
} from '../src/playwright/layout.js'

import type { Page } from '@playwright/test'
import type { LayoutFinding, TouchTargetCandidate } from '../src/playwright/layout.js'

const target = (overrides: Partial<TouchTargetCandidate> = {}): TouchTargetCandidate => ({
  ariaHidden: false,
  disabled: false,
  display: 'inline-block',
  height: 40,
  selector: 'button.ok',
  siblingTextLength: 0,
  tag: 'button',
  visible: true,
  width: 40,
  ...overrides,
})

describe('overflowFindings', () => {
  it('passes when the document is no wider than the viewport, within 1px', () => {
    expect(overflowFindings({ innerWidth: 320, offenders: [], scrollWidth: 320 })).toEqual([])
    expect(overflowFindings({ innerWidth: 320, offenders: [], scrollWidth: 321 })).toEqual([])
  })

  it('flags overflow and names the offenders', () => {
    const findings = overflowFindings({
      innerWidth: 320,
      offenders: [{ right: 412.4, selector: 'table.orders' }],
      scrollWidth: 412,
    })
    expect(findings).toEqual([
      {
        id: 'horizontal-overflow',
        message: 'page scrolls sideways by 92px at 320px wide',
        nodes: ['table.orders (right edge 412px)'],
      },
    ])
  })

  it('names only a few offenders', () => {
    const offenders = Array.from({ length: 9 }, (_, index) => ({
      right: 400,
      selector: `p${index}`,
    }))
    const [finding] = overflowFindings({ innerWidth: 320, offenders, scrollWidth: 400 })
    expect(finding?.nodes).toHaveLength(MAX_NAMED_NODES)
  })
})

describe('touchTargetExemption', () => {
  it('counts an ordinary visible control', () => {
    expect(touchTargetExemption(target())).toBeNull()
  })

  it.each([
    ['hidden', { visible: false }],
    ['zero-size', { height: 0, width: 0 }],
    ['zero-size', { height: 1, width: 1 }],
    ['aria-hidden', { ariaHidden: true }],
    ['disabled', { disabled: true }],
    ['inline-link', { display: 'inline', siblingTextLength: 12, tag: 'a' }],
  ] as const)('exempts %s', (reason, overrides) => {
    expect(touchTargetExemption(target(overrides))).toBe(reason)
  })

  it('does not exempt a block link, a lone inline link, or an inline button', () => {
    expect(
      touchTargetExemption(target({ display: 'block', siblingTextLength: 12, tag: 'a' })),
    ).toBeNull()
    expect(
      touchTargetExemption(target({ display: 'inline', siblingTextLength: 0, tag: 'a' })),
    ).toBeNull()
    expect(
      touchTargetExemption(target({ display: 'inline', siblingTextLength: 12, tag: 'button' })),
    ).toBeNull()
  })
})

describe('touchTargetFindings', () => {
  it('flags targets under the bar in either dimension', () => {
    const findings = touchTargetFindings(
      [
        target({ height: 20, selector: 'a.x' }),
        target({ width: 16, selector: 'button.y' }),
        target(),
      ],
      24,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'touch-target-24',
      message: '2 touch target(s) smaller than 24x24 CSS px',
      nodes: ['a.x (40x20)', 'button.y (16x40)'],
    })
  })

  it('uses a different id and bar at 44', () => {
    const candidates = [target({ height: 30, width: 30 })]
    expect(touchTargetFindings(candidates, 24)).toEqual([])
    expect(touchTargetFindings(candidates, 44)[0]?.id).toBe('touch-target-44')
  })

  it('tolerates sub-pixel rounding but not a real shortfall', () => {
    expect(touchTargetFindings([target({ height: 23.7, width: 24 })], 24)).toEqual([])
    expect(touchTargetFindings([target({ height: 23.2, width: 24 })], 24)).toHaveLength(1)
  })

  it('ignores exempt candidates however small', () => {
    expect(touchTargetFindings([target({ disabled: true, height: 10, width: 10 })], 24)).toEqual([])
  })

  it('names only a few targets', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      target({ height: 10, selector: `a${index}` }),
    )
    expect(touchTargetFindings(many, 24)[0]?.nodes).toHaveLength(MAX_NAMED_NODES)
  })
})

describe('the touch target selector', () => {
  it('covers links, buttons, form controls, ARIA widgets and focusable custom elements', () => {
    for (const part of [
      'a[href]',
      'button',
      'select',
      'textarea',
      '[role=button]',
      '[role=link]',
    ]) {
      expect(TOUCH_TARGET_SELECTOR).toContain(part)
    }
    expect(TOUCH_TARGET_SELECTOR).toContain('input:not([type=hidden])')
    expect(TOUCH_TARGET_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})

/** A page whose evaluate returns queued results, recording viewport changes. */
function stubPage(
  results: unknown[],
  viewport: { width: number; height: number } | null = { height: 800, width: 1280 },
) {
  const viewports: Array<{ width: number; height: number }> = []
  const queue = [...results]
  const page = {
    evaluate: () => {
      const next = queue.shift()
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve(next)
    },
    setViewportSize: (size: { width: number; height: number }) => {
      viewports.push(size)
      return Promise.resolve()
    },
    viewportSize: () => viewport,
  }
  return { page: page as unknown as Page, viewports }
}

describe('measureHorizontalOverflow', () => {
  it('measures at 320px by default and restores the viewport', async () => {
    const measurement = { innerWidth: 320, offenders: [], scrollWidth: 320 }
    const { page, viewports } = stubPage([undefined, measurement])
    expect(await measureHorizontalOverflow(page)).toEqual(measurement)
    expect(viewports).toEqual([
      { height: 800, width: 320 },
      { height: 800, width: 1280 },
    ])
  })

  it('restores the viewport when the measurement throws', async () => {
    const { page, viewports } = stubPage([undefined, new Error('page closed')])
    await expect(measureHorizontalOverflow(page, 375)).rejects.toThrow('page closed')
    expect(viewports.at(0)).toEqual({ height: 800, width: 375 })
    expect(viewports.at(-1)).toEqual({ height: 800, width: 1280 })
  })

  it('falls back to the window size when the page has no fixed viewport', async () => {
    const { page, viewports } = stubPage(
      [
        { height: 700, width: 1000 },
        undefined,
        { innerWidth: 320, offenders: [], scrollWidth: 320 },
      ],
      null,
    )
    await measureHorizontalOverflow(page)
    expect(viewports.at(-1)).toEqual({ height: 700, width: 1000 })
  })
})

describe('collectLayoutFindings', () => {
  const overflowing = { innerWidth: 320, offenders: [], scrollWidth: 500 }
  const small = target({ height: 10, width: 10 })

  it('combines both checks, one finding per bar', async () => {
    const { page } = stubPage([undefined, overflowing, [small]])
    const findings = await collectLayoutFindings(page, { touchTargetSizes: [24, 44] })
    expect(findings.map((finding) => finding.id)).toEqual([
      'horizontal-overflow',
      'touch-target-24',
      'touch-target-44',
    ])
  })

  it('skips either check on request, touching neither viewport nor DOM for the skipped one', async () => {
    const { page, viewports } = stubPage([[small]])
    const findings = await collectLayoutFindings(page, { overflowWidth: false })
    expect(findings.map((finding) => finding.id)).toEqual(['touch-target-24'])
    expect(viewports).toEqual([])

    const only = stubPage([undefined, overflowing])
    expect(
      (await collectLayoutFindings(only.page, { touchTargetSizes: [] })).map(
        (finding) => finding.id,
      ),
    ).toEqual(['horizontal-overflow'])
  })
})

describe('assertAgainstLayoutBaseline', () => {
  const info = (title: string) =>
    ({ title }) as unknown as Parameters<typeof assertAgainstLayoutBaseline>[0]
  const finding = (id: LayoutFinding['id']): LayoutFinding => ({ id, message: id, nodes: ['a.x'] })

  it('passes when findings match the ledger exactly, and when both are empty', () => {
    expect(() =>
      assertAgainstLayoutBaseline(info('/'), [finding('touch-target-24')], {
        '/': ['touch-target-24'],
      }),
    ).not.toThrow()
    expect(() => assertAgainstLayoutBaseline(info('/'), [], {})).not.toThrow()
  })

  it('fails on a new finding and names it', () => {
    expect(() =>
      assertAgainstLayoutBaseline(info('/'), [finding('horizontal-overflow')], { '/': [] }),
    ).toThrow(/NEW layout finding on "\/"/u)
  })

  it('fails on a baselined check that no longer fires, naming the ledger', () => {
    expect(() =>
      assertAgainstLayoutBaseline(
        info('/'),
        [],
        { '/': ['touch-target-44'] },
        {
          baselinePath: 'tests/layout-baseline.json',
        },
      ),
    ).toThrow(/no longer fails touch-target-44 — remove it from tests\/layout-baseline\.json/u)
  })

  it('keys by title unless told otherwise, and de-duplicates repeated ids', () => {
    const duplicated = [finding('touch-target-24'), finding('touch-target-24')]
    expect(() =>
      assertAgainstLayoutBaseline(info('Home'), duplicated, { Home: ['touch-target-24'] }),
    ).not.toThrow()
    expect(() =>
      assertAgainstLayoutBaseline(
        info('Home'),
        duplicated,
        { '/orders': ['touch-target-24'] },
        {
          key: '/orders',
        },
      ),
    ).not.toThrow()
  })
})
