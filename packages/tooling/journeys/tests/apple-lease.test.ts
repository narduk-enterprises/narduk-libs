import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { acquireSimulatorLease } from '../src/apple-lease.js'

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

  it('frees the device for the next lane after a clean release', () => {
    const dir = leaseDir()
    const lease = acquireSimulatorLease({ udid: UDID, holder: 'lane-a', leaseDir: dir })
    lease.release()
    expect(() =>
      acquireSimulatorLease({ udid: UDID, holder: 'lane-b', leaseDir: dir }),
    ).not.toThrow()
  })
})
