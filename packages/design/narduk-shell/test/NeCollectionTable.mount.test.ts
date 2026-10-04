// @vitest-environment happy-dom
/*
 * NeCollectionTable, mounted (narduk-libs#1400). Real Nuxt UI primitives and a
 * real router, so the assertions are about the markup an app ships: header
 * sort with missing values last both ways, the toolbar and its counts within
 * the search, groups, row links, selection, the limit, the footer, the
 * missing-value choices and the phone layouts.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

import NeCollectionTable from '../src/runtime/components/NeCollectionTable.vue'

import type {
  NeCollectionColumn,
  NeCollectionFilter,
  NeCollectionGroup,
  NeCollectionTableProps,
} from '../src/index'

interface Repo {
  id: string
  issues: number | null
  name: string
  note: string | null
  owner: string
}

const columns: Array<NeCollectionColumn<Repo>> = [
  { key: 'name', label: 'Repository' },
  { key: 'owner', label: 'Owner', width: '8rem' },
  { key: 'issues', label: 'Issues', numeric: true, width: '6rem' },
  { key: 'note', label: 'Note', freeText: true, phone: false },
]

const repos: Repo[] = [
  { id: 'r1', issues: 3, name: 'operator-portal', note: 'Busy', owner: 'Platform' },
  { id: 'r2', issues: null, name: 'buoys', note: null, owner: 'Marine' },
  { id: 'r3', issues: 12, name: 'stonx', note: 'Markets board', owner: 'Markets' },
  { id: 'r4', issues: 0, name: 'tideye', note: null, owner: 'Marine' },
]

const marine: NeCollectionFilter<Repo> = {
  key: 'marine',
  label: 'Marine',
  test: (repo) => repo.owner === 'Marine',
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ component: defineComponent({ setup: () => () => h('div') }), path: '/:p(.*)*' }],
})

function render<TRow>(
  props: NeCollectionTableProps<TRow>,
  slots: Record<string, string | (() => unknown)> = {},
) {
  return mount(NeCollectionTable, {
    attachTo: document.body,
    global: { plugins: [router] },
    props: props as never,
    slots: slots as never,
  })
}

type Wrapper = ReturnType<typeof render>

const rowNames = (wrapper: Wrapper) =>
  wrapper.findAll('[data-ne-collection-row]').map((row) => row.find('td').text())

const header = (wrapper: Wrapper, key: string) => wrapper.find(`th[data-ne-column="${key}"]`)

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('NeCollectionTable: roles', () => {
  it('declares every table role explicitly, with a hidden caption', () => {
    const wrapper = render({ caption: 'Repositories', columns, rows: repos })
    expect(wrapper.find('table').attributes('role')).toBe('table')
    expect(wrapper.find('caption').text()).toBe('Repositories')
    expect(wrapper.find('thead').attributes('role')).toBe('rowgroup')
    expect(wrapper.find('tbody').attributes('role')).toBe('rowgroup')
    expect(wrapper.findAll('th[role="columnheader"][scope="col"]')).toHaveLength(4)
    expect(wrapper.findAll('tr[role="row"]')).toHaveLength(5)
    expect(wrapper.findAll('td[role="cell"]')).toHaveLength(16)
    expect(wrapper.find('[data-ne-collection-scroll]').attributes('aria-label')).toBe(
      'Repositories',
    )
  })
})

describe('NeCollectionTable: sort', () => {
  it('sorts from a header, with the missing value last in both directions', async () => {
    const wrapper = render({ caption: 'Repositories', columns, rows: repos })
    expect(rowNames(wrapper)).toEqual(['operator-portal', 'buoys', 'stonx', 'tideye'])
    expect(header(wrapper, 'issues').attributes('aria-sort')).toBeUndefined()

    await header(wrapper, 'issues').find('button').trigger('click')
    expect(rowNames(wrapper)).toEqual(['stonx', 'operator-portal', 'tideye', 'buoys'])
    expect(header(wrapper, 'issues').attributes('aria-sort')).toBe('descending')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual(['issues:desc'])

    await header(wrapper, 'issues').find('button').trigger('click')
    expect(rowNames(wrapper)).toEqual(['tideye', 'operator-portal', 'stonx', 'buoys'])
    expect(header(wrapper, 'issues').attributes('aria-sort')).toBe('ascending')
  })

  it('starts a text column ascending, and follows the `sort` prop', async () => {
    const wrapper = render({ caption: 'Repositories', columns, rows: repos })
    await header(wrapper, 'name').find('button').trigger('click')
    expect(rowNames(wrapper)[0]).toBe('buoys')
    await wrapper.setProps({ sort: 'name:desc' } as never)
    expect(rowNames(wrapper)[0]).toBe('tideye')
    expect(header(wrapper, 'name').attributes('aria-sort')).toBe('descending')
  })

  it('draws no sort button for an empty column, `sortable: false`, or a table with sorting off', () => {
    const wrapper = render({
      caption: 'Repositories',
      columns: [...columns, { key: 'missing', label: 'Nothing' }],
      rows: repos,
    })
    expect(header(wrapper, 'missing').find('button').exists()).toBe(false)
    expect(header(wrapper, 'name').find('button').exists()).toBe(true)
    const off = render({ caption: 'Repositories', columns, rows: repos, sortable: false })
    expect(off.findAll('thead button')).toHaveLength(0)
  })
})

describe('NeCollectionTable: toolbar', () => {
  const many = Array.from({ length: 25 }, (_, index) => ({
    ...repos[index % 4]!,
    id: `r${index}`,
    name: `${repos[index % 4]!.name}-${index}`,
  }))

  it('appears from 25 rows, from a number, always, or never', () => {
    expect(
      render({ caption: 'R', columns, rows: repos }).find('[data-ne-collection-toolbar]').exists(),
    ).toBe(false)
    expect(
      render({ caption: 'R', columns, rows: many }).find('[data-ne-collection-toolbar]').exists(),
    ).toBe(true)
    expect(
      render({ caption: 'R', columns, rows: repos, toolbar: 4 })
        .find('[data-ne-collection-toolbar]')
        .exists(),
    ).toBe(true)
    expect(
      render({ caption: 'R', columns, rows: repos, toolbar: 'always' })
        .find('[data-ne-collection-toolbar]')
        .exists(),
    ).toBe(true)
    expect(
      render({ caption: 'R', columns, rows: many, toolbar: false })
        .find('[data-ne-collection-toolbar]')
        .exists(),
    ).toBe(false)
  })

  it('searches every column, and counts each chip within the search', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      filters: [marine],
      noun: 'repos',
      rows: repos,
      searchDebounce: 0,
      toolbar: 'always',
    })
    const chips = () =>
      wrapper
        .findAll('[data-ne-filter-control]')
        .map(
          (chip) =>
            `${chip.text().replace(/\d+$/, '').trim()} ${chip.find('[data-ne-filter-count]').text()}`,
        )
    expect(chips()).toEqual(['All 4', 'Marine 2'])
    expect(wrapper.find('[data-ne-collection-count]').text()).toBe('4 repos')

    await wrapper.find('input').setValue('markets')
    await flushPromises()
    expect(rowNames(wrapper)).toEqual(['stonx'])
    expect(chips()).toEqual(['All 1', 'Marine 0'])
    expect(wrapper.find('[data-ne-collection-count]').text()).toBe('1 of 4 repos')
  })

  it('filters by chip, says when nothing matches, and resets', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      filters: [marine],
      initialQuery: 'stonx',
      rows: repos,
      toolbar: 'always',
    })
    expect(rowNames(wrapper)).toEqual(['stonx'])
    const chip = wrapper.findAll('[data-ne-filter-control]')[1]!
    await chip.trigger('click')
    expect(wrapper.find('[data-ne-collection-none]').attributes('role')).toBe('status')
    await wrapper.find('[data-ne-collection-none] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-ne-collection-none]').exists()).toBe(false)
    expect(rowNames(wrapper)).toHaveLength(4)
  })

  it('ignores a search nobody can see: below the threshold the rows are not narrowed', () => {
    const wrapper = render({ caption: 'R', columns, initialQuery: 'stonx', rows: repos })
    expect(rowNames(wrapper)).toHaveLength(4)
  })
})

describe('NeCollectionTable: groups, limit, footer', () => {
  const groups: Array<NeCollectionGroup<Repo>> = [
    {
      attrs: { 'data-testid': 'g-marine' },
      count: 2,
      key: 'm',
      label: 'Marine',
      rows: repos.filter((r) => r.owner === 'Marine'),
    },
    { key: 'o', label: 'Other', rows: repos.filter((r) => r.owner !== 'Marine') },
  ]

  it('draws a rowgroup heading per group, sorts within it, and drops a group the search empties', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      groups,
      searchDebounce: 0,
      sort: 'name:asc',
      toolbar: 'always',
    })
    const headings = wrapper.findAll('th[scope="rowgroup"]')
    expect(headings.map((th) => th.find('span').text())).toEqual(['Marine', 'Other'])
    expect(headings[0]!.find('[data-ne-collection-group-count]').text()).toBe('2')
    expect(headings[1]!.find('[data-ne-collection-group-count]').exists()).toBe(false)
    expect(headings[0]!.attributes('data-testid')).toBe('g-marine')
    expect(wrapper.findAll('tbody[role="rowgroup"]')).toHaveLength(2)
    expect(rowNames(wrapper)).toEqual(['buoys', 'tideye', 'operator-portal', 'stonx'])

    await wrapper.find('input').setValue('stonx')
    await flushPromises()
    expect(wrapper.findAll('th[scope="rowgroup"]').map((th) => th.text())).toEqual(['Other'])
  })

  it('stops at `limit` across groups, then shows all', async () => {
    const wrapper = render({ caption: 'Repositories', columns, groups, limit: 3 })
    expect(rowNames(wrapper)).toHaveLength(3)
    const more = wrapper.find('[data-ne-collection-show-all]')
    expect(more.text()).toBe('Show all 4')
    expect(more.classes()).toContain('max-md:min-h-11')
    await more.trigger('click')
    expect(rowNames(wrapper)).toHaveLength(4)
    expect(wrapper.find('[data-ne-collection-show-all]').exists()).toBe(false)
  })

  it('keeps the headings under a header sort when `groupSort` is `within`, the default', async () => {
    const wrapper = render({ caption: 'Repositories', columns, groups, toolbar: false })
    await header(wrapper, 'issues').find('button').trigger('click')
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(2)
    expect(rowNames(wrapper)).toEqual(['tideye', 'buoys', 'stonx', 'operator-portal'])
    expect(wrapper.find('[data-ne-collection-group-reset]').exists()).toBe(false)
    expect(wrapper.attributes('data-ne-sorted-across')).toBeUndefined()
  })

  it('sorts across every group when `groupSort` is `across`, then goes back to the groups', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      groupSort: 'across',
      groups,
      limit: 3,
      sort: 'name:asc',
      toolbar: false,
    })
    // The caller's own sort keeps the groups.
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(2)
    expect(wrapper.find('[data-ne-collection-toolbar]').exists()).toBe(false)

    await header(wrapper, 'issues').find('button').trigger('click')
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(0)
    expect(wrapper.findAll('tbody[role="rowgroup"]')).toHaveLength(1)
    // One run in sort order, missing last, and the limit still applies.
    expect(rowNames(wrapper)).toEqual(['stonx', 'operator-portal', 'tideye'])
    await wrapper.find('[data-ne-collection-show-all]').trigger('click')
    expect(rowNames(wrapper)).toEqual(['stonx', 'operator-portal', 'tideye', 'buoys'])
    expect(wrapper.attributes('data-ne-sorted-across')).toBe('')

    // Reachable with the toolbar otherwise off.
    const reset = wrapper.find('[data-ne-collection-group-reset]')
    expect(reset.text()).toBe('Back to groups')
    expect(reset.classes()).toContain('max-md:min-h-11')
    await reset.trigger('click')
    expect(wrapper.emitted('update:sort')?.at(-1)).toEqual(['name:asc'])
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(2)
    expect(rowNames(wrapper)).toEqual(['buoys', 'tideye', 'operator-portal', 'stonx'])
    expect(header(wrapper, 'name').attributes('aria-sort')).toBe('ascending')
    expect(wrapper.find('[data-ne-collection-group-reset]').exists()).toBe(false)
  })

  it('keeps the grouped sort under `v-model:sort` through `groupedSort`, with its own reset label', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      groupResetLabel: 'By kind',
      groupSort: 'across',
      groupedSort: null,
      groups,
      sort: null,
      toolbar: false,
    })
    await header(wrapper, 'name').find('button').trigger('click')
    // The parent writes the emitted sort back, as v-model does.
    await wrapper.setProps({ sort: 'name:asc' } as never)
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(0)
    expect(rowNames(wrapper)).toEqual(['buoys', 'operator-portal', 'stonx', 'tideye'])
    const reset = wrapper.find('[data-ne-collection-group-reset]')
    expect(reset.text()).toBe('By kind')
    await reset.trigger('click')
    expect(wrapper.emitted('update:sort')?.at(-1)).toEqual([null])
    expect(wrapper.findAll('th[scope="rowgroup"]')).toHaveLength(2)
    expect(rowNames(wrapper)).toEqual(['buoys', 'tideye', 'operator-portal', 'stonx'])
  })

  it('closes on the caller’s bounded-read footer, with a link to the rest', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      more: { href: '/repos', label: 'showing 4 of 41' },
      rows: repos,
    })
    await flushPromises()
    const foot = wrapper.find('tfoot [data-ne-collection-more]')
    expect(foot.text()).toContain('showing 4 of 41')
    expect(foot.find('a').attributes('href')).toBe('/repos')
    expect(foot.attributes('colspan')).toBe('4')
  })

  it('says so when it holds no rows', () => {
    const wrapper = render({ caption: 'R', columns, empty: 'No repositories yet', rows: [] })
    expect(wrapper.find('[data-ne-collection-empty]').text()).toBe('No repositories yet')
  })
})

describe('NeCollectionTable: rows', () => {
  it('makes the primary cell a link and follows it from anywhere on the row', async () => {
    const wrapper = render({
      caption: 'Repositories',
      columns,
      rowAttrs: (repo) => ({ 'data-repo': repo.id, 'data-skip': undefined }),
      rowHref: (repo) => (repo.id === 'r2' ? null : `/repos/${repo.id}`),
      rows: repos,
    })
    await flushPromises()
    const links = wrapper.findAll('[data-ne-row-link]')
    expect(links).toHaveLength(3)
    expect(links[0]!.attributes('href')).toBe('/repos/r1')
    expect(links[0]!.element.closest('td')?.dataset.neColumn).toBe('name')

    const first = wrapper.find('tr[data-repo="r1"]')
    expect(first.attributes('data-skip')).toBeUndefined()
    const clicked = vi.fn()
    links[0]!.element.addEventListener('click', clicked)
    await first.find('td[data-ne-column="issues"]').trigger('click')
    expect(clicked).toHaveBeenCalledTimes(1)
    await first.find('td[data-ne-column="issues"]').trigger('click', { metaKey: true })
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('marks the selected row and emits `select` on a click or Enter', async () => {
    const wrapper = render({ caption: 'R', columns, rows: repos, selectedKey: 'r3' })
    const rows = wrapper.findAll('[data-ne-collection-row]')
    expect(rows[2]!.attributes('aria-current')).toBe('true')
    expect(rows[0]!.attributes('aria-current')).toBeUndefined()
    expect(rows[0]!.attributes('tabindex')).toBe('0')
    await rows[1]!.trigger('click')
    await rows[3]!.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.map(([key]) => key)).toEqual(['r2', 'r4'])
  })

  it('has no selection at all when `selectedKey` is absent', async () => {
    const wrapper = render({ caption: 'R', columns, rows: repos })
    const row = wrapper.find('[data-ne-collection-row]')
    expect(row.attributes('tabindex')).toBeUndefined()
    await row.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})

describe('NeCollectionTable: cells and missing values', () => {
  const cell = (wrapper: Wrapper, row: number, key: string) =>
    wrapper.findAll('[data-ne-collection-row]')[row]!.find(`td[data-ne-column="${key}"]`)

  it('draws a dash named "No value" by default, and 0 as a value', () => {
    const wrapper = render({ caption: 'R', columns, rows: repos })
    const missing = cell(wrapper, 1, 'issues').find('[data-ne-missing]')
    expect(missing.find('[aria-hidden="true"]').text()).toBe('—')
    expect(missing.find('.sr-only').text()).toBe('No value')
    expect(cell(wrapper, 3, 'issues').text()).toBe('0')
  })

  it("reads the app's own word: the table's, then the column's", () => {
    const wrapper = render({
      caption: 'R',
      columns: columns.map((column) =>
        column.key === 'note'
          ? { ...column, missingText: (repo: Repo) => `none for ${repo.name}` }
          : column,
      ),
      missingText: 'unreported',
      rows: repos,
    })
    expect(cell(wrapper, 1, 'issues').text()).toBe('unreported')
    expect(cell(wrapper, 1, 'note').text()).toBe('none for buoys')
    expect(wrapper.text()).not.toContain('—')
  })

  it('takes a `missing` slot, and a cell slot always wins over the plain value', () => {
    const wrapper = render(
      { caption: 'R', columns, rows: repos },
      {
        'issues-cell': '<b>#{{ value }}</b>',
        missing: '<i data-hatch>unreported</i>',
        'owner-header': '<span data-owner-head>Who</span>',
      },
    )
    expect(cell(wrapper, 1, 'note').find('[data-hatch]').text()).toBe('unreported')
    expect(cell(wrapper, 0, 'issues').text()).toBe('#3')
    expect(header(wrapper, 'owner').find('[data-owner-head]').text()).toBe('Who')
  })

  it('formats numbers and honours `format`', () => {
    const wrapper = render({
      caption: 'R',
      columns: [
        { key: 'n', label: 'N', numeric: true },
        { format: (value) => `${String(value)} kt`, key: 'w', label: 'W' },
      ],
      rows: [{ n: 12_345, w: 4 }],
    })
    expect(wrapper.find('td[data-ne-column="n"]').text()).toBe('12,345')
    expect(wrapper.find('td[data-ne-column="n"]').classes()).toContain('tabular-nums')
    expect(wrapper.find('td[data-ne-column="w"]').text()).toBe('4 kt')
  })
})

describe('NeCollectionTable: phone', () => {
  it('reflows rows into cards below `md` by default, dropping `phone: false` columns', () => {
    const wrapper = render({ caption: 'R', columns, rows: repos })
    expect(wrapper.find('thead').classes()).toContain('max-md:sr-only')
    const row = wrapper.find('[data-ne-collection-row]')
    expect(row.classes()).toEqual(expect.arrayContaining(['max-md:flex', 'max-md:flex-wrap']))
    expect(row.find('td[data-ne-column="name"]').classes()).toContain('max-md:basis-full')
    expect(row.find('td[data-ne-column="note"]').classes()).toContain('max-md:hidden')
    expect(header(wrapper, 'note').classes()).toContain('max-md:hidden')
  })

  it('clamps a free-text column to its own line', () => {
    const wrapper = render({
      caption: 'R',
      columns: columns.map((column) => ({ ...column, phone: true })),
      rows: repos,
    })
    const note = wrapper.find('td[data-ne-column="note"]')
    expect(note.classes()).toEqual(
      expect.arrayContaining(['max-md:basis-full', 'max-md:line-clamp-2']),
    )
  })

  it('keeps the columns in the `columns` layout, at the breakpoint asked for', () => {
    const wrapper = render({
      caption: 'R',
      columns,
      phoneLayout: 'columns',
      rows: repos,
      stackBelow: 'lg',
    })
    expect(wrapper.find('thead').classes()).not.toContain('max-lg:sr-only')
    expect(wrapper.find('[data-ne-collection-row]').classes()).not.toContain('max-lg:flex')
    expect(wrapper.find('td[data-ne-column="note"]').classes()).toContain('max-lg:hidden')
    expect(header(wrapper, 'name').classes()).toContain('max-lg:[&_button]:min-h-11')
    // A dropped column's <col> goes with its cells; otherwise the next cell takes its width.
    const cols = wrapper.findAll('col')
    const noteIndex = columns.findIndex((column) => column.key === 'note')
    expect(cols[noteIndex]!.classes()).toContain('max-lg:hidden')
    expect(cols.filter((col) => col.classes().includes('max-lg:hidden'))).toHaveLength(
      columns.filter((column) => column.phone === false).length,
    )
    expect(wrapper.find('table').classes()).toContain('table-fixed')
    expect(wrapper.find('table').classes()).not.toContain('max-lg:table-auto')
    expect(wrapper.find('[data-ne-collection-phone-sort]').exists()).toBe(false)
  })

  it('holds the toolbar to a 44px tap floor and offers a sort select in the card layout', () => {
    const wrapper = render({ caption: 'R', columns, rows: repos, toolbar: 'always' })
    expect(wrapper.find('[data-ne-collection-toolbar]').classes()).toContain(
      'max-md:[&_input]:min-h-11',
    )
    const sort = wrapper.find('[data-ne-collection-phone-sort]')
    expect(sort.classes()).toEqual(expect.arrayContaining(['hidden', 'max-md:inline-flex']))
  })

  it('swaps the hidden header’s sort buttons for labels once mounted on a phone', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        matches: query === '(width < 48rem)',
        removeEventListener: vi.fn(),
      })),
    )
    const wrapper = render({ caption: 'R', columns, rows: repos, sort: 'issues:desc' })
    await flushPromises()
    expect(wrapper.findAll('thead button')).toHaveLength(0)
    expect(header(wrapper, 'issues').text()).toBe('Issues')
    expect(header(wrapper, 'issues').attributes('aria-sort')).toBe('descending')
  })

  it('spans a group heading over the kept columns only, once stacked in the `columns` layout', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        matches: query === '(width < 48rem)',
        removeEventListener: vi.fn(),
      })),
    )
    const groups = [{ key: 'all', label: 'All', rows: repos }]
    const wide = render({ caption: 'R', columns, groups })
    expect(wide.find('th[scope="rowgroup"]').attributes('colspan')).toBe(String(columns.length))
    const narrow = render({ caption: 'R', columns, groups, phoneLayout: 'columns' })
    // Before mount the server's span covers every column; after, only the kept ones.
    expect(narrow.find('th[scope="rowgroup"]').attributes('colspan')).toBe(String(columns.length))
    await flushPromises()
    const kept = columns.filter((column) => column.phone !== false).length
    expect(kept).toBeLessThan(columns.length)
    expect(narrow.find('th[scope="rowgroup"]').attributes('colspan')).toBe(String(kept))
    vi.unstubAllGlobals()
  })

  it('floors the width-less columns on the table, above the breakpoint only', () => {
    const wrapper = render({ caption: 'R', columns, rows: repos })
    const scroll = wrapper.find('[data-ne-collection-scroll]')
    expect(scroll.attributes('style')).toContain(
      '--ne-collection-min: calc(200px + 8rem + 6rem + 200px)',
    )
    expect(wrapper.find('table').classes()).toContain(
      'md:min-w-[max(100%,var(--ne-collection-min,0px))]',
    )
  })
})
