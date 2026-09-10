import { describe, expect, it } from 'vitest'

import {
  assertTimestampSkew,
  isWithinTimestampSkew,
  TIMESTAMP_SKEW_DEFAULT_SECONDS,
} from '../server/utils/devices'

import { claimDevice, createTestHarness, signedOpen } from './support/database'

/**
 * Gap L5: a consumer running a signed exchange *before* any device session
 * exists -- the claim handoff leg -- had neither of the two primitives
 * `openSession` uses internally. `timestampSkewSeconds` was private, and the
 * replay cache is keyed on (device, credential version, challenge, nonce,
 * request hash), none of which exists yet at handoff time.
 */
describe('timestamp skew', () => {
  const now = 1_700_000_000_000

  it('accepts either side of the window and refuses outside it', () => {
    expect(isWithinTimestampSkew(now, now)).toBe(true)
    expect(isWithinTimestampSkew(now - 300_000, now)).toBe(true)
    expect(isWithinTimestampSkew(now + 300_000, now)).toBe(true)
    expect(isWithinTimestampSkew(now - 300_001, now)).toBe(false)
    expect(isWithinTimestampSkew(now + 300_001, now)).toBe(false)
    expect(TIMESTAMP_SKEW_DEFAULT_SECONDS).toBe(300)
  })

  it('honours a caller-supplied window', () => {
    expect(isWithinTimestampSkew(now - 60_000, now, 30)).toBe(false)
    expect(isWithinTimestampSkew(now - 60_000, now, 60)).toBe(true)
    expect(isWithinTimestampSkew(now, now, 0)).toBe(true)
    expect(isWithinTimestampSkew(now + 1, now, 0)).toBe(false)
  })

  it('refuses a timestamp that is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isWithinTimestampSkew(value, now)).toBe(false)
    }
  })

  it('rejects a nonsensical window rather than silently accepting everything', () => {
    expect(() => isWithinTimestampSkew(now, now, -1)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    )
    expect(() => isWithinTimestampSkew(now, now, Number.NaN)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    )
  })

  it('asserts as unauthorized, without echoing either timestamp', () => {
    expect(() => assertTimestampSkew(now, now)).not.toThrow()
    let thrown: unknown
    try {
      assertTimestampSkew(now - 600_000, now)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'unauthorized' })
    expect((thrown as Error).message).not.toContain(String(now))
    expect((thrown as Error).message).toMatch(/skew window/u)
  })

  it('is the same rule openSession enforces', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const stale = harness.clock.now() - (TIMESTAMP_SKEW_DEFAULT_SECONDS * 1000 + 1)
    const { input } = await signedOpen(harness, claimed, 'command', { timestamp: stale })

    expect(isWithinTimestampSkew(stale, harness.clock.now())).toBe(false)
    await expect(harness.devices.openSession(input)).rejects.toMatchObject({
      code: 'unauthorized',
    })

    const fresh = await signedOpen(harness, claimed, 'command')
    expect(isWithinTimestampSkew(fresh.request.timestamp, harness.clock.now())).toBe(true)
    await expect(harness.devices.openSession(fresh.input)).resolves.toMatchObject({
      revocationGeneration: 0,
    })
  })
})

describe('scoped single-use nonces', () => {
  const HANDOFF_SCOPE = 'claim-handoff:cs-1'

  it('accepts a nonce once per scope', async () => {
    const harness = createTestHarness()
    const expiresAt = harness.clock.now() + 60_000

    await expect(
      harness.devices.consumeNonce({ scope: HANDOFF_SCOPE, nonce: 'n-1', expiresAt }),
    ).resolves.toBe(true)
    await expect(
      harness.devices.consumeNonce({ scope: HANDOFF_SCOPE, nonce: 'n-1', expiresAt }),
    ).resolves.toBe(false)
    // A different nonce in the same exchange, and the same nonce in another.
    await expect(
      harness.devices.consumeNonce({ scope: HANDOFF_SCOPE, nonce: 'n-2', expiresAt }),
    ).resolves.toBe(true)
    await expect(
      harness.devices.consumeNonce({ scope: 'claim-handoff:cs-2', nonce: 'n-1', expiresAt }),
    ).resolves.toBe(true)
  })

  it('keeps refusing a spent nonce until it is pruned', async () => {
    const harness = createTestHarness()
    const expiresAt = harness.clock.now() + 60_000
    await harness.devices.consumeNonce({ scope: 'handoff', nonce: 'n-1', expiresAt })

    harness.clock.set(expiresAt + 1)
    // Past its expiry but still stored: refusing is the safe direction.
    await expect(
      harness.devices.consumeNonce({
        scope: 'handoff',
        nonce: 'n-1',
        expiresAt: expiresAt + 60_000,
      }),
    ).resolves.toBe(false)
  })

  it('validates its inputs instead of storing a blank key', async () => {
    const harness = createTestHarness()
    const expiresAt = harness.clock.now() + 60_000
    await expect(
      harness.devices.consumeNonce({ scope: '  ', nonce: 'n-1', expiresAt }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      harness.devices.consumeNonce({ scope: 'handoff', nonce: '', expiresAt }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      harness.devices.consumeNonce({ scope: 'handoff', nonce: 'n-1', expiresAt: 0 }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      harness.devices.consumeNonce({ scope: 'handoff', nonce: 'n-1', expiresAt: 1.5 }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('is pruned on its own expiry and reported separately', async () => {
    const harness = createTestHarness()
    // The consumer's retention for a claim handoff: 24 h past the claim session.
    const claimSessionExpiresAt = harness.clock.now() + 900_000
    const retainedUntil = claimSessionExpiresAt + 24 * 60 * 60 * 1000
    await harness.devices.consumeNonce({
      scope: HANDOFF_SCOPE,
      nonce: 'n-1',
      expiresAt: retainedUntil,
    })

    harness.clock.set(retainedUntil - 1)
    await expect(harness.devices.pruneExpired()).resolves.toMatchObject({ scopedNonces: 0 })
    await expect(
      harness.devices.consumeNonce({
        scope: HANDOFF_SCOPE,
        nonce: 'n-1',
        expiresAt: retainedUntil,
      }),
    ).resolves.toBe(false)

    harness.clock.set(retainedUntil + 1)
    await expect(harness.devices.pruneExpired()).resolves.toMatchObject({ scopedNonces: 1 })
    const remaining = harness.sqlite
      .prepare('SELECT COUNT(*) AS rows FROM devices_scoped_nonces')
      .get() as { rows: number }
    expect(remaining.rows).toBe(0)
  })

  it('leaves the session replay cache alone', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await harness.devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    await harness.devices.consumeNonce({
      scope: HANDOFF_SCOPE,
      nonce: 'n-1',
      expiresAt: harness.clock.now() + 60_000,
    })

    const counts = (table: string) =>
      (harness.sqlite.prepare(`SELECT COUNT(*) AS rows FROM ${table}`).get() as { rows: number })
        .rows
    expect(counts('devices_replay_entries')).toBe(1)
    expect(counts('devices_scoped_nonces')).toBe(1)
  })
})
