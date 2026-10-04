/*
 * The client collection engine and `useClientCollection()` (narduk-libs#1400),
 * upstreamed from operator-portal's `app/utils/collection.ts`. Imported from
 * the package root, the way a server route or another app reads it.
 */
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import { useClientCollection } from '../src/runtime/composables/use-client-collection'
import {
  collectRows,
  firstDirectionOf,
  isSortableColumn,
  NE_COLLECTION_ALL,
  NE_COLLECTION_TOOLBAR_FROM,
  rowMatches,
  sortRows,
  sortValueOf,
  type NeCollectionColumn,
  type NeCollectionFilter,
} from '../src/index'

interface Host {
  cores: number | null
  name: string
  owner?: string
  seen: Date | null
  tags: string[]
}

const columns: Array<NeCollectionColumn<Host>> = [
  { key: 'name', label: 'Host' },
  { key: 'cores', label: 'Cores', numeric: true },
  { key: 'seen', label: 'Seen', format: (value) => (value as Date).toISOString().slice(0, 10) },
  { key: 'tags', label: 'Tags', sortable: false },
]

const hosts: Host[] = [
  { cores: 8, name: 'pve-02', owner: 'Logan', seen: new Date('2026-10-02'), tags: ['gpu'] },
  { cores: null, name: 'pve-01', seen: null, tags: [] },
  { cores: 16, name: 'pve-10', seen: new Date('2026-10-04'), tags: ['ci', 'arm'] },
  { cores: 4, name: 'mac-mini', owner: 'Logan', seen: new Date('2026-09-30'), tags: ['ci'] },
  { cores: Number.NaN, name: 'imac', seen: new Date('2026-10-01'), tags: [] },
]

const names = (rows: readonly Host[]) => rows.map((row) => row.name)

describe('sort', () => {
  it('puts a missing value last ascending', () => {
    expect(names(sortRows(hosts, columns, 'cores:asc'))).toEqual([
      'mac-mini',
      'pve-02',
      'pve-10',
      'pve-01',
      'imac',
    ])
  })

  it('puts a missing value last descending too: missing is never ranked as zero', () => {
    expect(names(sortRows(hosts, columns, 'cores:desc'))).toEqual([
      'pve-10',
      'pve-02',
      'mac-mini',
      'pve-01',
      'imac',
    ])
  })

  it('compares text naturally, so pve-02 sorts before pve-10', () => {
    expect(names(sortRows(hosts, columns, 'name:asc'))).toEqual([
      'imac',
      'mac-mini',
      'pve-01',
      'pve-02',
      'pve-10',
    ])
  })

  it('sorts a date by its time and keeps the caller order for an unknown column or no sort', () => {
    expect(names(sortRows(hosts, columns, 'seen:desc'))[0]).toBe('pve-10')
    expect(names(sortRows(hosts, columns, 'nope:asc'))).toEqual(names(hosts))
    expect(names(sortRows(hosts, columns, null))).toEqual(names(hosts))
  })

  it('reads `sortValue` before the cell', () => {
    const byLength: NeCollectionColumn<Host> = {
      key: 'name',
      label: 'Host',
      sortValue: (row) => row.name.length,
    }
    expect(sortValueOf(byLength, hosts[0]!)).toBe(6)
    expect(names(sortRows(hosts, [byLength], 'name:asc'))[0]).toBe('imac')
  })

  it('puts numbers before text in a mixed column, and is stable for equal values', () => {
    const mixed: NeCollectionColumn<{ id: string; v: number | string }> = { key: 'v', label: 'V' }
    const rows = [
      { id: 'a', v: 'b' },
      { id: 'b', v: 2 },
      { id: 'c', v: 'b' },
      { id: 'd', v: 1 },
    ]
    expect(sortRows(rows, [mixed], 'v:asc').map((row) => row.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('knows which columns sort and which way they start', () => {
    expect(isSortableColumn(columns[0]!, hosts)).toBe(true)
    expect(isSortableColumn(columns[3]!, hosts)).toBe(false)
    expect(isSortableColumn({ key: 'owner', label: 'Owner' }, [hosts[1]!])).toBe(false)
    expect(isSortableColumn({ key: 'x', label: 'X', sortValue: () => null }, [])).toBe(true)
    expect(firstDirectionOf(columns[0]!)).toBe('asc')
    expect(firstDirectionOf(columns[1]!)).toBe('desc')
    expect(firstDirectionOf({ align: 'end', key: 'a', label: 'A' })).toBe('desc')
    expect(firstDirectionOf({ firstDirection: 'asc', key: 'a', label: 'A', numeric: true })).toBe(
      'asc',
    )
  })
})

describe('search and filter', () => {
  const ci: NeCollectionFilter<Host> = {
    key: 'ci',
    label: 'CI',
    test: (row) => row.tags.includes('ci'),
  }
  const gpu: NeCollectionFilter<Host> = {
    key: 'gpu',
    label: 'GPU',
    test: (row) => row.tags.includes('gpu'),
  }

  it('matches any column, a list cell, the formatted text and the row-level search text', () => {
    expect(rowMatches(hosts[2]!, 'arm', columns)).toBe(true)
    expect(rowMatches(hosts[2]!, '2026-10-04', columns)).toBe(true)
    expect(rowMatches(hosts[0]!, 'logan', columns)).toBe(false)
    expect(rowMatches(hosts[0]!, 'logan', columns, (row) => row.owner ?? '')).toBe(true)
  })

  it("takes each chip's count within the search, not over every row", () => {
    const view = collectRows(hosts, {
      columns,
      filter: NE_COLLECTION_ALL,
      filters: [ci, gpu],
      query: 'pve',
    })
    expect(view.items).toEqual([
      { count: 3, key: 'all', label: 'All' },
      { count: 1, key: 'ci', label: 'CI' },
      { count: 1, key: 'gpu', label: 'GPU' },
    ])
  })

  it('applies one chip at a time, then sorts what is left', () => {
    const view = collectRows(hosts, {
      columns,
      filter: 'ci',
      filters: [ci, gpu],
      query: '',
      sort: 'cores:desc',
    })
    expect(names(view.rows)).toEqual(['pve-10', 'mac-mini'])
    expect(view.items[0]).toEqual({ count: 5, key: 'all', label: 'All' })
  })

  it('has no items without filters, and a whitespace search is no search', () => {
    const view = collectRows(hosts, { columns, query: '   ' })
    expect(view.items).toEqual([])
    expect(view.rows).toHaveLength(hosts.length)
    expect(NE_COLLECTION_TOOLBAR_FROM).toBe(25)
  })
})

describe('useClientCollection', () => {
  it('reads reactive rows, and resets search and filter but keeps the sort', async () => {
    const rows = ref<Host[]>(hosts.slice(0, 3))
    const c = useClientCollection<Host>({
      columns,
      filters: [{ key: 'gpu', label: 'GPU', test: (row) => row.tags.includes('gpu') }],
      rows,
      sort: 'cores:asc',
    })
    expect(names(c.rows.value)).toEqual(['pve-02', 'pve-10', 'pve-01'])
    expect(c.total.value).toBe(3)

    c.query.value = 'pve-1'
    expect(names(c.rows.value)).toEqual(['pve-10'])
    expect(c.narrowed.value).toBe(true)
    c.filter.value = 'gpu'
    expect(c.matched.value).toBe(0)
    c.reset()
    expect(c.matched.value).toBe(3)
    expect(c.sort.value).toBe('cores:asc')
    expect(c.narrowed.value).toBe(false)

    rows.value = hosts
    await nextTick()
    expect(c.total.value).toBe(5)
    c.setSort(null)
    expect(names(c.rows.value)).toEqual(names(hosts))
    expect([...c.sortableKeys.value]).toEqual(['name', 'cores', 'seen'])
  })

  it('ignores the search and the filter, but not the sort, when narrowing is off', () => {
    const c = useClientCollection<Host>({
      columns,
      narrowing: false,
      query: 'pve-10',
      rows: hosts,
      sort: 'name:asc',
    })
    expect(c.rows.value).toHaveLength(5)
    expect(c.rows.value[0]!.name).toBe('imac')
    expect(c.narrowed.value).toBe(false)
  })

  it('applies the same reading to another set of rows', () => {
    const c = useClientCollection<Host>({ columns, query: 'pve', rows: hosts, sort: 'cores:desc' })
    expect(names(c.apply([hosts[1]!, hosts[3]!, hosts[0]!]))).toEqual(['pve-02', 'pve-01'])
  })

  it('follows a getter for the starting sort and search', async () => {
    const sort = ref<string | null>('cores:asc')
    const c = useClientCollection<Host>({ columns, rows: hosts, sort: () => sort.value })
    sort.value = 'cores:desc'
    await nextTick()
    expect(c.sort.value).toBe('cores:desc')
  })
})
