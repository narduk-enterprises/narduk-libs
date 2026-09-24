/**
 * The NeDataTable demo's fixture, its URL state and its row order: plain
 * functions, so the page, the frame and the unit tests share one definition.
 *
 * URL state is the whole contract of a shareable demo. Parsing is strict and
 * total: every supported parameter is validated against the real set of
 * values, anything else falls back to the default, and serialising a parsed
 * state gives one canonical query, so two URLs for the same state compare
 * equal and a malformed link is rewritten rather than half-applied.
 */

export interface Reading {
  station: string
  /** ISO date: the group key, and what chronological order compares. */
  date: string
  wind: number | null
  gust: number | null
  waves: number | null
  pressure: number | null
}

export const READINGS: readonly Reading[] = [
  { station: 'Port Aransas', date: '2026-09-18', wind: 14, gust: 16, waves: 3.0, pressure: 30.08 },
  { station: 'Port Isabel', date: '2026-09-18', wind: 10, gust: 12, waves: 3.0, pressure: 30.11 },
  {
    station: 'Aransas Bay',
    date: '2026-09-18',
    wind: null,
    gust: null,
    waves: 2.1,
    pressure: 30.1,
  },
  { station: 'Bob Hall Pier', date: '2026-09-17', wind: 16, gust: 19, waves: 3.9, pressure: 30.09 },
  { station: 'Galveston', date: '2026-09-17', wind: 8, gust: null, waves: null, pressure: 30.02 },
  { station: 'Sabine Pass', date: '2026-09-17', wind: 21, gust: 27, waves: 4.6, pressure: 29.94 },
  { station: 'Freeport', date: '2026-09-16', wind: 12, gust: 15, waves: 2.8, pressure: 30.05 },
]

/** Fixed labels, so a prerendered page and the browser agree on every byte. */
export const DAY_LABELS: Readonly<Record<string, string>> = {
  '2026-09-18': 'Fri, Sep 18',
  '2026-09-17': 'Thu, Sep 17',
  '2026-09-16': 'Wed, Sep 16',
}

export const SORT_KEYS = ['station', 'wind', 'gust', 'waves', 'pressure'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

/** The phone column sets: the table's column groups. */
export const COLUMN_SETS = ['wind', 'waves', 'pressure'] as const
export type ColumnSet = (typeof COLUMN_SETS)[number]

export interface TableState {
  sort: { key: SortKey; direction: SortDirection } | null
  grouped: boolean
  loading: boolean
  empty: boolean
  /** `null` is the table's own default: the first group. */
  set: ColumnSet | null
}

export const DEFAULT_TABLE_STATE: Readonly<TableState> = Object.freeze({
  sort: null,
  grouped: false,
  loading: false,
  empty: false,
  set: null,
})

/** The query parameters this demo owns, in canonical order. */
export const TABLE_PARAMETERS = ['sort', 'grouped', 'loading', 'empty', 'set'] as const

export type QueryValue = string | null | undefined | readonly (string | null)[]
export type QueryInput = Readonly<Record<string, QueryValue>>

/**
 * One parameter's value. A repeated parameter (`?sort=a&sort=b`) is read by
 * its first occurrence, whatever the later ones say.
 */
export function firstValue(value: QueryValue): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' ? value : null
}

function includes<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value)
}

export function parseSort(value: string | null): TableState['sort'] {
  const [key = null, direction = null, ...rest] = value?.split(':') ?? []
  if (rest.length > 0 || !includes(SORT_KEYS, key)) return null
  if (direction !== 'asc' && direction !== 'desc') return null
  return { key, direction }
}

/** A flag is on only as exactly `1`. */
function flag(value: string | null): boolean {
  return value === '1'
}

export function parseTableQuery(query: QueryInput): TableState {
  const set = firstValue(query.set)
  return {
    sort: parseSort(firstValue(query.sort)),
    grouped: flag(firstValue(query.grouped)),
    loading: flag(firstValue(query.loading)),
    empty: flag(firstValue(query.empty)),
    set: includes(COLUMN_SETS, set) ? set : null,
  }
}

export function sortWire(state: Pick<TableState, 'sort'>): string | null {
  return state.sort ? `${state.sort.key}:${state.sort.direction}` : null
}

/** The canonical query for a state: defaults and unknown parameters are omitted. */
export function tableQuery(state: TableState): Record<string, string> {
  const query: Record<string, string> = {}
  const sort = sortWire(state)
  if (sort) query.sort = sort
  if (state.grouped) query.grouped = '1'
  if (state.loading) query.loading = '1'
  if (state.empty) query.empty = '1'
  // The first set is the default: `set=wind` and no `set` are one state.
  if (state.set && state.set !== COLUMN_SETS[0]) query.set = state.set
  return query
}

/**
 * The rows in display order, which is also the CSV order.
 *
 * Sorting puts rows with no value last in both directions and keeps the
 * fixture order among ties. Grouping then orders days newest first with a
 * stable sort, so each day keeps the sorted order inside it, and a row with no
 * value is last within its own day.
 */
export function orderReadings(rows: readonly Reading[], state: TableState): Reading[] {
  if (state.empty) return []
  const ordered = [...rows]
  const sort = state.sort
  if (sort) {
    const sign = sort.direction === 'desc' ? -1 : 1
    ordered.sort((left, right) => {
      const a = left[sort.key]
      const b = right[sort.key]
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
      const order =
        typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      return order * sign
    })
  }
  if (state.grouped) ordered.sort((left, right) => right.date.localeCompare(left.date))
  return ordered
}

/**
 * The count for the table's "no value, sorted last" divider. Only an
 * ungrouped sort has one divider that is true for the whole list; grouped, the
 * missing rows sit at the end of each day and the demo says so instead.
 */
export function missingCount(rows: readonly Reading[], state: TableState): number | null {
  if (!state.sort || state.grouped) return null
  const key = state.sort.key
  return rows.filter((row) => row[key] === null).length
}
