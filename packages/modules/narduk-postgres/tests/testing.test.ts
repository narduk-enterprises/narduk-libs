import { describe, expect, it } from 'vitest'

import { POSTGRES_MAX_BIND_PARAMETERS } from '../src/parameters.js'
import { createProtocolFake } from '../src/testing.js'

describe('the protocol fake enforces the Bind message rules', () => {
  it('rejects a parameter count that does not match the highest placeholder', async () => {
    const fake = createProtocolFake()
    await expect(fake.query('SELECT $1, $2', ['a'])).rejects.toThrow(
      /supplies 1 parameters, but the statement requires 2/u,
    )
    await expect(fake.query('SELECT $1', ['a', 'b'])).rejects.toThrow(/PROTOCOL_VIOLATION/u)
  })

  it('rejects a gap in the placeholder sequence', async () => {
    const fake = createProtocolFake()
    await expect(fake.query('SELECT $1, $3', ['a', 'b', 'c'])).rejects.toThrow(/never \$2/u)
  })

  it('rejects a value the wire protocol cannot encode', async () => {
    const fake = createProtocolFake()
    await expect(fake.query('SELECT $1', [undefined])).rejects.toThrow(/not encodable/u)
    await expect(fake.query('SELECT $1', [Symbol('x')])).rejects.toThrow(/PROTOCOL_VIOLATION/u)
    await expect(fake.query('SELECT $1', [null])).resolves.toBeDefined()
  })

  it('rejects a statement past the 16-bit parameter ceiling', async () => {
    const fake = createProtocolFake()
    const params = Array.from({ length: POSTGRES_MAX_BIND_PARAMETERS + 1 }, () => 1)
    await expect(fake.query('SELECT 1', params)).rejects.toThrow(/at most 65535 parameters/u)
  })

  it('records statements, parameter counts and matching counts', async () => {
    const fake = createProtocolFake()
    await fake.query('INSERT INTO t VALUES ($1, $2)', [1, 2])
    await fake.query('INSERT INTO t VALUES ($1)', [3])
    await fake.query('SELECT 1')
    expect(fake.parameterCounts).toEqual([2, 1, 0])
    expect(fake.maxParameters).toBe(2)
    expect(fake.countMatching(/^INSERT INTO t/u)).toBe(2)
    fake.reset()
    expect(fake.statements).toHaveLength(0)
  })

  it('brackets a transaction and rolls back on failure', async () => {
    const fake = createProtocolFake()
    await fake.transaction(async (tx) => {
      await tx.query('SELECT 1')
    })
    expect(fake.texts).toEqual(['BEGIN', 'SELECT 1', 'COMMIT'])

    fake.reset()
    await expect(
      fake.transaction(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(fake.texts).toEqual(['BEGIN', 'ROLLBACK'])
  })

  it('answers from the first matching rule and returns no rows otherwise', async () => {
    const fake = createProtocolFake({
      responses: [{ match: /FROM series/u, rows: (params) => [{ echoed: params[0] }] }],
    })
    await expect(fake.query('SELECT * FROM series WHERE vessel_id = $1', ['v1'])).resolves.toEqual({
      rowCount: 1,
      rows: [{ echoed: 'v1' }],
    })
    await expect(fake.query('SELECT 1')).resolves.toEqual({ rowCount: 0, rows: [] })
  })
})
