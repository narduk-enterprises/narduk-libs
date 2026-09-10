import { describe, expect, it } from 'vitest'

import {
  assertTimestampSkew,
  isWithinTimestampSkew,
  REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX,
  REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN,
  reissueRetryAfterSeconds,
  SCOPED_NONCE_MAX_TTL_SECONDS,
  TIMESTAMP_SKEW_DEFAULT_SECONDS,
} from '../server/utils/devices'
import { DEVICES_INTERNAL_NONCE_PREFIX } from '../shared/types/devices'

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

  /**
   * narduk-libs#228 second review H3. The package writes its own single-use
   * rows into this table — the completion-proof nonce and the re-issue
   * single-writer lock — and `consumeNonce` documented its `scope` as opaque.
   * A consumer that forwards an attacker-influenced scope therefore handed the
   * attacker the ability to pre-insert the very lock rows the recovery path
   * needs, and wedge it for the life of the claim session.
   */
  it('reserves its own scope prefix against a caller', async () => {
    const harness = createTestHarness()
    const expiresAt = harness.clock.now() + 60_000
    for (const scope of [
      DEVICES_INTERNAL_NONCE_PREFIX,
      `${DEVICES_INTERNAL_NONCE_PREFIX}reissue:id-8`,
      `${DEVICES_INTERNAL_NONCE_PREFIX}claim-completion:cs-1`,
      `  ${DEVICES_INTERNAL_NONCE_PREFIX}reissue:id-8  `,
    ]) {
      await expect(
        harness.devices.consumeNonce({ scope, nonce: '0', expiresAt }),
      ).rejects.toMatchObject({ code: 'invalid' })
    }
    // Refused before the write, not after it.
    expect(
      (
        harness.sqlite.prepare('SELECT COUNT(*) AS rows FROM devices_scoped_nonces').get() as {
          rows: number
        }
      ).rows,
    ).toBe(0)
    // A scope that merely mentions the prefix later is a caller's business.
    await expect(
      harness.devices.consumeNonce({
        scope: `app:${DEVICES_INTERNAL_NONCE_PREFIX}whatever`,
        nonce: '0',
        expiresAt,
      }),
    ).resolves.toBe(true)
  })

  /**
   * narduk-libs#228 second review L3: `pruneExpired` reclaims a scoped nonce
   * only once its own `expiresAt` has passed, so a caller-chosen expiry far
   * enough out is a permanent row in a table this package depends on.
   */
  it('refuses an expiry pruneExpired could never reclaim', async () => {
    const harness = createTestHarness()
    const decade = harness.clock.now() + 10 * 365 * 24 * 60 * 60 * 1000
    await expect(
      harness.devices.consumeNonce({ scope: HANDOFF_SCOPE, nonce: 'n-1', expiresAt: decade }),
    ).rejects.toMatchObject({ code: 'invalid' })
    // The boundary itself is accepted, so the bound is a ceiling rather than a
    // cliff a legitimate retention lands the wrong side of.
    await expect(
      harness.devices.consumeNonce({
        scope: HANDOFF_SCOPE,
        nonce: 'n-1',
        expiresAt: harness.clock.now() + SCOPED_NONCE_MAX_TTL_SECONDS * 1000,
      }),
    ).resolves.toBe(true)
    await expect(
      harness.devices.consumeNonce({
        scope: HANDOFF_SCOPE,
        nonce: 'n-2',
        expiresAt: harness.clock.now() + SCOPED_NONCE_MAX_TTL_SECONDS * 1000 + 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  /**
   * narduk-libs#228 second review L2. A fixed one-second hint mostly guarantees
   * the same two callers collide again on a boat uplink. The value carries
   * nothing about the winner — it is drawn from `random`, not from the request
   * or the contending call — so jittering it leaks no more than the constant
   * did.
   */
  it('jitters the contention retry hint inside its stated window', () => {
    expect(reissueRetryAfterSeconds(() => 0)).toBe(REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN)
    expect(reissueRetryAfterSeconds(() => 0.999_999)).toBe(
      REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX,
    )
    // Out-of-contract sources are clamped rather than trusted.
    expect(reissueRetryAfterSeconds(() => 1)).toBe(REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX)
    expect(reissueRetryAfterSeconds(() => -1)).toBe(REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN)
    const seen = new Set<number>()
    for (let n = 0; n < 200; n += 1) {
      const value = reissueRetryAfterSeconds()
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN)
      expect(value).toBeLessThanOrEqual(REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX)
      seen.add(value)
    }
    // Actually jittered, not a constant wearing a range's clothes.
    expect(seen.size).toBeGreaterThan(1)
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
