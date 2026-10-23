/**
 * The held-value fixture (mybo-at-v2 docs/19 § 10 L3): change-only rows, as
 * the edge's reducer sends them, whose sample mean and time-weighted mean
 * differ. Shared by the unit suite (against `timeWeightedBuckets`) and the
 * live suite (against the SQL refresh), so both prove the same numbers.
 *
 *   12:00:00  10   held 50 s
 *   12:00:50  20   held 10 s
 *   12:01:00  30   held 150 s (to 12:03:30)
 *   12:03:30  40   held to the end of the window (12:05:00), under maxHold
 */
import type { TimeWeightedReading } from '../../src/time-weighted.js'

export const HELD_VALUE_T0 = Date.parse('2026-10-01T12:00:00.000Z')

export const heldValueAt = (seconds: number): Date => new Date(HELD_VALUE_T0 + seconds * 1000)

export const HELD_VALUE_FIXTURE: readonly TimeWeightedReading[] = [
  { ts: heldValueAt(0), value: 10 },
  { ts: heldValueAt(50), value: 20 },
  { ts: heldValueAt(60), value: 30 },
  { ts: heldValueAt(210), value: 40 },
]
