import { describe, expect, it } from 'vitest'

import { NardukPostgresError } from '../src/errors.js'
import {
  DEFAULT_PARAMETER_BUDGET,
  POSTGRES_MAX_BIND_PARAMETERS,
  assertParameterBudget,
  chunkRowsByParameterBudget,
  maxRowsPerStatement,
  placeholderTuples,
  placeholderTuplesWithCasts,
} from '../src/parameters.js'

describe('bound-parameter budget', () => {
  it('states the protocol ceiling and a default budget below it', () => {
    expect(POSTGRES_MAX_BIND_PARAMETERS).toBe(65_535)
    expect(DEFAULT_PARAMETER_BUDGET).toBe(32_768)
    expect(DEFAULT_PARAMETER_BUDGET).toBeLessThan(POSTGRES_MAX_BIND_PARAMETERS)
  })

  it('refuses a budget above the protocol ceiling', () => {
    expect(() => assertParameterBudget(POSTGRES_MAX_BIND_PARAMETERS + 1)).toThrow(
      NardukPostgresError,
    )
    expect(() => assertParameterBudget(0)).toThrow(/PARAMETER_BUDGET_INVALID/u)
    expect(() => assertParameterBudget(1.5)).toThrow(/PARAMETER_BUDGET_INVALID/u)
  })

  it('derives rows per statement from the row width', () => {
    expect(maxRowsPerStatement(6)).toBe(Math.floor(32_768 / 6))
    expect(maxRowsPerStatement(8, 100)).toBe(12)
    expect(maxRowsPerStatement(1, 1)).toBe(1)
  })

  it('refuses a row wider than the whole budget', () => {
    expect(() => maxRowsPerStatement(200, 100)).toThrow(/PARAMETER_BUDGET_EXCEEDED/u)
  })

  it('chunks so that no chunk can exceed the budget', () => {
    const rows = Array.from({ length: 25 }, (_, index) => index)
    const chunks = chunkRowsByParameterBudget(rows, 8, 100)
    expect(chunks.map((chunk) => chunk.length)).toEqual([12, 12, 1])
    for (const chunk of chunks) expect(chunk.length * 8).toBeLessThanOrEqual(100)
    expect(chunks.flat()).toEqual(rows)
  })

  it('returns no chunks for no rows', () => {
    expect(chunkRowsByParameterBudget([], 6)).toEqual([])
  })

  // The chunk count has to be a pure function of the three inputs, because the
  // write path's statement count is asserted from it in the scale tests.
  it('chunk count is ceil(rows / rowsPerStatement) for every width', () => {
    for (const parametersPerRow of [1, 2, 6, 8, 17]) {
      const perStatement = maxRowsPerStatement(parametersPerRow, 1000)
      for (const rowCount of [0, 1, perStatement, perStatement + 1, perStatement * 3 + 2]) {
        const rows = Array.from({ length: rowCount }, (_, index) => index)
        expect(chunkRowsByParameterBudget(rows, parametersPerRow, 1000)).toHaveLength(
          Math.ceil(rowCount / perStatement),
        )
      }
    }
  })
})

describe('placeholder rendering', () => {
  it('renders dense tuples from $1', () => {
    expect(placeholderTuples(3, 2)).toBe('($1, $2), ($3, $4), ($5, $6)')
  })

  it('continues from an offset', () => {
    expect(placeholderTuples(2, 2, 5)).toBe('($5, $6), ($7, $8)')
  })

  it('refuses to render past the protocol ceiling', () => {
    expect(() => placeholderTuples(65_536, 1)).toThrow(/PARAMETER_BUDGET_EXCEEDED/u)
  })

  it('casts each column so a VALUES list in a CTE resolves its types', () => {
    expect(placeholderTuplesWithCasts(2, ['uuid', 'text'])).toBe(
      '($1::uuid, $2::text), ($3::uuid, $4::text)',
    )
  })

  it('keeps the cast cycle aligned across an offset', () => {
    expect(placeholderTuplesWithCasts(1, ['uuid', 'text', 'int'], 4)).toBe(
      '($4::uuid, $5::text, $6::int)',
    )
  })
})
