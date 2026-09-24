import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_TABLE_STATE,
  missingCount,
  orderReadings,
  parseTableQuery,
  READINGS,
  tableQuery,
  type TableState,
} from './table.mts'

const state = (query: Record<string, string | string[]>): TableState => parseTableQuery(query)
const order = (query: Record<string, string>) =>
  orderReadings(READINGS, state(query)).map(({ station }) => station)

test('query parsing: every supported parameter, validated against real values', () => {
  assert.deepEqual(
    state({ sort: 'gust:desc', grouped: '1', loading: '1', empty: '1', set: 'waves' }),
    {
      sort: { key: 'gust', direction: 'desc' },
      grouped: true,
      loading: true,
      empty: true,
      set: 'waves',
    },
  )
  assert.deepEqual(state({}), DEFAULT_TABLE_STATE)
})

test('query parsing: malformed, unknown and repeated parameters are deterministic', () => {
  for (const sort of [
    'date:asc', // a real row property, but not a sortable column
    'constructor:asc',
    '__proto__:desc',
    'wind',
    'wind:',
    'wind:up',
    'wind:desc:extra',
    ':desc',
    '',
  ]) {
    assert.equal(state({ sort }).sort, null, sort)
  }
  assert.equal(state({ grouped: 'true' }).grouped, false)
  assert.equal(state({ grouped: '0' }).grouped, false)
  assert.equal(state({ set: 'station' }).set, null)
  assert.equal(state({ set: 'WIND' }).set, null)
  // Unknown parameters are ignored and dropped from the canonical query.
  assert.deepEqual(tableQuery(state({ sort: 'wind:desc', utm: 'x', width: 'phone' })), {
    sort: 'wind:desc',
  })
  // The first occurrence of a repeated parameter wins.
  assert.equal(state({ sort: ['wave:asc', 'wind:asc'] }).sort, null)
  assert.deepEqual(state({ sort: ['wind:asc', 'bogus'] }).sort, { key: 'wind', direction: 'asc' })
  assert.equal(state({ set: ['pressure', 'wind'] }).set, 'pressure')
})

test('canonical query round-trips and omits defaults', () => {
  const query = { sort: 'pressure:asc', grouped: '1', set: 'pressure' }
  assert.deepEqual(tableQuery(parseTableQuery(query)), query)
  assert.deepEqual(tableQuery(DEFAULT_TABLE_STATE), {})
  // The default column set is not written out.
  assert.deepEqual(tableQuery(parseTableQuery({ set: 'wind', sort: 'wind:asc' })), {
    sort: 'wind:asc',
  })
})

test('ungrouped numeric sorts: complete order, missing values last in both directions', () => {
  assert.deepEqual(order({ sort: 'gust:desc' }), [
    'Sabine Pass',
    'Bob Hall Pier',
    'Port Aransas',
    'Freeport',
    'Port Isabel',
    'Aransas Bay',
    'Galveston',
  ])
  assert.deepEqual(order({ sort: 'gust:asc' }), [
    'Port Isabel',
    'Freeport',
    'Port Aransas',
    'Bob Hall Pier',
    'Sabine Pass',
    'Aransas Bay',
    'Galveston',
  ])
  assert.deepEqual(order({ sort: 'waves:asc' }).at(-1), 'Galveston')
  assert.equal(missingCount(READINGS, state({ sort: 'gust:desc' })), 2)
  assert.equal(missingCount(READINGS, state({})), null)
})

test('grouped sorts: days newest first (chronological, not by label), missing last within a day', () => {
  assert.deepEqual(order({ grouped: '1', sort: 'gust:desc' }), [
    // Fri, Sep 18
    'Port Aransas',
    'Port Isabel',
    'Aransas Bay',
    // Thu, Sep 17
    'Sabine Pass',
    'Bob Hall Pier',
    'Galveston',
    // Wed, Sep 16 — "Wed" sorts after "Thu" and "Fri" as text; by date it is last
    'Freeport',
  ])
  assert.deepEqual(order({ grouped: '1', sort: 'gust:asc' }), [
    'Port Isabel',
    'Port Aransas',
    'Aransas Bay',
    'Bob Hall Pier',
    'Sabine Pass',
    'Galveston',
    'Freeport',
  ])
  // Grouped, there is no single divider that is true for the whole list.
  assert.equal(missingCount(READINGS, state({ grouped: '1', sort: 'gust:desc' })), null)
})

test('grouping without a sort keeps fixture order inside each day; empty shows nothing', () => {
  assert.deepEqual(
    order({ grouped: '1' }),
    READINGS.map(({ station }) => station),
  )
  assert.deepEqual(order({ empty: '1', sort: 'wind:desc' }), [])
})
