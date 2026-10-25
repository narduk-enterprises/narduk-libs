import { describe, expect, it } from 'vitest'

import { makeRunId } from '../src/verify.js'

describe('ponytail-5 s6', () => {
  it('#16 two scenarios started in the same second get different attempt ids', () => {
    const at = new Date('2026-09-12T10:00:00.123Z')
    expect(makeRunId('abcdef0123', at, 'base')).not.toBe(makeRunId('abcdef0123', at, 'extra'))
    expect(makeRunId('abcdef0123', at, 'base')).not.toBe(
      makeRunId('abcdef0123', new Date('2026-09-12T10:00:00.456Z'), 'base'),
    )
    expect(makeRunId('abcdef0123', at, 'base')).toBe('20260912-100000123-abcdef01-base')
  })
})
