/*
 * Server-render proof for NeDataTable (narduk-libs#528).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts, copied by
 * NePager.ssr.test.ts. Consumers run on Nuxt/Nitro, and for the Cloudflare
 * Workers preset the first render happens in a runtime with no `window` and
 * no `document` at all. The mount suite next door runs under happy-dom, so it
 * cannot be the proof that the first paint already carries the groups, the
 * units, the missing dash and the loading reading.
 *
 * This file therefore runs in vitest's `node` environment (this package's
 * default; it deliberately carries no `@vitest-environment` directive) and
 * renders the real `UTable` through `@vue/server-renderer`. A stub emitting
 * its own `<table>` would pass while the shipped component threw.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeDataTable from '../src/runtime/components/NeDataTable.vue'

import type {
  NeDataColumn,
  NeDataColumnGroup,
  NeDataTableProps,
} from '../src/runtime/components/ne-data-table-types'

import ReadingDataTableHost from './ReadingDataTableHost.vue'
import type { Reading } from './ReadingDataTableHost.vue'

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'waves', label: 'Waves', unit: 'ft' },
]

const columns: NeDataColumn<Reading>[] = [
  { key: 'time', label: 'Time', sticky: true },
  {
    firstDirection: 'desc',
    group: 'wind',
    key: 'wind',
    label: 'avg',
    numeric: true,
    sortKey: 'wind',
  },
  { group: 'wind', key: 'gust', label: 'gust', numeric: true },
  { group: 'waves', key: 'waves', label: 'height', numeric: true },
]

const rows: Reading[] = [
  { day: 'Fri, Sep 18', gust: 16, time: '1:50 PM', wind: 14 },
  { day: 'Fri, Sep 18', gust: 12, time: '12:50 PM', wind: 0 },
  { day: 'Thu, Sep 17', gust: null, time: '6:50 PM', wind: null },
]

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

it('server-renders NeDataTable directly when columns do not pin T', async () => {
  const html = await renderToString(
    createSSRApp({
      setup: () => () =>
        h(NeDataTable, {
          columns: [{ key: 'time', label: 'Time' }],
          rows: [{ time: '1:50 PM' }],
        }),
    }),
  )
  expect(html).toContain('data-ne-data-table')
})

function render(extra: Partial<NeDataTableProps<Reading>> = {}): Promise<string> {
  const bound: NeDataTableProps<Reading> = {
    columns,
    groups,
    rowKey: (row) => row.time,
    rows,
    ...extra,
  }
  return renderToString(createSSRApp({ setup: () => () => h(ReadingDataTableHost, bound) }))
}

describe('NeDataTable server-rendered without a DOM', () => {
  it('carries the table, groups and units into the first paint', async () => {
    const html = await render()

    expect(html).toContain('data-ne-data-table')
    expect(html).toContain('data-ne-column-group="wind"')
    expect(html).toContain('Wind')
    expect(html).toContain('data-ne-unit')
    expect(html).toContain('kt')
    expect(html).toContain('1:50 PM')
    expect(html).toContain('14')
  })

  it('carries the missing-value dash and "No value" into the first paint, and 0 as 0', async () => {
    const html = await render()

    expect(html).toContain('data-ne-missing')
    expect(html).toContain('—')
    expect(html).toContain('No value')
    expect(html).toContain('>0<')
  })

  it('server-renders a sort header for a sortKey column', async () => {
    const html = await render({ sort: 'wind:desc' })

    expect(html).toContain('data-ne-sort-header')
    expect(html).toContain('data-ne-sort-direction="desc"')
  })

  it('server-renders day rows and the break row before missing values', async () => {
    const html = await render({
      groupBy: (row: Reading) => row.day,
      missingCount: 142,
      sort: 'wind:desc',
    })

    expect(html).toContain('data-ne-group-row="Fri, Sep 18"')
    expect(html).toContain('data-ne-group-row="Thu, Sep 17"')
    expect(html).toContain('data-ne-break-row')
    expect(html).toContain('142 rows have no avg value · sorted last')
  })

  it('server-renders the phone column-set switch when two groups are in play', async () => {
    const html = await render()

    expect(html).toContain('data-ne-column-sets')
    expect(html).toContain('aria-label="Columns shown"')
    expect(html).toContain('Waves')
  })

  it('carries the polite busy reading into the first paint and keeps the rows', async () => {
    const html = await render({ loading: true })

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('opacity-50')
    expect(html).toContain('after:h-0.5')
    expect(html).toContain('1:50 PM')
    expect(html).toContain('12:50 PM')
  })

  it('is not busy at rest', async () => {
    const html = await render()

    expect(html).not.toContain('aria-busy')
    expect(html).not.toContain('opacity-50')
  })

  it('server-renders stickyHeader="page" without throwing', async () => {
    const html = await render({ stickyHeader: 'page' })

    expect(html).toContain('data-ne-data-table')
    expect(html).toContain('top-(--ui-header-height)')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render()).resolves.toContain('data-ne-data-table')
    await expect(render({ loading: true })).resolves.toContain('aria-busy="true"')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
