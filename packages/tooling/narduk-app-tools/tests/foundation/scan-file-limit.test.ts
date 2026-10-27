import { describe, expect, it, vi } from 'vitest'
import { SCAN_FILE_LIMIT, scanAppSource } from '../../src/foundation/reimplementation-signals.js'
import type { AppRepo } from '../../src/foundation/source.js'

function fakeRepo(counts: Record<string, number>) {
  const walk = vi.fn((rel: string) => listing(rel))
  const listing = (dir: string) =>
    Array.from({ length: counts[dir] ?? 0 }, (_, i) => `${dir}/f${i}.ts`)
  const repo = {
    exists: (rel: string) => rel in counts,
    walk,
    read: () => 'export {}',
  } as unknown as AppRepo
  return { repo, walk }
}

describe('scanAppSource file ceiling', () => {
  it('scans a 2106-file app (stonx) completely', () => {
    const scan = scanAppSource(fakeRepo({ app: 1500, server: 606 }).repo)
    expect(scan.files).toHaveLength(2106)
    expect(scan.truncated).toBe(false)
  })

  it('stops at the ceiling and reports truncation once it is exceeded', () => {
    const { repo, walk } = fakeRepo({ app: SCAN_FILE_LIMIT, server: 5, src: 5 })
    const scan = scanAppSource(repo)
    // `src` is the first directory past the limit; `server` is never walked.
    expect(walk.mock.calls.map(([rel]) => rel)).toEqual(['app', 'src'])
    expect(scan.files).toHaveLength(SCAN_FILE_LIMIT)
    expect(scan.truncated).toBe(true)
  })
})
