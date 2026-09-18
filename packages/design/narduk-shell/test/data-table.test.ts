/*
 * The data-table family's pure helpers (narduk-libs#528): the missing-value
 * rule, the wire sort, the first-click rule and the CSV writer. The package
 * root re-exports `toCsv` and `parseSort`, so they are asserted from there.
 */
import { describe, expect, it } from 'vitest'

import { parseSort, toCsv } from '../src/index'
import {
  csvHeader,
  isMissingValue,
  nextSortDirection,
  readColumnValue,
} from '../src/runtime/utils/data-table'

import type { NeDataColumn } from '../src/index'

describe('isMissingValue', () => {
  it('treats 0 and false as values, and nothing-like values as missing', () => {
    for (const value of [0, false, 'x', new Date(0)]) expect(isMissingValue(value)).toBe(false)
    for (const value of [null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY, new Date('x')])
      expect(isMissingValue(value)).toBe(true)
  })
})

describe('parseSort / nextSortDirection', () => {
  it('reads the list-query wire form and rejects anything else', () => {
    expect(parseSort('wind:desc')).toEqual({ direction: 'desc', key: 'wind' })
    expect(parseSort(' name:asc ')).toEqual({ direction: 'asc', key: 'name' })
    for (const bad of [null, undefined, '', 'wind', 'wind:up', ':asc', 'a:b:asc']) {
      expect(parseSort(bad)).toBeNull()
    }
  })

  it('first click picks the useful way, later clicks flip, and there is no unsorted step', () => {
    expect(nextSortDirection(false, 'desc')).toBe('desc')
    expect(nextSortDirection('desc', 'desc')).toBe('asc')
    expect(nextSortDirection('asc', 'desc')).toBe('desc')
    expect(nextSortDirection(false, 'asc')).toBe('asc')
  })
})

describe('readColumnValue', () => {
  it('prefers the accessor and falls back to row[key]', () => {
    expect(readColumnValue({ key: 'a', label: 'A' }, { a: 1 })).toBe(1)
    expect(readColumnValue({ key: 'a', label: 'A', value: () => 2 }, { a: 1 })).toBe(2)
    expect(readColumnValue({ key: 'a', label: 'A' }, null)).toBeUndefined()
  })
})

describe('toCsv', () => {
  interface Row {
    note: string | null
    time: Date
    wind: number | null
  }
  const columns: NeDataColumn<Row>[] = [
    { key: 'time', label: 'Time' },
    { key: 'wind', label: 'Wind', unit: 'kt', format: () => 'never used' },
    {
      key: 'windMs',
      label: 'Wind',
      unit: 'm/s',
      csvOnly: true,
      csv: (r) => (r.wind ? r.wind / 2 : null),
    },
    { key: 'note', label: 'Note' },
    { key: 'hidden', label: 'Hidden', csv: false },
  ]

  it('writes exactly the rows given, raw values, missing as empty, CRLF, with a preamble', () => {
    const text = toCsv(
      columns,
      [
        { note: 'calm, "light"', time: new Date('2026-09-18T18:50:00Z'), wind: 14 },
        { note: null, time: new Date('2026-09-18T17:50:00Z'), wind: null },
      ],
      ['Source: NOAA NDBC'],
    )

    expect(text).toBe(
      [
        'Source: NOAA NDBC',
        'Time,Wind (kt),Wind (m/s),Note',
        '2026-09-18T18:50:00.000Z,14,7,"calm, ""light"""',
        '2026-09-18T17:50:00.000Z,,,',
        '',
      ].join('\r\n'),
    )
  })

  it('neutralises a text cell a spreadsheet would run as a formula, but not a negative number', () => {
    const text = toCsv<Row>(
      [
        { key: 'note', label: 'Note' },
        { key: 'wind', label: 'Change' },
      ],
      [{ note: '=HYPERLINK("x")', time: new Date(0), wind: -0.05 }],
    )
    expect(text.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")",-0.05`)
  })

  it('uses csvLabel over label and unit', () => {
    expect(csvHeader({ csvLabel: 'wspd_kt', key: 'w', label: 'Wind', unit: 'kt' })).toBe('wspd_kt')
  })
})
