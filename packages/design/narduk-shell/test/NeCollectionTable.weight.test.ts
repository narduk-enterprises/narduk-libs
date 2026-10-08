/*
 * Markup weight of NeCollectionTable cells (narduk-libs#1704). A cell's markup is its value plus a
 * role class; the phone layout ships once in the component's stylesheet, so a table page does not
 * repeat hundreds of bytes of utilities per cell. Server render, no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h, type Component } from 'vue'

import NeCollectionTable from '../src/runtime/components/NeCollectionTable.vue'

import type { NeCollectionColumn } from '../src/runtime/components/ne-collection-table-types'

type Row = Record<string, string | number | null>

const columns: Array<NeCollectionColumn<Row>> = [
  { key: 'name', label: 'Name' },
  { key: 'owner', label: 'Owner' },
  { key: 'a', label: 'A', numeric: true },
  { key: 'b', label: 'B', numeric: true },
  { key: 'c', label: 'C', numeric: true },
  { key: 'note', label: 'Note', freeText: true },
]
const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({
  a: i,
  b: i * 3,
  c: null,
  id: `r${i}`,
  name: `repo-${i}`,
  note: 'text',
  owner: 'Platform',
}))

it('renders 300 cells with under 40 bytes of class attribute per cell', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ component: defineComponent({ setup: () => () => h('div') }), path: '/:p(.*)*' }],
  })
  const app = createSSRApp({
    render: () =>
      h(NeCollectionTable as Component, {
        caption: 'W',
        columns,
        rowKey: (row: Row) => String(row.id),
        rows,
        sortable: false,
      }),
  })
  app.use(router)
  await router.push('/')
  await router.isReady()
  const html = await renderToString(app)
  const cells = [...html.matchAll(/<td [^>]*data-ne-column[^>]*>/g)].map((m) => m[0])
  expect(cells).toHaveLength(300)
  const classBytes = cells.reduce(
    (sum, tag) => sum + (/ class="([^"]*)"/.exec(tag)?.[1].length ?? 0),
    0,
  )
  console.info(
    `weight: cells=300 classBytes=${classBytes} perCell=${classBytes / 300} markup=${html.length}`,
  )
  expect(classBytes / 300).toBeLessThan(40)
})
