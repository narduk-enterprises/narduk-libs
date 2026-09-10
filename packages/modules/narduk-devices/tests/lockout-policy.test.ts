import { describe, expect, it } from 'vitest'

import {
  cooldownSecondsFor,
  DEVICES_LOCKOUT_MAX_COOLDOWN_SECONDS,
  DEVICES_LOCKOUT_POLICY,
  evaluateLockout,
} from '../shared/utils/lockout-policy'

describe('DEVICES_LOCKOUT_POLICY', () => {
  it('is value-for-value the consumer contract CLAIM_LOCKOUT_POLICY', () => {
    // Pinned literally: the mybo-at-v2 contract (packages/contracts/src/schemas/
    // claim.ts) is not a dependency, so this is the only drift check.
    expect(DEVICES_LOCKOUT_POLICY).toEqual({
      perTokenOrDevice: { failures: 5, windowSeconds: 900, cooldownSeconds: 900 },
      perAccountOrIp: { failures: 20, windowSeconds: 3600, cooldownSeconds: 900, escalates: true },
      claimTokenTtlSeconds: 900,
      claimTokenMinBits: 128,
    })
  })

  it('escalates the account/IP cooldown per full threshold, capped at a day', () => {
    const rule = DEVICES_LOCKOUT_POLICY.perAccountOrIp
    expect(cooldownSecondsFor(rule, 19)).toBe(0)
    expect(cooldownSecondsFor(rule, 20)).toBe(900)
    expect(cooldownSecondsFor(rule, 39)).toBe(900)
    expect(cooldownSecondsFor(rule, 40)).toBe(1800)
    expect(cooldownSecondsFor(rule, 60)).toBe(3600)
    expect(cooldownSecondsFor(rule, 20 * 20)).toBe(DEVICES_LOCKOUT_MAX_COOLDOWN_SECONDS)
    const flat = DEVICES_LOCKOUT_POLICY.perTokenOrDevice
    expect(cooldownSecondsFor(flat, 5)).toBe(900)
    expect(cooldownSecondsFor(flat, 50)).toBe(900)
  })

  it('locks from the latest failure and releases when the cooldown has elapsed', () => {
    const rule = DEVICES_LOCKOUT_POLICY.perTokenOrDevice
    const now = 1_000_000
    expect(evaluateLockout(rule, [now - 1000, now - 2000, now - 3000, now - 4000], now)).toEqual({
      locked: false,
      retryAfterSeconds: 0,
      thresholdCrossed: false,
    })
    const five = [now - 1000, now - 2000, now - 3000, now - 4000, now - 5000]
    expect(evaluateLockout(rule, five, now)).toEqual({
      locked: true,
      retryAfterSeconds: 899,
      thresholdCrossed: true,
    })
    expect(evaluateLockout(rule, five, now + 899_000).locked).toBe(false)
    expect(evaluateLockout(rule, [], now).locked).toBe(false)
  })
})
