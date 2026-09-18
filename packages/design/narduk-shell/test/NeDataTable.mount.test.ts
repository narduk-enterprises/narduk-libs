// @vitest-environment happy-dom
/*
 * NeDataTable, mounted (narduk-libs#528). The real `UTable` is rendered, so
 * these assertions are about the markup an app actually ships: groups over
 * columns, the unit once, numerals right-aligned, missing as an em dash, day
 * rows, the break row, the sticky column, the phone switch and loading.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeDataTable from '../src/runtime/components/NeDataTable.vue'

import type { NeDataColumn, NeDataColumnGroup } from '../src/index'

interface Reading {
  day: string
  gust: number | null
  pressure: number | null
  time: string
  visibility: number | null
  wind: number | null
}

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'pressure', label: 'Pressure', unit: 'inHg' },
]

const columns: NeDataColumn<Reading>[] = [
  { key: 'time', label: 'Time', sticky: true },
  { key: 'wind', label: 'avg', group: 'wind', numeric: true, emphasis: true, sortKey: 'wind', firstDirection: 'desc' },
  { key: 'gust', label: 'gust', group: 'wind', numeric: true },
  {
    key: 'pressure',
    label: 'sea level',
    group: 'pressure',
    numeric: true,
    format: (value) => (value as number).toFixed(2),
  },
  { key: 'visibility', label: 'vis', unit: 'nm', numeric: true },
]

const rows: Reading[] = [
  { day: 'Fri, Sep 18', gust: 16, pressure: 30.08, time: '1:50 PM', visibility: null, wind: 14 },
  { day: 'Fri, Sep 18', gust: 12, pressure: 30.1, time: '12:50 PM', visibility: null, wind: 0 },
  { day: 'Thu, Sep 17', gust: null, pressure: 30.1, time: '6:50 PM', visibility: null, wind: null },
]

function render(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(NeDataTable, {
    props: { columns, groups, rows, rowKey: (row: Reading) => row.time, ...props },
    slots,
  })
}

const bodyRows = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody tr')
const cellTexts = (row: { findAll: (s: string) => { text: () => string }[] }) =>
  row.findAll('td').map((td) => td.text())

describe('NeDataTable: header', () => {
  it('draws the groups above their columns, each unit once', () => {
    const wrapper = render()
    const headerRows = wrapper.findAll('thead tr[data-slot="tr"]')
    expect(headerRows).toHaveLength(2)

    const groupsRow = headerRows[0]!.findAll('th')
    const wind = groupsRow.find((th) => th.text().startsWith('Wind'))!
    expect(wind.attributes('colspan')).toBe('2')
    expect(wind.get('[data-ne-unit]').text()).toBe('kt')
    expect(wrapper.findAll('[data-ne-unit]').map((unit) => unit.text())).toEqual([
      'kt',
      'inHg',
      'nm',
    ])
  })

  it('right-aligns numeric headers and turns a sortKey column into a sort header', () => {
    const wrapper = render()
    const leaves = wrapper.findAll('thead tr[data-slot="tr"]')[1]!.findAll('th')
    expect(leaves.find((th) => th.text() === 'gust')!.classes()).toContain('text-end')
    expect(wrapper.findAll('[data-ne-sort-header]')).toHaveLength(1)
  })

  it('emits the next wire sort from a header click and never reorders rows itself', async () => {
    const wrapper = render()
    await wrapper.get('[data-ne-sort-header] button').trigger('click')
    expect(wrapper.emitted('update:sort')).toEqual([['wind:desc']])
    expect(bodyRows(wrapper).map((row) => row.find('td').text())).toEqual([
      '1:50 PM',
      '12:50 PM',
      '6:50 PM',
    ])
  })
})

describe('NeDataTable: cells', () => {
  it('draws missing as an em dash with "No value" for a screen reader, and 0 as 0', () => {
    const wrapper = render()
    const [, second, third] = bodyRows(wrapper)
    expect(cellTexts(second!)[1]).toBe('0')
    const missing = third!.findAll('td')[1]!.get('[data-ne-missing]')
    expect(missing.get('[aria-hidden="true"]').text()).toBe('—')
    expect(missing.get('.sr-only').text()).toBe('No value')
  })

  it('formats present values only, right-aligned in tabular mono, headline at emphasis', () => {
    const wrapper = render()
    const cells = bodyRows(wrapper)[0]!.findAll('td')
    expect(cells[3]!.text()).toBe('30.08')
    expect(cells[1]!.classes()).toEqual(
      expect.arrayContaining(['text-end', 'font-mono', 'tabular-nums', 'font-medium']),
    )
    expect(cells[2]!.classes()).not.toContain('font-medium')
  })

  it('hands a <key>-cell slot the row and value', () => {
    const wrapper = render({}, { 'gust-cell': '<b data-gust>g{{ value }}</b>' })
    expect(wrapper.find('[data-gust]').text()).toBe('g16')
  })

  it('pins sticky columns to the left edge', () => {
    const wrapper = render()
    expect(bodyRows(wrapper)[0]!.find('td').attributes('data-pinned')).toBe('left')
  })

  it('drops a column empty for the whole window when asked', () => {
    expect(render().text()).toContain('vis')
    expect(render({ dropEmptyColumns: true }).text()).not.toContain('vis')
  })
})

describe('NeDataTable: group and break rows', () => {
  it('opens a day row whenever the group key changes, spanning every column', () => {
    const wrapper = render({
      groupBy: (row: Reading) => row.day,
      groupLabel: (key: string, members: readonly Reading[]) => `${key} · ${members.length} readings`,
    })
    const labels = wrapper.findAll('[data-ne-group-row]').map((cell) => cell.text())
    expect(labels).toEqual(['Fri, Sep 18 · 2 readings', 'Thu, Sep 17 · 1 readings'])

    const groupRow = bodyRows(wrapper)[0]!
    const [first, ...rest] = groupRow.findAll('td')
    expect(first!.attributes('colspan')).toBe('5')
    for (const cell of rest) expect(cell.classes()).toContain('hidden')
  })

  it('lets a group slot replace the label', () => {
    const wrapper = render(
      { groupBy: (row: Reading) => row.day },
      { group: '<i data-day>{{ key }}!</i>' },
    )
    expect(wrapper.findAll('[data-day]').map((node) => node.text())).toEqual([
      'Fri, Sep 18!',
      'Thu, Sep 17!',
    ])
  })

  it('draws the break row before the first row with no value in the sorted column', () => {
    const wrapper = render({ missingCount: 142, sort: 'wind:desc' })
    const texts = bodyRows(wrapper).map((row) => row.find('td').text())
    expect(texts[2]).toBe('142 rows have no avg value · sorted last')
    expect(texts[3]).toBe('6:50 PM')
  })

  it('counts the page when no set-wide count is given, and honours missingLabel', () => {
    expect(render({ sort: 'wind:asc' }).get('[data-ne-break-row]').text()).toBe(
      '1 row has no avg value · sorted last',
    )
    expect(
      render({ missingLabel: 'No wind reading', sort: 'wind:asc' }).get('[data-ne-break-row]').text(),
    ).toBe('No wind reading')
  })

  it('draws no break row unsorted, sorted by another key, or with missingLast off', () => {
    expect(render().find('[data-ne-break-row]').exists()).toBe(false)
    expect(render({ sort: 'name:asc' }).find('[data-ne-break-row]').exists()).toBe(false)
    expect(
      render({ missingLast: false, sort: 'wind:desc' }).find('[data-ne-break-row]').exists(),
    ).toBe(false)
  })

  it('tints the sorted column and only that one', () => {
    const cells = render({ sort: 'wind:desc' }).findAll('tbody tr')[0]!.findAll('td')
    expect(cells[1]!.classes()).toContain('bg-elevated/50')
    expect(cells[2]!.classes()).not.toContain('bg-elevated/50')
  })
})

describe('NeDataTable: phone column sets', () => {
  it('shows the switch with two or more groups and hides the other groups below sm', () => {
    const wrapper = render()
    expect(wrapper.find('[data-ne-column-sets]').exists()).toBe(true)
    const cells = bodyRows(wrapper)[0]!.findAll('td')
    expect(cells[0]!.classes()).not.toContain('max-sm:hidden') // sticky
    expect(cells[1]!.classes()).not.toContain('max-sm:hidden') // wind, the first set
    expect(cells[3]!.classes()).toContain('max-sm:hidden') // pressure
    expect(cells[4]!.classes()).not.toContain('max-sm:hidden') // ungrouped
  })

  it('follows v-model:column-set and emits a switch', async () => {
    const wrapper = render({ columnSet: 'pressure' })
    const cells = bodyRows(wrapper)[0]!.findAll('td')
    expect(cells[1]!.classes()).toContain('max-sm:hidden')
    expect(cells[3]!.classes()).not.toContain('max-sm:hidden')

    await wrapper.findAll('[data-ne-column-sets] button')[0]!.trigger('mousedown')
    await wrapper.findAll('[data-ne-column-sets] button')[0]!.trigger('click')
    expect(wrapper.emitted('update:columnSet')?.at(-1)).toEqual(['wind'])
  })

  it('has no switch with one group, or when turned off', () => {
    const oneGroup = columns.filter((column) => column.group !== 'pressure')
    expect(render({ columns: oneGroup }).find('[data-ne-column-sets]').exists()).toBe(false)
    expect(render({ phoneColumnSets: false }).find('[data-ne-column-sets]').exists()).toBe(false)
  })
})

describe('NeDataTable: loading', () => {
  it('keeps the rows, dims them under a 2px bar, and marks the table busy', () => {
    const wrapper = render({ loading: true })
    expect(bodyRows(wrapper)).toHaveLength(3)
    expect(wrapper.get('[data-ne-data-table]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('tbody').classes()).toContain('opacity-50')
    expect(wrapper.get('thead').classes()).toContain('after:h-0.5')
  })

  it('is not busy at rest', () => {
    const wrapper = render()
    expect(wrapper.get('[data-ne-data-table]').attributes('aria-busy')).toBeUndefined()
    expect(wrapper.get('tbody').classes()).not.toContain('opacity-50')
  })
})
