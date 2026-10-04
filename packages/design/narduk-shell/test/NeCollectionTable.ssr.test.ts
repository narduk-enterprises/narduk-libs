/*
 * Server-render proof for NeCollectionTable and useClientCollection
 * (narduk-libs#1400). Runs in vitest's `node` environment with no DOM, the way
 * a Workers render does, and renders the real Nuxt UI primitives. It proves
 * the first paint already carries the sort (missing last, `aria-sort` on the
 * header cell), the toolbar's counts within a search the page arrived with,
 * the phone layout's classes, real row-link hrefs, and the selected row.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h, type Component } from 'vue'

import NeCollectionTable from '../src/runtime/components/NeCollectionTable.vue'
import NeDataTable from '../src/runtime/components/NeDataTable.vue'
import { useClientCollection } from '../src/runtime/composables/use-client-collection'

import type {
  NeCollectionColumn,
  NeCollectionFilter,
  NeCollectionTableProps,
} from '../src/runtime/components/ne-collection-table-types'

interface Station {
  id: string
  name: string
  region: string
  wind: number | null
}

const columns: Array<NeCollectionColumn<Station>> = [
  { key: 'name', label: 'Station' },
  { key: 'region', label: 'Region', phone: false, width: '8rem' },
  { key: 'wind', label: 'Wind', numeric: true, unit: 'kt', width: '6rem' },
]

const stations: Station[] = [
  { id: 's1', name: 'Port Aransas', region: 'Coastal Bend', wind: 14 },
  { id: 's2', name: 'Apalachicola', region: 'Gulf', wind: null },
  { id: 's3', name: 'Port Isabel', region: 'Laguna', wind: 21 },
  { id: 's4', name: 'Aransas Bay', region: 'Coastal Bend', wind: 6 },
]

const coastal: NeCollectionFilter<Station> = {
  key: 'coastal',
  label: 'Coastal Bend',
  test: (station) => station.region === 'Coastal Bend',
}

async function render(props: NeCollectionTableProps<Station>): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ component: defineComponent({ setup: () => () => h('div') }), path: '/:p(.*)*' }],
  })
  const app = createSSRApp({ render: () => h(NeCollectionTable as Component, props) })
  app.use(router)
  await router.push('/')
  await router.isReady()
  return renderToString(app)
}

function order(html: string): string[] {
  return [...html.matchAll(/data-ne-column="name"[^>]*>(?:<!--[^>]*-->|<a[^>]*>)*([^<]+)/g)].map(
    (m) => m[1]!,
  )
}

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('NeCollectionTable on the server', () => {
  it('paints the sort with the missing value last, and aria-sort on the header cell', async () => {
    const desc = await render({ caption: 'Stations', columns, rows: stations, sort: 'wind:desc' })
    expect(order(desc)).toEqual(['Port Isabel', 'Port Aransas', 'Aransas Bay', 'Apalachicola'])
    expect(desc).toMatch(/<th[^>]*aria-sort="descending"[^>]*data-ne-column="wind"/)
    expect(desc).not.toMatch(/aria-sort="[^"]*"[^>]*data-ne-column="name"/)

    const asc = await render({ caption: 'Stations', columns, rows: stations, sort: 'wind:asc' })
    expect(order(asc)).toEqual(['Aransas Bay', 'Port Aransas', 'Port Isabel', 'Apalachicola'])
  })

  it('counts each chip within the search the page arrived with', async () => {
    const html = await render({
      caption: 'Stations',
      columns,
      filters: [coastal],
      initialQuery: 'port',
      noun: 'stations',
      rows: stations,
      toolbar: 'always',
    })
    expect(order(html)).toEqual(['Port Aransas', 'Port Isabel'])
    expect(html).toContain('2 of 4 stations')
    const counts = [...html.matchAll(/data-ne-filter-count[^>]*>(\d+)</g)].map((m) => m[1])
    expect(counts).toEqual(['2', '1'])
  })

  it('carries the phone layout as classes, so the first paint on a phone is already the card', async () => {
    const html = await render({ caption: 'Stations', columns, rows: stations })
    expect(html).toContain('data-ne-phone-layout="cards"')
    expect(html).toMatch(/<thead[^>]*class="[^"]*max-md:sr-only/)
    expect(html).toMatch(/data-ne-collection-row[^>]*class="[^"]*max-md:flex/)
    expect(html).toMatch(/class="[^"]*max-md:hidden[^"]*"[^>]*data-ne-column="region"/)
    // The header keeps its sort buttons until a client measures the viewport.
    expect(html).toMatch(/data-ne-column="wind"[^>]*>[\s\S]*?data-ne-sort-header/)
  })

  it('renders real hrefs for row links, the selected row, and the missing word', async () => {
    const html = await render({
      caption: 'Stations',
      columns,
      missingText: 'unreported',
      rowHref: (station) => `/stations/${station.id}`,
      rows: stations,
      selectedKey: 's2',
    })
    expect(html).toContain('href="/stations/s1"')
    expect(html).toMatch(/aria-current="true"[^>]*>[\s\S]*?Apalachicola/)
    expect(html).toContain('>unreported<')
    expect(html).not.toContain('—')
  })
})

describe('NeCollectionTable groups on the server', () => {
  const groups = [
    {
      key: 'coastal',
      label: 'Coastal Bend',
      rows: stations.filter((s) => s.region === 'Coastal Bend'),
    },
    { key: 'other', label: 'Elsewhere', rows: stations.filter((s) => s.region !== 'Coastal Bend') },
  ]

  it('paints the groups under the grouped sort, and sorts within them by default', async () => {
    const within = await render({ caption: 'Stations', columns, groups, sort: 'wind:desc' })
    expect(within.match(/scope="rowgroup"/g)).toHaveLength(2)
    expect(order(within)).toEqual(['Port Aransas', 'Aransas Bay', 'Port Isabel', 'Apalachicola'])

    const across = await render({
      caption: 'Stations',
      columns,
      groupSort: 'across',
      groups,
      sort: 'wind:desc',
    })
    expect(across.match(/scope="rowgroup"/g)).toHaveLength(2)
    expect(across).not.toContain('data-ne-collection-group-reset')
  })

  it('paints one run across the groups, with the way back, when a link arrives sorted', async () => {
    const html = await render({
      caption: 'Stations',
      columns,
      groupSort: 'across',
      groupedSort: null,
      groups,
      sort: 'wind:desc',
      toolbar: false,
    })
    expect(html).not.toContain('scope="rowgroup"')
    expect(order(html)).toEqual(['Port Isabel', 'Port Aransas', 'Aransas Bay', 'Apalachicola'])
    expect(html).toContain('data-ne-sorted-across')
    expect(html).toMatch(/data-ne-collection-group-reset[\s\S]*?Back to groups/)
  })
})

describe('useClientCollection gives NeDataTable a client mode', () => {
  it('sorts the rows before the table sees them, and the table marks the column', async () => {
    const Host = defineComponent({
      setup() {
        const c = useClientCollection<Station>({ columns, rows: stations, sort: 'wind:desc' })
        return () =>
          h(NeDataTable as Component, {
            columns: [
              { key: 'name', label: 'Station' },
              { key: 'wind', label: 'Wind', numeric: true, sortKey: 'wind' },
            ],
            missingText: 'unreported',
            rows: c.rows.value,
            sort: c.sort.value,
          })
      },
    })
    const html = await renderToString(createSSRApp(Host))
    const names = [
      ...html.matchAll(
        /<td[^>]*>(?:<!--[^>]*-->)*(Port Isabel|Port Aransas|Aransas Bay|Apalachicola)</g,
      ),
    ]
    expect(names.map((m) => m[1])).toEqual([
      'Port Isabel',
      'Port Aransas',
      'Aransas Bay',
      'Apalachicola',
    ])
    expect(html).toContain('data-ne-break-row')
  })
})
