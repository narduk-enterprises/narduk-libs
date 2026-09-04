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
  NardukBrandBackdrop,
} from './index'

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

const cases: [string, Component, Record<string, unknown>][] = [
  ['NardukLineChart', NardukLineChart, { series, labels, chartTitle: 'Line under SSR' }],
  ['NardukBarChart', NardukBarChart, { series, labels, chartTitle: 'Bar under SSR' }],
  ['NardukPieChart', NardukPieChart, {
    data: [{ label: 'A', value: 3 }, { label: 'B', value: 7 }],
    chartTitle: 'Pie under SSR',
  }],
  ['NardukScatterChart', NardukScatterChart, {
    series: [{ name: 'S', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
    chartTitle: 'Scatter under SSR',
  }],
  ['NardukHistogramChart', NardukHistogramChart, {
    values: [1, 2, 2, 3, 5, 8],
    chartTitle: 'Histogram under SSR',
  }],
  ['NardukCandleChart', NardukCandleChart, {
    bars: [
      { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5 },
      { t: 1_700_003_600_000, o: 1.5, h: 2.5, l: 1.2, c: 2 },
    ],
    chartTitle: 'Candle under SSR',
  }],
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
