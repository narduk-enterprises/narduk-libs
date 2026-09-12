/**
 * A protocol-level fake, and an honest statement of what "protocol-level" means
 * here.
 *
 * **What it enforces** are the rules the PostgreSQL v3 Bind message actually
 * imposes, which are the rules a batched writer breaks first:
 *
 *  - a statement may bind at most 65535 parameters (the Bind message's count is
 *    a 16-bit field);
 *  - the number of bound parameters must equal the highest `$n` in the text --
 *    too few is `bind message supplies N parameters, but prepared statement
 *    requires M`, too many is just as fatal;
 *  - placeholders must be dense from `$1` (a gap means a builder dropped a
 *    column);
 *  - every bound value must be encodable: `undefined`, a function or a symbol
 *    is a driver-level TypeError in production and an assertion here.
 *
 * **What it does not do** is speak the wire protocol. There is no socket, no
 * startup packet, no type resolution, no server. It cannot tell you that a
 * `::uuid` cast will fail or that a column does not exist. Those need the live
 * integration suite, which is written and skipped until the estate has a
 * Postgres to point it at.
 *
 * Stating that boundary is the point: a fake that claimed more would turn a
 * green unit suite into a false claim about a database nobody has run yet.
 */

import { NardukPostgresError } from './errors.js'
import { POSTGRES_MAX_BIND_PARAMETERS } from './parameters.js'
import type { QueryResult, TransactionalExecutor } from './types.js'

export interface RecordedStatement {
  params: readonly unknown[]
  text: string
}

export interface ResponseRule {
  match: RegExp | ((text: string) => boolean)
  /** Rows to return, or a function of the bound parameters. */
  rows: unknown[] | ((params: readonly unknown[]) => unknown[])
}

export interface ProtocolFakeOptions {
  /** Rules are tried in order; the first match wins. Unmatched returns []. */
  responses?: ResponseRule[]
}

function highestPlaceholder(text: string): number {
  let highest = 0
  const seen = new Set<number>()
  for (const match of text.matchAll(/\$(\d+)/gu)) {
    const index = Number(match[1])
    seen.add(index)
    if (index > highest) highest = index
  }
  if (highest > 0) {
    for (let index = 1; index <= highest; index += 1) {
      if (!seen.has(index)) {
        throw new NardukPostgresError(
          'PROTOCOL_VIOLATION',
          `The statement references $${highest} but never $${index}. Placeholders must be dense from $1.`,
          { highest, missing: index },
        )
      }
    }
  }
  return highest
}

function assertEncodable(params: readonly unknown[]): void {
  params.forEach((value, index) => {
    const kind = typeof value
    if (value === undefined || kind === 'function' || kind === 'symbol') {
      throw new NardukPostgresError(
        'PROTOCOL_VIOLATION',
        `Parameter $${index + 1} is not encodable (${value === undefined ? 'undefined' : kind}). Use null for a SQL NULL.`,
        { index: index + 1 },
      )
    }
  })
}

export class ProtocolFake implements TransactionalExecutor {
  readonly statements: RecordedStatement[] = []

  #responses: ResponseRule[]

  #depth = 0

  constructor(options: ProtocolFakeOptions = {}) {
    this.#responses = [...(options.responses ?? [])]
  }

  /** Parameter counts in statement order -- the axis a ceiling test asserts. */
  get parameterCounts(): number[] {
    return this.statements.map((statement) => statement.params.length)
  }

  get maxParameters(): number {
    return this.parameterCounts.reduce((highest, count) => Math.max(highest, count), 0)
  }

  get texts(): string[] {
    return this.statements.map((statement) => statement.text)
  }

  /** Statements whose text matches, for counting one shape of write. */
  countMatching(pattern: RegExp): number {
    return this.statements.filter((statement) => pattern.test(statement.text)).length
  }

  respondTo(match: RegExp | ((text: string) => boolean), rows: ResponseRule['rows']): this {
    this.#responses.push({ match, rows })
    return this
  }

  reset(): void {
    this.statements.length = 0
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    if (params.length > POSTGRES_MAX_BIND_PARAMETERS) {
      throw new NardukPostgresError(
        'PROTOCOL_VIOLATION',
        `A Bind message carries at most ${POSTGRES_MAX_BIND_PARAMETERS} parameters; this statement binds ${params.length}.`,
        { bound: params.length, ceiling: POSTGRES_MAX_BIND_PARAMETERS },
      )
    }
    const required = highestPlaceholder(text)
    if (required !== params.length) {
      throw new NardukPostgresError(
        'PROTOCOL_VIOLATION',
        `Bind message supplies ${params.length} parameters, but the statement requires ${required}.`,
        { required, supplied: params.length },
      )
    }
    assertEncodable(params)

    this.statements.push({ params: [...params], text })

    for (const rule of this.#responses) {
      const matched =
        typeof rule.match === 'function' ? rule.match(text) : rule.match.test(text)
      if (!matched) continue
      const rows = (typeof rule.rows === 'function' ? rule.rows(params) : rule.rows) as Row[]
      return { rowCount: rows.length, rows }
    }
    return { rowCount: 0, rows: [] }
  }

  async transaction<T>(run: (tx: TransactionalExecutor) => Promise<T>): Promise<T> {
    this.#depth += 1
    await this.query(this.#depth === 1 ? 'BEGIN' : `SAVEPOINT narduk_${this.#depth}`)
    try {
      const result = await run(this)
      await this.query(this.#depth === 1 ? 'COMMIT' : `RELEASE SAVEPOINT narduk_${this.#depth}`)
      return result
    } catch (cause) {
      await this.query(
        this.#depth === 1 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT narduk_${this.#depth}`,
      )
      throw cause
    } finally {
      this.#depth -= 1
    }
  }
}

export function createProtocolFake(options: ProtocolFakeOptions = {}): ProtocolFake {
  return new ProtocolFake(options)
}
