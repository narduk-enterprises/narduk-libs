/*
 * Server-render proof — narduk-charts#31.
 *
 * Every other suite in this repository mounts through `@vue/test-utils` under
 * happy-dom, or drives a real browser in `e2e/`. Both give the components a
 * DOM. Consumers on Nuxt/Nitro do not: the first render of every chart happens
 * on a server — for the Cloudflare Workers preset, a runtime with no `window`
 * and no `document` at all — and a component that reaches for either at setup
 * time throws there while every existing test stays green.
 *
 * This file therefore runs in the `node` environment (vitest.config.ts's
 * default; the component suites opt INTO happy-dom with a file directive, and
 * this one deliberately does not) and renders through `@vue/server-renderer`.
 * `expect(...).resolves` is not enough on its own — a component can render an
 * empty string without throwing — so each case also asserts that real markup
 * came back.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, type Component } from 'vue'

import {
  NardukLineChart,
  NardukBarChart,
  NardukPieChart,
  NardukScatterChart,
  NardukHistogramChart,
  NardukCandleChart,
  NardukChartStack,
  NardukBrandBackdrop,
} from './index'
import { defaultTimeAxisLabel } from './utils/xAxis'

/** The globals a Workers-style server runtime does not have. */
it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(component: Component, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component, props))
}

const labels = ['Mon', 'Tue', 'Wed', 'Thu']
const series = [{ name: 'Revenue', data: [30, 40, 35, 50] }]

const cases: Array<[string, Component, Record<string, unknown>]> = [
  ['NardukLineChart', NardukLineChart, { series, labels, chartTitle: 'Line under SSR' }],
  ['NardukBarChart', NardukBarChart, { series, labels, chartTitle: 'Bar under SSR' }],
  [
    'NardukPieChart',
    NardukPieChart,
    {
      data: [
        { label: 'A', value: 3 },
        { label: 'B', value: 7 },
      ],
      chartTitle: 'Pie under SSR',
    },
  ],
  [
    'NardukScatterChart',
    NardukScatterChart,
    {
      series: [
        {
          name: 'S',
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ],
      chartTitle: 'Scatter under SSR',
    },
  ],
  [
    'NardukHistogramChart',
    NardukHistogramChart,
    {
      values: [1, 2, 2, 3, 5, 8],
      chartTitle: 'Histogram under SSR',
    },
  ],
  [
    'NardukCandleChart',
    NardukCandleChart,
    {
      bars: [
        { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5 },
        { t: 1_700_003_600_000, o: 1.5, h: 2.5, l: 1.2, c: 2 },
      ],
      chartTitle: 'Candle under SSR',
    },
  ],
  ['NardukBrandBackdrop', NardukBrandBackdrop, {}],
]

describe('server rendering without a DOM', () => {
  for (const [name, component, props] of cases) {
    it(`${name} renders markup instead of throwing`, async () => {
      const html = await render(component, props)
      expect(html).toContain('<svg')
    })
  }

  it('carries the accessible name into the server output, not only after hydration', async () => {
    // A chart whose <title> only appears client-side is unlabelled for anything
    // reading the server response — crawlers, previews, no-JS clients.
    const html = await render(NardukLineChart, {
      series,
      labels,
      chartTitle: 'Weekly revenue',
      chartDescription: 'Four days of revenue.',
    })
    expect(html).toContain('Weekly revenue')
    expect(html).toContain('<desc')
    expect(html).toContain('Four days of revenue.')
  })

  it('server-renders the sparkline configuration the axis props exist for', async () => {
    const html = await render(NardukLineChart, {
      series: [{ name: 'users', data: [5, null, 7, null, 9] }],
      labels: ['1', '2', '3', '4', '5'],
      showXAxis: false,
      showYAxis: false,
      showGrid: false,
      chrome: false,
      focusable: false,
      yMin: 0,
      yMax: 20,
      pointRadius: 1.5,
    })

    expect(html).toContain('<svg')
    expect(html).not.toContain('narduk-axis')
    // The isolated-value markers must be in the SERVER output too: they are
    // the only thing that renders for this series, so if they were
    // client-only the first paint would be a blank plot.
    expect(html).toContain('narduk-line-point--isolated')
  })

  it('does not touch a DOM global merely by importing the package', async () => {
    // The import at the top of this file already proves module scope is clean;
    // this asserts the same for a second render, after any lazy init.
    await expect(render(NardukLineChart, { series, labels })).resolves.toContain('<svg')
  })
})

describe('NardukChartStack under SSR', () => {
  // NardukChartStack has no chart of its own — it is a slot-forwarding layout
  // wrapper (`defineModel`, a `<div>`, and a scoped `<slot>`). It is exercised
  // here rather than added to `cases` above because proving it renders under
  // SSR means proving the *slotted* content — including the `v-model:domain`
  // scope handed to it — reaches the server output too, not just the wrapper.
  it('renders the wrapper and forwards v-model:domain into a slotted chart, with no DOM', async () => {
    const html = await renderToString(
      createSSRApp({
        components: { NardukChartStack, NardukCandleChart },
        template: `
          <NardukChartStack v-model:domain="domain">
            <template #default="{ domain: d }">
              <NardukCandleChart :bars="bars" :domain="d" chart-title="Stacked under SSR" />
            </template>
          </NardukChartStack>
        `,
        data() {
          return {
            domain: null as null | { start: number; end: number },
            bars: [
              { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5 },
              { t: 1_700_003_600_000, o: 1.5, h: 2.5, l: 1.2, c: 2 },
            ],
          }
        },
      }),
    )

    expect(html).toContain('narduk-chart-stack')
    expect(html).toContain('<svg')
    expect(html).toContain('Stacked under SSR')
  })
})

describe('time-axis labels are host-timezone stable under SSR', () => {
  /**
   * 02:00 UTC on 15 May is still 14 May in America/Chicago. An unpinned
   * `toLocaleString` therefore emits different label text (and can emit a
   * different tick set) on workerd vs the browser. Bars are built with
   * `Date.UTC` so construction itself cannot leak `TZ`.
   */
  const t0 = Date.UTC(2026, 4, 15, 2, 0)
  const t1 = Date.UTC(2026, 4, 15, 8, 0)
  const bars = [
    { t: t0, o: 1, h: 2, l: 0.5, c: 1.5 },
    { t: t1, o: 1.5, h: 2.5, l: 1.2, c: 2 },
  ]
  const times = [t0, t1]
  const labels = ['a', 'b']
  const series = [{ name: 'Wind', data: [4, 6] }]

  async function renderUnderTz(
    tz: string,
    component: Component,
    props: Record<string, unknown>,
  ): Promise<string> {
    const previous = process.env.TZ
    process.env.TZ = tz
    try {
      return await render(component, props)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  }

  function axisLabels(html: string): string[] {
    return [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map(match => match[1]!.trim())
      .filter(text => /May \d/.test(text))
  }

  it('NardukCandleChart emits the same labels and markup under TZ=UTC and TZ=America/Chicago', async () => {
    const props = { bars, animate: false, chartTitle: 'Candle TZ' }
    const utc = await renderUnderTz('UTC', NardukCandleChart, props)
    const chicago = await renderUnderTz('America/Chicago', NardukCandleChart, props)
    expect(utc).toBe(chicago)
    expect(axisLabels(utc)).toEqual(axisLabels(chicago))
    expect(utc).toContain(defaultTimeAxisLabel(t0))
    expect(utc).not.toMatch(/May 14/)
  })

  it('NardukLineChart time axis emits the same labels and markup under both host zones', async () => {
    const props = {
      series,
      labels,
      times,
      xAxisType: 'time',
      animate: false,
      chartTitle: 'Line TZ',
    }
    const utc = await renderUnderTz('UTC', NardukLineChart, props)
    const chicago = await renderUnderTz('America/Chicago', NardukLineChart, props)
    expect(utc).toBe(chicago)
    expect(axisLabels(utc)).toEqual(axisLabels(chicago))
    expect(utc).toContain(defaultTimeAxisLabel(t0))
    expect(utc).not.toMatch(/May 14/)
  })
})
