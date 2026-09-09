import { and, desc, eq, gt } from 'drizzle-orm'

import {
  cooldownSecondsFor,
  DEVICES_LOCKOUT_POLICY,
  evaluateLockout,
  type LockoutRule,
} from '../../shared/utils/lockout-policy'
import { devicesAuthAttempts } from '../database/devices-schema'

import type { AuthAttemptSubjectKind } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'

export interface LockoutSubject {
  kind: AuthAttemptSubjectKind
  subject: string
}

export interface LockoutState {
  retryAfterSeconds: number
  subject: LockoutSubject
}

export interface LockoutThreshold {
  cooldownSeconds: number
  failures: number
  subject: LockoutSubject
}

/** `token` and `device` share one rule; `account` and `ip` share the escalating one. */
export function lockoutRuleFor(kind: AuthAttemptSubjectKind): LockoutRule {
  return kind === 'token' || kind === 'device'
    ? DEVICES_LOCKOUT_POLICY.perTokenOrDevice
    : DEVICES_LOCKOUT_POLICY.perAccountOrIp
}

/**
 * Enough rows to evaluate every escalation step up to the one-day cap, and no
 * more: the read is bounded regardless of how many failures a subject has
 * accumulated.
 */
function windowReadLimit(rule: LockoutRule): number {
  return rule.failures * 8
}

export interface LockoutGate {
  /** The first locked subject, or null when every subject may proceed. */
  check: (subjects: readonly LockoutSubject[]) => Promise<LockoutState | null>
  /** Record an attempt per subject; returns the escalating thresholds crossed. */
  record: (
    subjects: readonly LockoutSubject[],
    outcome: 'success' | 'failure',
  ) => Promise<LockoutThreshold[]>
}

export function createLockoutGate(
  db: DevicesDatabase,
  now: () => number,
  nextId: () => string,
): LockoutGate {
  async function failuresInWindow(subject: LockoutSubject, rule: LockoutRule): Promise<number[]> {
    const rows = await db
      .select({ at: devicesAuthAttempts.at })
      .from(devicesAuthAttempts)
      .where(
        and(
          eq(devicesAuthAttempts.subjectKind, subject.kind),
          eq(devicesAuthAttempts.subject, subject.subject),
          eq(devicesAuthAttempts.outcome, 'failure'),
          gt(devicesAuthAttempts.at, now() - rule.windowSeconds * 1000),
        ),
      )
      .orderBy(desc(devicesAuthAttempts.at))
      .limit(windowReadLimit(rule))
      .all()
    return rows.map((row) => row.at)
  }

  return {
    async check(subjects) {
      let worst: LockoutState | null = null
      for (const subject of subjects) {
        const rule = lockoutRuleFor(subject.kind)
        // eslint-disable-next-line no-await-in-loop -- each subject is a separate, tiny, index-backed read and the list is at most four long
        const verdict = evaluateLockout(rule, await failuresInWindow(subject, rule), now())
        if (verdict.locked && (!worst || verdict.retryAfterSeconds > worst.retryAfterSeconds)) {
          worst = { subject, retryAfterSeconds: verdict.retryAfterSeconds }
        }
      }
      return worst
    },

    async record(subjects, outcome) {
      if (subjects.length === 0) return []
      const at = now()
      await db
        .insert(devicesAuthAttempts)
        .values(
          subjects.map((subject) => ({
            id: nextId(),
            subjectKind: subject.kind,
            subject: subject.subject,
            outcome,
            at,
          })),
        )
        .run()
      if (outcome !== 'failure') return []

      const crossed: LockoutThreshold[] = []
      for (const subject of subjects) {
        const rule = lockoutRuleFor(subject.kind)
        if (!rule.escalates) continue
        // eslint-disable-next-line no-await-in-loop -- at most four subjects, one bounded read each
        const failures = (await failuresInWindow(subject, rule)).length
        if (failures > 0 && failures % rule.failures === 0) {
          crossed.push({ subject, failures, cooldownSeconds: cooldownSecondsFor(rule, failures) })
        }
      }
      return crossed
    },
  }
}
