import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { digestDirectory, digestFiles } from '../src/digest.js'

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

describe('digestDirectory', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  it('moves when a file of a megabyte or more changes (#118)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'journeys-digest-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'catalog.ts'), 'export const steps = []')
    writeFileSync(join(dir, 'seed.json'), Buffer.alloc(1_200_000, 'a'))
    const before = digestDirectory(dir)

    writeFileSync(join(dir, 'seed.json'), Buffer.alloc(1_200_000, 'b'))
    expect(digestDirectory(dir)).not.toBe(before)
  })
})
