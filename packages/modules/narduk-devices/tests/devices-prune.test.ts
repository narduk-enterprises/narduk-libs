import { describe, expect, it } from 'vitest'

import { CHALLENGE_DEFAULT_TTL_SECONDS } from '../server/utils/devices'
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
})
