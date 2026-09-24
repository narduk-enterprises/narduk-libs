import { and, desc, eq, gt } from 'drizzle-orm'

import {
  cooldownSecondsFor,
  DEVICES_LOCKOUT_POLICY,
  evaluateLockout,
  type LockoutRule,
} from '../../shared/utils/lockout-policy'
import { devicesAuthAttempts } from '../database/devices-schema'

import { runDevicesBatch, supportsAtomicBatch } from './devices-atomic'

import type { AuthAttemptSubjectKind } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'
import type { BatchItem } from 'drizzle-orm/batch'

/** The widest window any rule looks back over; what a prune may safely keep. */
export const DEVICES_LOCKOUT_MAX_WINDOW_SECONDS = Math.max(
  DEVICES_LOCKOUT_POLICY.perTokenOrDevice.windowSeconds,
  DEVICES_LOCKOUT_POLICY.perAccountOrIp.windowSeconds,
)

export interface LockoutSubject {
  kind: AuthAttemptSubjectKind
  subject: string
}

/**
 * Which operation a counted failure belongs to.
 *
 * - `claim` — the claim ceremony: `startClaim` and both completion paths.
 * - `credential` — `getCredentialBySecret`, the vessel's per-request bearer
 *   lookup on the ingest path.
 * - `session` — `openSession`.
 */
export type LockoutPurpose = 'claim' | 'credential' | 'session'

/**
 * The stored `devices_auth_attempts.subject` for one raw account key or IP.
 *
 * Lockout subjects are **namespaced by operation**, so a counter one path
 * writes can never gate another. An account key or an IP identifies a caller,
 * not a capability: without the namespace, the claim ceremony's unauthenticated
 * unknown-session counter and `getCredentialBySecret`'s per-request lookup
 * shared one per-IP counter, and twenty completions naming session ids that do
 * not exist — no claim token, no approval, no proof, and no per-token subject
 * to cap them — locked the whole vessel's ingest path. One looping device took
 * every camera aboard dark with no attacker present (narduk-libs#228 third
 * review HIGH-4).
 *
 * The `token` and `device` kinds are deliberately not namespaced: a token
 * digest is only ever presented to the claim ceremony and a device id only to
 * `openSession`, and `startClaim` and completion are meant to share the token
 * counter — that is what bounds guessing across the two legs of one ceremony.
 */
export function lockoutSubjectFor(purpose: LockoutPurpose, subject: string): string {
  return `${purpose}:${subject}`
}

export interface LockoutState {
  retryAfterSeconds: number
  subject: LockoutSubject
}

/**
 * One subject crossing its rule's threshold: the attempt that locked it out.
 *
 * Published for **every** rule. `escalates` says which kind of rule it was — it
 * governs whether the cooldown grows, not whether the caller is told a
 * threshold was reached — so a consumer building a non-escalating limiter on
 * the exported gate can audit the one attempt that locked the subject out
 * (narduk-libs#238). The library itself writes a `security.lockout` audit row
 * only for the escalating crossings.
 */
export interface LockoutThreshold {
  cooldownSeconds: number
  /** Whether the crossed rule escalates (the account/IP rule), or is flat (token/device). */
  escalates: boolean
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
  /**
   * Record an attempt per subject; returns every threshold this attempt
   * crossed, escalating or not, in subject order. Empty for a success.
   */
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
  /** The bounded, index-backed read of one subject's failures inside its window. */
  function failuresQuery(subject: LockoutSubject, rule: LockoutRule, at: number) {
    return db
      .select({ at: devicesAuthAttempts.at })
      .from(devicesAuthAttempts)
      .where(
        and(
          eq(devicesAuthAttempts.subjectKind, subject.kind),
          eq(devicesAuthAttempts.subject, subject.subject),
          eq(devicesAuthAttempts.outcome, 'failure'),
          gt(devicesAuthAttempts.at, at - rule.windowSeconds * 1000),
        ),
      )
      .orderBy(desc(devicesAuthAttempts.at))
      .limit(windowReadLimit(rule))
  }

  async function failuresInWindow(subject: LockoutSubject, rule: LockoutRule): Promise<number[]> {
    const rows = await failuresQuery(subject, rule, now()).all()
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

    /**
     * Insert-then-count, in one transaction where the database can run one: the
     * attempt row lands and the window is counted without another attempt
     * slipping between the two, so no concurrent failure can go uncounted or be
     * counted twice (narduk-libs#212 review finding 5). A plain query-builder
     * adapter degrades to the same two statements sequentially rather than
     * failing the authentication path.
     */
    async record(subjects, outcome) {
      if (subjects.length === 0) return []
      const at = now()
      const insert = db
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
        .returning({ id: devicesAuthAttempts.id })
      if (outcome !== 'failure') {
        await insert.run()
        return []
      }

      const rules = subjects.map((subject) => lockoutRuleFor(subject.kind))
      let counted: number[]
      if (supportsAtomicBatch(db)) {
        const statements = [
          insert,
          ...subjects.map((subject, index) =>
            failuresQuery(subject, rules[index] ?? lockoutRuleFor(subject.kind), at),
          ),
        ] as unknown as [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>]
        const results = await runDevicesBatch(db, statements)
        counted = (results.slice(1) as Array<Array<{ at: number }>>).map((rows) => rows.length)
      } else {
        await insert.run()
        counted = []
        for (const [index, subject] of subjects.entries()) {
          // eslint-disable-next-line no-await-in-loop -- at most four subjects, one bounded read each
          const rows = await failuresQuery(
            subject,
            rules[index] ?? lockoutRuleFor(subject.kind),
            at,
          ).all()
          counted.push(rows.length)
        }
      }

      // Every rule publishes its crossing. Filtering here on `escalates` left a
      // consumer's non-escalating limiter with no signal at all for the attempt
      // that locked its caller out (narduk-libs#238); which crossings deserve a
      // `security.lockout` row is the caller's call, and the library's own
      // `recordAttempt` keeps writing one only for the escalating kind.
      const crossed: LockoutThreshold[] = []
      for (const [index, subject] of subjects.entries()) {
        const rule = rules[index] ?? lockoutRuleFor(subject.kind)
        const failures = counted[index] ?? 0
        if (failures > 0 && failures % rule.failures === 0) {
          crossed.push({
            subject,
            failures,
            cooldownSeconds: cooldownSecondsFor(rule, failures),
            escalates: rule.escalates === true,
          })
        }
      }
      return crossed
    },
  }
}
