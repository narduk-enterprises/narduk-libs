import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { acquireSimulatorLease, type SimulatorLease } from '../src/apple-lease.js'

const UDID = 'ABCD-1234'

function leaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'njr-lease-'))
}

describe('the simulator lease', () => {
  it('refuses a device another live lane holds, naming the holder', () => {
    const dir = leaseDir()
    acquireSimulatorLease({ udid: UDID, holder: 'lane-a', leaseDir: dir })
    expect(() => acquireSimulatorLease({ udid: UDID, holder: 'lane-b', leaseDir: dir })).toThrow(
      /leased by "lane-a"[\s\S]*film each other's builds/,
    )
  })

  it('takes over a lease whose holder is gone', () => {
    const dir = leaseDir()
    acquireSimulatorLease({
      udid: UDID,
      holder: 'crashed-lane',
      leaseDir: dir,
      pid: 999_999,
    })
    const taken = acquireSimulatorLease({
      udid: UDID,
      holder: 'lane-b',
      leaseDir: dir,
      isAlive: () => false,
    })
    expect(taken.record.holder).toBe('lane-b')
  })

  it('takes over an expired lease', () => {
    const dir = leaseDir()
    writeFileSync(
      join(dir, `${UDID}.json`),
      JSON.stringify({
        udid: UDID,
        holder: 'stale-lane',
        pid: process.pid,
        acquiredAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:30:00.000Z',
      }),
    )
    const taken = acquireSimulatorLease({ udid: UDID, holder: 'lane-b', leaseDir: dir })
    expect(taken.record.holder).toBe('lane-b')
  })

  it('renews and releases only what it still holds', () => {
    const dir = leaseDir()
    let clock = Date.parse('2026-08-25T09:00:00.000Z')
    const lease = acquireSimulatorLease({
      udid: UDID,
      holder: 'lane-a',
      leaseDir: dir,
      now: () => clock,
    })
    const first = lease.record.expiresAt
    clock += 60_000
    lease.renew()
    expect(lease.record.expiresAt).not.toBe(first)

    // Somebody else took the device: renewing must fail loudly, and releasing
    // must not delete their lease.
    writeFileSync(
      join(dir, `${UDID}.json`),
      JSON.stringify({
        udid: UDID,
        holder: 'lane-b',
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )
    expect(() => lease.renew()).toThrow(/lost the lease/)
    lease.release()
    expect(JSON.parse(readFileSync(join(dir, `${UDID}.json`), 'utf8')).holder).toBe('lane-b')
  })

  // #880: a takeover is a read, a decision and a write. Each test below runs a
  // rival lane from inside lane A's liveness check, so the interleaving is
  // deterministic rather than a timing hope.
  const CRASHED = 999_999
  const holderOnDisk = (dir: string): string =>
    JSON.parse(readFileSync(join(dir, `${UDID}.json`), 'utf8')).holder

  it('refuses a takeover when a rival took the stale lease since it was read', () => {
    const dir = leaseDir()
    acquireSimulatorLease({ udid: UDID, holder: 'crashed-lane', leaseDir: dir, pid: CRASHED })
    let rival: SimulatorLease | undefined
    expect(() =>
      acquireSimulatorLease({
        udid: UDID,
        holder: 'lane-a',
        leaseDir: dir,
        pid: 1001,
        isAlive: (pid) => {
          if (pid === CRASHED && !rival) {
            rival = acquireSimulatorLease({
              udid: UDID,
              holder: 'lane-b',
              leaseDir: dir,
              pid: 1002,
              isAlive: (other) => other !== CRASHED,
            })
          }
          return pid !== CRASHED
        },
      }),
    ).toThrow(/leased by "lane-b"/)
    expect(rival?.record.holder).toBe('lane-b')
    expect(holderOnDisk(dir)).toBe('lane-b')
  })

  it('refuses a rival that tries to take over while another lane holds the lock', () => {
    const dir = leaseDir()
    acquireSimulatorLease({ udid: UDID, holder: 'crashed-lane', leaseDir: dir, pid: CRASHED })
    let checks = 0
    let rivalError: unknown
    const lease = acquireSimulatorLease({
      udid: UDID,
      holder: 'lane-a',
      leaseDir: dir,
      pid: 1001,
      isAlive: (pid) => {
        // The second check is lane A's re-decision, under the lock.
        if (pid === CRASHED && ++checks === 2) {
          try {
            acquireSimulatorLease({
              udid: UDID,
              holder: 'lane-b',
              leaseDir: dir,
              pid: 1002,
              isAlive: (other) => other !== CRASHED,
            })
          } catch (error) {
            rivalError = error
          }
        }
        return pid !== CRASHED
      },
    })
    expect(String(rivalError)).toMatch(/being taken over by another lane \(pid 1001\)/)
    expect(lease.record.holder).toBe('lane-a')
    expect(holderOnDisk(dir)).toBe('lane-a')
    expect(existsSync(join(dir, `${UDID}.json.lock`))).toBe(false)
  })

  it('names a lock left by a crash so an operator can clear it', () => {
    const dir = leaseDir()
    acquireSimulatorLease({ udid: UDID, holder: 'crashed-lane', leaseDir: dir, pid: CRASHED })
    writeFileSync(join(dir, `${UDID}.json.lock`), `${CRASHED}\n`)
    expect(() =>
      acquireSimulatorLease({ udid: UDID, holder: 'lane-b', leaseDir: dir, isAlive: () => false }),
    ).toThrow(
      new RegExp(
        `pid ${CRASHED}\\) right now\\. If pid ${CRASHED} is gone, delete .*\\.json\\.lock`,
      ),
    )
    expect(holderOnDisk(dir)).toBe('crashed-lane')
  })

  it('keeps a live lease through a renewal that meets a rival holding the lock', () => {
    const dir = leaseDir()
    const lease = acquireSimulatorLease({ udid: UDID, holder: 'lane-a', leaseDir: dir })
    writeFileSync(join(dir, `${UDID}.json.lock`), '1002\n')
    expect(() => lease.renew()).not.toThrow()
    lease.release()
    // Release skipped while the rival held the lock; the lease is still ours.
    expect(holderOnDisk(dir)).toBe('lane-a')
  })

  it('frees the device for the next lane after a clean release', () => {
    const dir = leaseDir()
    const lease = acquireSimulatorLease({ udid: UDID, holder: 'lane-a', leaseDir: dir })
    lease.release()
    expect(() =>
      acquireSimulatorLease({ udid: UDID, holder: 'lane-b', leaseDir: dir }),
    ).not.toThrow()
  })
})
