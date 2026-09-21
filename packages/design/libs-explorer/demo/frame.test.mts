import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  demoPart,
  frameRoutes,
  plainQuery,
  parseSurface,
  parseViewport,
  readFromFrame,
  readToFrame,
  sameQuery,
} from './frame.mts'

test('viewport and surface parameters fall back deterministically', () => {
  assert.equal(parseViewport('phone'), 'phone')
  assert.equal(parseViewport('tablet'), 'tablet')
  for (const value of [null, '', 'full', 'PHONE', 'desktop'])
    assert.equal(parseViewport(value), 'full')
  assert.equal(parseSurface('card'), 'card')
  assert.equal(parseSurface('nope'), null)
})

test('messages are validated field by field', () => {
  assert.deepEqual(readFromFrame({ type: 'explorer:height', surface: 'demo', height: 320 }), {
    type: 'explorer:height',
    surface: 'demo',
    height: 320,
  })
  assert.equal(readFromFrame({ type: 'explorer:height', surface: 'demo', height: 'x' }), null)
  assert.equal(readFromFrame({ type: 'explorer:state', surface: 'demo', cause: 'user' }), null)
  assert.equal(
    readFromFrame({ type: 'explorer:state', surface: 'demo', cause: 'x', query: {} }),
    null,
  )
  assert.equal(readFromFrame({ type: 'explorer:ready', surface: 'window' }), null)
  assert.equal(readFromFrame('explorer:ready'), null)
  assert.deepEqual(readToFrame({ type: 'explorer:theme', scheme: 'dark' }), {
    type: 'explorer:theme',
    scheme: 'dark',
  })
  assert.equal(readToFrame({ type: 'explorer:theme', scheme: 'system' }), null)
  assert.equal(readToFrame({ type: 'explorer:query', query: { sort: 1 } }), null)
})

test('the demo part of a page query drops page parameters and repeats', () => {
  assert.deepEqual(demoPart({ width: 'phone', sort: ['wind:asc', 'x'], grouped: '1' }), {
    sort: 'wind:asc',
    grouped: '1',
  })
  assert.ok(sameQuery({ a: '1', b: '2' }, { b: '2', a: '1' }))
  assert.ok(!sameQuery({ a: '1' }, { a: '1', b: '2' }))
})

test('frame routes: demo only when interactive, card only when there is one, usage always', () => {
  assert.deepEqual(
    frameRoutes([
      { id: 'ne-data-table', interactive: true, card: 'NeDataTable' },
      { id: 'formatters', interactive: false, card: null },
    ]),
    [
      '/frame/ne-data-table/demo',
      '/frame/ne-data-table/usage',
      '/frame/ne-data-table/card',
      '/frame/formatters/usage',
    ],
  )
})

test('a repeated or valueless parameter makes a query non-canonical', () => {
  assert.deepEqual(plainQuery({ sort: 'wind:asc', width: 'phone' }), {
    sort: 'wind:asc',
    width: 'phone',
  })
  assert.equal(plainQuery({ sort: ['wind:asc', 'gust:desc'] }), null)
  assert.equal(plainQuery({ grouped: null }), null)
  assert.deepEqual(plainQuery({}), {})
})
