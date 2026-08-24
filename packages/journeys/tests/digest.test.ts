import { describe, expect, it } from 'vitest'

import { digestFiles } from '../src/digest.js'

describe('digestFiles', () => {
  it('is stable across insertion order', () => {
    const first = digestFiles(
      new Map([
        ['a.ts', 'one'],
        ['b.ts', 'two'],
      ]),
    )
    const second = digestFiles(
      new Map([
        ['b.ts', 'two'],
        ['a.ts', 'one'],
      ]),
    )
    expect(first).toBe(second)
  })

  it('changes when content or path changes', () => {
    const base = digestFiles(new Map([['a.ts', 'one']]))
    expect(digestFiles(new Map([['a.ts', 'two']]))).not.toBe(base)
    expect(digestFiles(new Map([['b.ts', 'one']]))).not.toBe(base)
  })
})
