// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NardukLineChart from './NardukLineChart.vue'

/*
 * The studio look must never repaint a classic consumer. These snapshots were
 * generated on the commit before `look` existed; a diff here means the default
 * output changed.
 */
const labels = Array.from({ length: 12 }, (_, i) => `W${i + 1}`)
const wave = (k: number) => labels.map((_, i) => Math.round(4 + Math.sin(i / 2 + k) * 3 + k))

function render(extra: Record<string, unknown> = {}) {
  const html = mount(NardukLineChart, {
    props: {
      series: [
        { name: 'This season', data: wave(0) },
        { name: 'Last season', data: wave(1), dashed: true },
        { name: 'Sparse', data: wave(2).map((v, i) => (i % 4 === 3 ? null : v)) },
      ],
      labels,
      width: 560,
      height: 300,
      animate: false,
      dark: false,
      ...extra,
    },
  }).html()
  /* Comments (`<!--v-if-->` placeholders) are not output: the studio branches add some. */
  // Repeat until stable, so a comment split by another never survives one pass.
  let out = html
  let prev
  do {
    prev = out
    out = out.replace(/[ \t]*<!--[\s\S]*?-->\n?/g, '')
  } while (out !== prev)
  return out
}

describe('NardukLineChart classic output', () => {
  it('plain multi-series chart', () => {
    expect(render({ chartTitle: 'Plain' })).toMatchSnapshot()
  })

  it('with y bands, a band between series, area and reference line', () => {
    expect(
      render({
        showArea: true,
        yBands: [
          { y0: 0, y1: 4, label: 'Low', color: '#9fc5e3' },
          { y0: 4, y1: 9, label: 'High', color: '#e07b39' },
        ],
        bands: [
          {
            name: '80% band',
            low: labels.map((_, i) => (i > 8 ? 3 : null)),
            high: labels.map((_, i) => (i > 8 ? 8 : null)),
          },
        ],
        referenceLines: [{ value: 6, label: 'Target' }],
      }),
    ).toMatchSnapshot()
  })

  it('dark and linear segments', () => {
    expect(render({ dark: true, smooth: false, showPoints: true })).toMatchSnapshot()
  })
})
