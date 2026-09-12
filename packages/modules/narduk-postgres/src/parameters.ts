/**
 * Bound-parameter budgeting.
 *
 * The PostgreSQL v3 wire protocol encodes a Bind message's parameter count as a
 * signed-then-unsigned 16-bit integer: 65535 is a hard ceiling, and a driver
 * that exceeds it fails at encode time with an error that names neither the
 * batch nor the row. A batched writer that sizes its multi-row INSERT from the
 * caller's array length -- not from the protocol -- therefore works in every
 * test and breaks on the first busy minute.
 *
 * That failure is not hypothetical here. mybo-at-v2 shipped a 500-parameter
 * SQLite upsert into a Durable Object whose real ceiling is 100, and every batch
 * 500ed until it was chunked (mybo-at-v2#83). The lesson carried across: the
 * ceiling belongs in the library, the chunking is not optional, and the number
 * is stated rather than assumed.
 *
 * `DEFAULT_PARAMETER_BUDGET` is half the protocol ceiling on purpose. It leaves
 * room for a driver that appends its own parameters, keeps a single statement's
 * text inside a size a pooler will forward without fragmenting, and makes the
 * per-statement row count a round, reasoned number instead of a maximum.
 */

import { NardukPostgresError } from './errors.js'

/** The protocol's own limit. Nothing may exceed this. */
export const POSTGRES_MAX_BIND_PARAMETERS = 65_535

/** This package's default working budget: half the ceiling. */
export const DEFAULT_PARAMETER_BUDGET = 32_768

export function assertParameterBudget(budget: number): number {
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_INVALID',
      'The parameter budget must be a positive integer.',
      { budget },
    )
  }
  if (budget > POSTGRES_MAX_BIND_PARAMETERS) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_EXCEEDED',
      `The parameter budget must not exceed the protocol ceiling of ${POSTGRES_MAX_BIND_PARAMETERS}.`,
      { budget, ceiling: POSTGRES_MAX_BIND_PARAMETERS },
    )
  }
  return budget
}

export function assertParametersPerRow(parametersPerRow: number): number {
  if (!Number.isInteger(parametersPerRow) || parametersPerRow <= 0) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_INVALID',
      'parametersPerRow must be a positive integer.',
      { parametersPerRow },
    )
  }
  return parametersPerRow
}

/** How many rows one statement may carry at this row width. Never zero. */
export function maxRowsPerStatement(
  parametersPerRow: number,
  budget: number = DEFAULT_PARAMETER_BUDGET,
): number {
  assertParameterBudget(budget)
  assertParametersPerRow(parametersPerRow)
  if (parametersPerRow > budget) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_EXCEEDED',
      `A single row needs ${parametersPerRow} parameters, which exceeds the budget of ${budget}.`,
      { budget, parametersPerRow },
    )
  }
  return Math.floor(budget / parametersPerRow)
}

/**
 * Split rows into statement-sized chunks. The chunk count is a pure function of
 * `(rows.length, parametersPerRow, budget)`, which is what makes the write
 * path's statement count predictable enough to assert in a scale test.
 */
export function chunkRowsByParameterBudget<Row>(
  rows: readonly Row[],
  parametersPerRow: number,
  budget: number = DEFAULT_PARAMETER_BUDGET,
): Row[][] {
  const perStatement = maxRowsPerStatement(parametersPerRow, budget)
  const chunks: Row[][] = []
  for (let index = 0; index < rows.length; index += perStatement) {
    chunks.push(rows.slice(index, index + perStatement))
  }
  return chunks
}

/** `($1, $2), ($3, $4)` -- placeholders only, values never reach the text. */
export function placeholderTuples(
  rowCount: number,
  parametersPerRow: number,
  startIndex = 1,
): string {
  assertParametersPerRow(parametersPerRow)
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_INVALID',
      'rowCount must be a positive integer.',
      { rowCount },
    )
  }
  if (!Number.isInteger(startIndex) || startIndex <= 0) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_INVALID',
      'startIndex must be a positive integer.',
      { startIndex },
    )
  }

  const total = rowCount * parametersPerRow
  const last = startIndex + total - 1
  if (last > POSTGRES_MAX_BIND_PARAMETERS) {
    throw new NardukPostgresError(
      'PARAMETER_BUDGET_EXCEEDED',
      `Placeholder $${last} exceeds the protocol ceiling of ${POSTGRES_MAX_BIND_PARAMETERS}.`,
      { ceiling: POSTGRES_MAX_BIND_PARAMETERS, highestPlaceholder: last },
    )
  }

  const tuples: string[] = []
  for (let row = 0; row < rowCount; row += 1) {
    const base = startIndex + row * parametersPerRow
    const placeholders: string[] = []
    for (let column = 0; column < parametersPerRow; column += 1) {
      placeholders.push(`$${base + column}`)
    }
    tuples.push(`(${placeholders.join(', ')})`)
  }
  return tuples.join(', ')
}

/**
 * Same as `placeholderTuples`, but each column carries an explicit cast. A
 * multi-row VALUES list feeding a CTE has no target column to infer types
 * from, so without the casts PostgreSQL resolves everything to `text` and the
 * join against a `uuid` column fails at plan time rather than at review time.
 */
export function placeholderTuplesWithCasts(
  rowCount: number,
  casts: readonly string[],
  startIndex = 1,
): string {
  const parametersPerRow = casts.length
  assertParametersPerRow(parametersPerRow)
  const plain = placeholderTuples(rowCount, parametersPerRow, startIndex)
  let column = 0
  return plain.replaceAll(/\$\d+/gu, (placeholder) => {
    const cast = casts[column % parametersPerRow]
    column += 1
    return `${placeholder}::${cast}`
  })
}
