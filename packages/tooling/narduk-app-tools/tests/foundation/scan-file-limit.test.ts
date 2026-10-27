import { describe, expect, it } from 'vitest'
import { SCAN_FILE_LIMIT, scanAppSource } from '../../src/foundation/reimplementation-signals.js'
import type { AppRepo } from '../../src/foundation/source.js'

function fakeRepo(counts: Record<string, number>): AppRepo {
  const listing = (dir: string) =>
    Array.from({ length: counts[dir] ?? 0 }, (_, i) => `${dir}/f${i}.ts`)
  return {
    exists: (rel: string) => rel in counts,
    walk: (rel: string) => listing(rel),
    read: () => 'export {}',
  } as unknown as AppRepo
}

describe('scanAppSource file ceiling', () => {
  it('scans a 2106-file app (stonx) completely', () => {
    const scan = scanAppSource(fakeRepo({ app: 1500, server: 606 }))
    expect(scan.files).toHaveLength(2106)
    expect(scan.truncated).toBe(false)
  })

  it('stops at the ceiling and reports truncation once it is exceeded', () => {
    const scan = scanAppSource(fakeRepo({ app: SCAN_FILE_LIMIT, server: 5, src: 5 }))
    expect(scan.files).toHaveLength(SCAN_FILE_LIMIT)
    expect(scan.truncated).toBe(true)
  })
})
