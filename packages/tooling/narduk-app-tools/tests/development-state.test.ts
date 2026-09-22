import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireTargetLocks,
  readPrivateJson,
  targetLockPath,
  writePrivateJson,
} from '../src/development-state.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dev-state-'))
  roots.push(root)
  return root
}
const target = { accountId: 'a'.repeat(32), workerName: 'example' }

describe('private host state and cooperative target locks', () => {
  it('atomically replaces private receipts', () => {
    const path = join(fixture(), 'receipts', 'attempt.json')
    writePrivateJson(path, { phase: 'promotion-intent' })
    writePrivateJson(path, { phase: 'verified' })
    expect(readPrivateJson(path)).toEqual({ phase: 'verified' })
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
  it('serializes all writers and refuses old or incomplete locks', () => {
    const root = fixture()
    const first = acquireTargetLocks([target], 'development', '/receipt', root)
    expect(() => acquireTargetLocks([target], 'secret-stage', '/another', root)).toThrow(
      'Target is locked',
    )
    const owner = join(targetLockPath(target, root), 'owner.json')
    writePrivateJson(owner, {
      ...first.records[0],
      pid: 999999999,
      startedAt: '2000-01-01T00:00:00Z',
    })
    expect(() => acquireTargetLocks([target], 'hotfix', '/another', root)).toThrow(
      'age does not authorize',
    )
    first.release()
    const second = acquireTargetLocks([target], 'recovery', '/next', root)
    second.release()
  })
  it('acquires a target set deterministically and releases earlier locks on contention', () => {
    const root = fixture()
    const other = { ...target, workerName: 'z-last' }
    const busy = acquireTargetLocks([other], 'development', '/busy', root)
    expect(() => acquireTargetLocks([other, target], 'development', '/second', root)).toThrow(
      'locked',
    )
    const available = acquireTargetLocks([target], 'hotfix', '/third', root)
    available.release()
    busy.release()
  })
  it('never removes a lock whose ownership changed', () => {
    const root = fixture()
    const lock = acquireTargetLocks([target], 'development', '/receipt', root)
    const path = join(targetLockPath(target, root), 'owner.json')
    writeFileSync(path, JSON.stringify({ ...lock.records[0], owner: 'different' }))
    expect(() => lock.release()).toThrow('Lock owner changed')
    expect(readPrivateJson(path)).toMatchObject({ owner: 'different' })
  })
})
