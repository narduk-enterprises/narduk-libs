export interface CapturedAnalyticsEvent {
  event: string
  properties?: Record<string, unknown>
}

export interface ExpectedAnalyticsEvent extends CapturedAnalyticsEvent {
  /** Useful for standard events that must appear exactly once in a journey. */
  count?: number
}

/** Assert ordered semantic events from an SDK spy or decoded browser request collector. */
export function assertAnalyticsJourney(
  actual: readonly CapturedAnalyticsEvent[],
  expected: readonly ExpectedAnalyticsEvent[],
): void {
  let cursor = 0
  for (const step of expected) {
    const matches = (entry: CapturedAnalyticsEvent) =>
      entry.event === step.event &&
      Object.entries(step.properties ?? {}).every(([key, value]) =>
        Object.is(entry.properties?.[key], value),
      )
    const next = actual.findIndex((entry, index) => index >= cursor && matches(entry))
    if (next < 0)
      throw new Error('Missing analytics journey step after position ' + cursor + ': ' + step.event)
    if (step.count !== undefined && actual.filter(matches).length !== step.count)
      throw new Error('Unexpected analytics event count: ' + step.event)
    cursor = next + 1
  }
}
