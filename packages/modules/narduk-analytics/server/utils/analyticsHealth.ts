/**
 * Tracking health from one app's own event counts: is it collecting, and is
 * the rate sane against its own baseline? Pure so the verdict is testable.
 */

export type AnalyticsHealthState = 'drop' | 'quiet' | 'silent' | 'tracking'

export interface AnalyticsHealthInput {
  /** Events in the last 28 days, every traffic class. */
  events28d: number
  /** Events in the last 7 days. */
  events7d: number
  lastEventMs: number | null
  /** Events in the last 28 days that carry a `traffic_class`. */
  markedEvents28d: number
  nowMs: number
}

export interface AnalyticsHealth {
  baselinePerDay: number
  events28d: number
  lastEventAt: string | null
  /** Share (0-1) of the last 28 days' events that carry a traffic class; `null` with no events. */
  markedShare: number | null
  reason: string
  recentPerDay: number
  state: AnalyticsHealthState
  title: string
}

const DAY = 86_400_000

export function classifyTrackingHealth(input: AnalyticsHealthInput): AnalyticsHealth {
  const recentPerDay = input.events7d / 7
  const baselinePerDay = Math.max(0, input.events28d - input.events7d) / 21
  const base = {
    events28d: input.events28d,
    lastEventAt: input.lastEventMs === null ? null : new Date(input.lastEventMs).toISOString(),
    markedShare: input.events28d > 0 ? input.markedEvents28d / input.events28d : null,
    recentPerDay,
    baselinePerDay,
  }
  const rate = `${Math.round(recentPerDay)}/day vs ${Math.round(baselinePerDay)}/day baseline`

  if (input.events28d === 0) {
    return {
      ...base,
      state: 'silent',
      title: 'No events in 28 d',
      reason: 'PostHog has no events for this host in 28 days.',
    }
  }
  if (
    input.lastEventMs !== null &&
    input.nowMs - input.lastEventMs > 2 * DAY &&
    baselinePerDay >= 5
  ) {
    return {
      ...base,
      state: 'quiet',
      title: 'Gone quiet',
      reason: `No event in over 2 days; ${rate}.`,
    }
  }
  if (baselinePerDay > 8 && recentPerDay < baselinePerDay * 0.35) {
    return { ...base, state: 'drop', title: 'Sharp drop', reason: rate }
  }
  return { ...base, state: 'tracking', title: 'Tracking', reason: rate }
}
