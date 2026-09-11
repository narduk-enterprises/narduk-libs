import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  formatListSort,
  LIST_QUERY_DEFAULT_LIMIT,
  type ListQueryMode,
  listQuerySchema,
} from '../src/list-query'

const sortable = ['name', 'updatedAt'] as const

function issueCodes(error: z.ZodError | undefined): string[] {
  return (error?.issues ?? []).map((issue) => issue.code)
}

function issuePaths(error: z.ZodError | undefined): string[] {
  return (error?.issues ?? []).map((issue) => issue.path.join('.'))
}

describe('listQuerySchema — limit clamping', () => {
  const schema = listQuerySchema({ maxLimit: 100, sortable })

  it('clamps an over-large limit to maxLimit instead of rejecting it', () => {
    expect(schema.parse({ limit: '9999' }).limit).toBe(100)
  })

  it('coerces a string limit and keeps one under the ceiling', () => {
    expect(schema.parse({ limit: '20' }).limit).toBe(20)
  })

  it('falls back to the contract default when no limit is sent', () => {
    expect(schema.parse({}).limit).toBe(LIST_QUERY_DEFAULT_LIMIT)
  })

  it('clamps the route default to maxLimit as well', () => {
    const narrow = listQuerySchema({ defaultLimit: 50, maxLimit: 10, sortable })
    expect(narrow.parse({}).limit).toBe(10)
  })

  it('rejects a fractional, zero, negative or non-numeric limit', () => {
    for (const limit of ['2.7', '0', '-1', 'many', ['1', '2']]) {
      expect(schema.safeParse({ limit }).success).toBe(false)
    }
  })
})

describe('listQuerySchema — sort allowlist', () => {
  const schema = listQuerySchema({ maxLimit: 100, sortable })

  it('parses an allowlisted key and direction into its pair', () => {
    expect(schema.parse({ sort: 'updatedAt:desc' }).sort).toEqual({
      direction: 'desc',
      key: 'updatedAt',
    })
  })

  it('rejects a key outside the allowlist and names the field', () => {
    const result = schema.safeParse({ sort: 'passwordHash:asc' })

    expect(result.success).toBe(false)
    expect(issuePaths(result.error)).toEqual(['sort'])
    expect(result.error?.issues[0]?.message).toContain('name, updatedAt')
  })

  it('rejects a bad direction and a malformed pair', () => {
    expect(schema.safeParse({ sort: 'name:sideways' }).success).toBe(false)
    expect(schema.safeParse({ sort: 'name' }).success).toBe(false)
    expect(schema.safeParse({ sort: 'name:asc:extra' }).success).toBe(false)
    expect(schema.safeParse({ sort: '' }).success).toBe(false)
  })

  it('applies defaultSort only when the caller sends none', () => {
    const sorted = listQuerySchema({ defaultSort: 'name:asc', maxLimit: 100, sortable })

    expect(sorted.parse({}).sort).toEqual({ direction: 'asc', key: 'name' })
    expect(sorted.parse({ sort: 'updatedAt:desc' }).sort).toEqual({
      direction: 'desc',
      key: 'updatedAt',
    })
    expect(schema.parse({}).sort).toBeNull()
  })

  it('round-trips a parsed sort back to its wire form', () => {
    expect(formatListSort(schema.parse({ sort: 'name:asc' }).sort)).toBe('name:asc')
    expect(formatListSort(null)).toBeNull()
  })

  it('refuses any sort when the route allowlists none', () => {
    const unsorted = listQuerySchema({ maxLimit: 10, sortable: [] })

    expect(unsorted.parse({}).sort).toBeNull()
    expect(unsorted.safeParse({ sort: 'name:asc' }).success).toBe(false)
  })
})

describe('listQuerySchema — unknown keys', () => {
  const schema = listQuerySchema({ maxLimit: 100, sortable })

  it('rejects an unknown key rather than stripping it, and names the keys', () => {
    const result = schema.safeParse({ limit: '10', pge: '2', serach: 'abc' })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error)).toContain('unrecognized_keys')
    const unrecognized = result.error?.issues.find((issue) => issue.code === 'unrecognized_keys')
    expect(unrecognized && 'keys' in unrecognized ? unrecognized.keys : []).toEqual([
      'pge',
      'serach',
    ])
  })

  it("rejects the other mode's pagination key", () => {
    expect(schema.safeParse({ cursor: 'abc' }).success).toBe(false)

    const cursorSchema = listQuerySchema({ maxLimit: 100, mode: 'cursor', sortable })
    expect(cursorSchema.safeParse({ offset: '20' }).success).toBe(false)
  })
})

describe('listQuerySchema — filters', () => {
  const filters = z.object({
    ownerId: z.string().min(1).optional(),
    status: z.enum(['closed', 'open']).optional(),
  })
  const schema = listQuerySchema({ filters, maxLimit: 100, sortable })

  it('parses allowlisted filters into their own bag', () => {
    const parsed = schema.parse({ limit: '5', status: 'open' })

    expect(parsed.filters).toEqual({ status: 'open' })
    expect(parsed.limit).toBe(5)
  })

  it('rejects a filter value outside its schema and names the field', () => {
    const result = schema.safeParse({ status: 'archived' })

    expect(result.success).toBe(false)
    expect(issuePaths(result.error)).toEqual(['status'])
  })

  it('rejects an undeclared filter key (the strictness the caller asked for)', () => {
    expect(schema.safeParse({ statuss: 'open' }).success).toBe(false)
  })

  it('leaves filters empty when the route declares none', () => {
    expect(listQuerySchema({ maxLimit: 10, sortable }).parse({}).filters).toEqual({})
  })

  it('refuses to build a schema whose filter key shadows a reserved key', () => {
    expect(() =>
      listQuerySchema({ filters: z.object({ limit: z.string() }), maxLimit: 10, sortable }),
    ).toThrow(/reserved query keys: limit/u)
  })
})

describe('listQuerySchema — free-text q', () => {
  const schema = listQuerySchema({ maxLimit: 100, maxQueryLength: 8, sortable })

  it('trims q and treats a blank one as absent', () => {
    expect(schema.parse({ q: '  ada  ' }).q).toBe('ada')
    expect(schema.parse({ q: '   ' }).q).toBeNull()
    expect(schema.parse({}).q).toBeNull()
  })

  it('bounds q by length, measured after trimming', () => {
    expect(schema.parse({ q: ' 12345678 ' }).q).toBe('12345678')
    expect(schema.safeParse({ q: '123456789' }).success).toBe(false)
  })
})

describe('listQuerySchema — modes', () => {
  it('defaults offset mode to the first page and coerces the sent offset', () => {
    const schema = listQuerySchema({ maxLimit: 100, sortable })

    expect(schema.parse({})).toMatchObject({ mode: 'offset', offset: 0 })
    expect(schema.parse({ offset: '40' }).offset).toBe(40)
    expect(schema.safeParse({ offset: '-1' }).success).toBe(false)
    expect(schema.safeParse({ offset: '1.5' }).success).toBe(false)
  })

  it('carries an opaque cursor, null when the caller sent none', () => {
    const schema = listQuerySchema({ maxLimit: 100, mode: 'cursor', sortable })

    expect(schema.parse({})).toMatchObject({ cursor: null, mode: 'cursor' })
    expect(schema.parse({ cursor: 'eyJpZCI6MX0' }).cursor).toBe('eyJpZCI6MX0')
    expect(schema.safeParse({ cursor: '' }).success).toBe(false)
  })

  it('keeps exactly one pagination key per mode', () => {
    const offsetQuery = listQuerySchema({ maxLimit: 10, sortable }).parse({})
    const cursorQuery = listQuerySchema({ maxLimit: 10, mode: 'cursor', sortable }).parse({})

    expect(Object.hasOwn(offsetQuery, 'cursor')).toBe(false)
    expect(Object.hasOwn(cursorQuery, 'offset')).toBe(false)
  })
})

describe('listQuerySchema — construction guards', () => {
  it('rejects a non-positive or fractional maxLimit', () => {
    for (const maxLimit of [0, -1, 2.5, Number.NaN]) {
      expect(() => listQuerySchema({ maxLimit, sortable })).toThrow(/maxLimit/u)
    }
  })

  it('rejects a defaultSort the allowlist does not accept', () => {
    // TypeScript already rejects this literal; the cast proves the runtime
    // guard still fires for a caller who is not type-checked.
    const defaultSort = 'name:sideways' as 'name:asc'

    expect(() => listQuerySchema({ defaultSort, maxLimit: 10, sortable })).toThrow(/defaultSort/u)
  })

  it('accepts either declared mode', () => {
    const modes: ListQueryMode[] = ['cursor', 'offset']
    expect(modes).toHaveLength(2)
  })
})
