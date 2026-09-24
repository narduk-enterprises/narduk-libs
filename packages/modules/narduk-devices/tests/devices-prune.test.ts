import { describe, expect, it, vi } from 'vitest'

import {
  CHALLENGE_DEFAULT_TTL_SECONDS,
  createDevices,
  OPPORTUNISTIC_PRUNE_MAX_INTERVAL_SECONDS,
} from '../server/utils/devices'
import { DEVICES_LOCKOUT_MAX_WINDOW_SECONDS } from '../server/utils/devices-lockout'
import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import {
  ALGORITHM,
  claimDevice,
  createDeviceKey,
  createTestHarness,
  FINGERPRINT,
  ORG,
  signedOpen,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'

const { perTokenOrDevice } = DEVICES_LOCKOUT_POLICY

function counts(harness: ReturnType<typeof createTestHarness>) {
  const one = (table: string) =>
    (harness.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  return {
    authAttempts: one('devices_auth_attempts'),
    replayEntries: one('devices_replay_entries'),
  }
}

describe('opportunistic pruning', () => {
  it('drops expired replay entries and attempts no rule can still count, on openSession', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)

    // Two good opens (a replay entry each) and five refused ones (attempt rows).
    for (let open = 1; open <= 2; open += 1) {
      await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
      clock.advance(1000)
    }
    for (let attempt = 1; attempt <= perTokenOrDevice.failures; attempt += 1) {
      const { input } = await signedOpen(harness, claimed, 'command')
      expect(await codeOf(devices.openSession({ ...input, signature: 'A'.repeat(86) }))).toBe(
        'unauthorized',
      )
      clock.advance(1000)
    }
    const before = counts(harness)
    expect(before.replayEntries).toBe(2)
    // Three from the claim ceremony, two successful opens, five refusals.
    expect(before.authAttempts).toBe(10)

    // Past every challenge TTL and every lockout window.
    clock.advance((DEVICES_LOCKOUT_MAX_WINDOW_SECONDS + CHALLENGE_DEFAULT_TTL_SECONDS) * 1000)
    const { input } = await signedOpen(harness, claimed, 'command')
    await expect(devices.openSession(input)).resolves.toMatchObject({ revocationGeneration: 0 })

    // The stale rows are gone; only this open's own two rows remain.
    const after = counts(harness)
    expect(after.replayEntries).toBe(1)
    expect(after.authAttempts).toBe(1)
  })

  it('prunes on startClaim and reports what an explicit prune removed', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const key = createDeviceKey()
    const guess = (n: number) =>
      devices.startClaim({
        claimToken: `guess-${String(n).padStart(3, '0')}-000000000000000000000000000000`,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: `prune-${n}`,
        remote: { ip: '203.0.113.7' },
      })
    for (let n = 1; n <= 3; n += 1) {
      expect((await guess(n)).status).toBe('invalid_token')
      clock.advance(1000)
    }
    expect(counts(harness).authAttempts).toBe(6)

    // An explicit prune reports nothing to do while the window still covers them.
    expect(await devices.pruneExpired()).toEqual({
      authAttempts: 0,
      replayEntries: 0,
      scopedNonces: 0,
    })

    clock.advance(DEVICES_LOCKOUT_MAX_WINDOW_SECONDS * 1000 + 1)
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'prune-good',
    })
    expect(started.status).toBe('pending_user_approval')
    // Only this start's own success row survives.
    expect(counts(harness).authAttempts).toBe(1)
    expect(await devices.pruneExpired()).toEqual({
      authAttempts: 0,
      replayEntries: 0,
      scopedNonces: 0,
    })
  })

  it('accepts an explicit cutoff', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    expect(counts(harness).replayEntries).toBe(1)

    // A cutoff far enough in the future expires every entry that exists.
    const removed = await devices.pruneExpired({
      before:
        clock.now() + (DEVICES_LOCKOUT_MAX_WINDOW_SECONDS + CHALLENGE_DEFAULT_TTL_SECONDS) * 1000,
    })
    expect(removed.replayEntries).toBe(1)
    expect(removed.authAttempts).toBeGreaterThan(0)
    expect(counts(harness)).toEqual({ authAttempts: 0, replayEntries: 0 })
  })

  /**
   * `scopedNonces: 0` was the only thing asserted anywhere, which proves the
   * field exists, not that the sweep works (narduk-libs#228 M6). A spent nonce
   * that is never pruned is unbounded growth in a table every signed
   * pre-device exchange writes to.
   */
  it('prunes a spent scoped nonce once it expires, and not before', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const nonce = {
      scope: 'claim-handoff:session-1',
      nonce: 'n-1',
      expiresAt: clock.now() + 60_000,
    }
    expect(await devices.consumeNonce(nonce)).toBe(true)
    const live = () =>
      (
        harness.sqlite.prepare('SELECT COUNT(*) AS n FROM devices_scoped_nonces').get() as {
          n: number
        }
      ).n
    expect(live()).toBe(1)

    // Still inside its lifetime: kept, and still refusing the replay it exists
    // to refuse.
    expect((await devices.pruneExpired()).scopedNonces).toBe(0)
    expect(await devices.consumeNonce(nonce)).toBe(false)
    expect(live()).toBe(1)

    clock.advance(60_001)
    expect((await devices.pruneExpired()).scopedNonces).toBe(1)
    expect(live()).toBe(0)
    // Gone, so the scope is free again — which is why the TTL has to outlive
    // the exchange the nonce protects.
    expect(await devices.consumeNonce({ ...nonce, expiresAt: clock.now() + 60_000 })).toBe(true)
  })
})

/**
 * `startClaim` is polled while an owner approves: an edge re-posts it every
 * 5 s for up to 15 min. Each poll ran every prune DELETE, almost always
 * removing nothing (narduk-libs#227). The DELETE count must follow elapsed
 * time, not the number of polls or the rows retained.
 */
describe('opportunistic prune throttle', () => {
  const POLL_MS = 5000
  const INTERVAL_MS = CHALLENGE_DEFAULT_TTL_SECONDS * 1000

  async function pollClaim(polls: number, retainedAttempts: number) {
    const harness = createTestHarness()
    const { devices, clock, sqlite } = harness
    const insert = sqlite.prepare(
      `INSERT INTO devices_auth_attempts (id, subject_kind, subject, outcome, at)
       VALUES (?, 'ip', ?, 'failure', ?)`,
    )
    for (let row = 0; row < retainedAttempts; row += 1) {
      insert.run(`retained-${row}`, `ip-${row}`, clock.now())
    }
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const key = createDeviceKey()
    const prepare = vi.spyOn(sqlite, 'prepare')
    for (let poll = 0; poll < polls; poll += 1) {
      const started = await devices.startClaim({
        claimToken: minted.token,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: 'poll',
      })
      expect(started.status).toBe('pending_user_approval')
      clock.advance(POLL_MS)
    }
    const deletes = prepare.mock.calls.filter(([sql]) => /^delete from/iu.test(String(sql))).length
    prepare.mockRestore()
    return { deletes, elapsedMs: polls * POLL_MS }
  }

  it('bounds prune DELETEs by elapsed time, whatever the poll count or retained rows', async () => {
    const results = []
    for (const polls of [12, 180]) {
      for (const retained of [0, 500]) {
        results.push({ polls, retained, ...(await pollClaim(polls, retained)) })
      }
    }
    for (const { deletes, elapsedMs } of results) {
      // Three DELETEs per prune, at most one prune per interval started.
      expect(deletes).toBeLessThanOrEqual(3 * Math.ceil(elapsedMs / INTERVAL_MS))
    }
    // 180 polls is 15 minutes: three prunes, not 180.
    expect(results.filter((r) => r.polls === 180).map((r) => r.deletes)).toEqual([9, 9])
    expect(results.filter((r) => r.polls === 12).map((r) => r.deletes)).toEqual([3, 3])
  })

  it('uses the shorter of the challenge TTL and the shortest lockout window', async () => {
    expect(OPPORTUNISTIC_PRUNE_MAX_INTERVAL_SECONDS).toBe(
      DEVICES_LOCKOUT_POLICY.perTokenOrDevice.windowSeconds,
    )
    const harness = createTestHarness({ challengeTtlSeconds: 30 })
    const { devices, clock, sqlite } = harness
    const prepare = vi.spyOn(sqlite, 'prepare')
    const deletes = () =>
      prepare.mock.calls.filter(([sql]) => /^delete from/iu.test(String(sql))).length
    const claimed = await claimDevice(harness)
    const afterClaim = deletes()
    await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    expect(deletes()).toBe(afterClaim)
    clock.advance(30_000)
    await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    expect(deletes()).toBe(afterClaim + 3)
    prepare.mockRestore()
  })

  it('shares the throttle between services over one database', async () => {
    const harness = createTestHarness()
    const { db, sqlite, clock } = harness
    const prepare = vi.spyOn(sqlite, 'prepare')
    const deletes = () =>
      prepare.mock.calls.filter(([sql]) => /^delete from/iu.test(String(sql))).length
    for (let request = 0; request < 5; request += 1) {
      // A consumer building the service per request.
      const perRequest = createDevices(db, { now: clock.now })
      await perRequest.pruneExpired()
      await expect(perRequest.openSession({} as never)).rejects.toThrow()
    }
    // Five explicit prunes always run; the five opportunistic ones share one.
    expect(deletes()).toBe(5 * 3 + 3)
    prepare.mockRestore()
  })
})
