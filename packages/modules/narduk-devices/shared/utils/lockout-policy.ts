/**
 * Lockout policy for the claim ceremony and device session authentication.
 *
 * Value-for-value the policy the first consumer publishes as
 * `CLAIM_LOCKOUT_POLICY` in `@mybo/contracts` (docs/09 §edge identity,
 * inherited edge-cloud-v1 §claim): 5 failed claim or session-auth attempts per
 * claim token or device within 15 minutes → 15-minute cooldown; 20 per account
 * or IP within one hour → escalating cooldown plus a security audit event.
 * `tests/lockout-policy.test.ts` pins these numbers so the two constants cannot
 * drift apart silently.
 */
export const DEVICES_LOCKOUT_POLICY = {
  perTokenOrDevice: { failures: 5, windowSeconds: 900, cooldownSeconds: 900 },
  perAccountOrIp: { failures: 20, windowSeconds: 3600, cooldownSeconds: 900, escalates: true },
  claimTokenTtlSeconds: 900,
  claimTokenMinBits: 128,
} as const

/** Escalation never grows a cooldown past one day. */
export const DEVICES_LOCKOUT_MAX_COOLDOWN_SECONDS = 86_400

export interface LockoutRule {
  cooldownSeconds: number
  escalates?: boolean
  failures: number
  windowSeconds: number
}

export interface LockoutVerdict {
  /** Whether the subject is currently locked out. */
  locked: boolean
  /** Seconds until the subject may try again; `0` when not locked. */
  retryAfterSeconds: number
  /** Whether this evaluation crossed a lockout threshold (an audit trigger). */
  thresholdCrossed: boolean
}

/**
 * The cooldown a rule applies once `failures` failures sit inside its window.
 * An escalating rule doubles the cooldown for every further full threshold:
 * 20 failures → 15 min, 40 → 30 min, 60 → 1 h, capped at one day.
 */
export function cooldownSecondsFor(rule: LockoutRule, failures: number): number {
  const thresholds = Math.floor(failures / rule.failures)
  if (thresholds <= 0) return 0
  if (!rule.escalates) return rule.cooldownSeconds
  const escalated = rule.cooldownSeconds * 2 ** (thresholds - 1)
  return Math.min(escalated, DEVICES_LOCKOUT_MAX_COOLDOWN_SECONDS)
}

/**
 * Pure lockout evaluation over the failure timestamps inside the rule's window,
 * newest first. `now` and every timestamp are millisecond epochs.
 *
 * A lockout starts at the failure that crosses a threshold (the 5th, or the
 * 20th, 40th, ...) and lasts that threshold's cooldown. Failures between
 * lockouts keep counting inside the window, which is what lets an escalating
 * rule actually escalate: the 40th failure inside the hour locks for twice as
 * long as the 20th did.
 */
export function evaluateLockout(
  rule: LockoutRule,
  failuresInWindowNewestFirst: readonly number[],
  now: number,
): LockoutVerdict {
  const failures = failuresInWindowNewestFirst.length
  if (failures < rule.failures) {
    return { locked: false, retryAfterSeconds: 0, thresholdCrossed: false }
  }
  // The most recent threshold-crossing failure, counted from the oldest.
  const crossing = Math.floor(failures / rule.failures) * rule.failures
  const crossedAt = failuresInWindowNewestFirst[failures - crossing] ?? now
  const lockedUntil = crossedAt + cooldownSecondsFor(rule, crossing) * 1000
  const remainingMs = lockedUntil - now
  const thresholdCrossed = failures % rule.failures === 0
  if (remainingMs <= 0) {
    return { locked: false, retryAfterSeconds: 0, thresholdCrossed }
  }
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000), thresholdCrossed }
}
