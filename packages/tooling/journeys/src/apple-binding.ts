/**
 * The bind-and-verify half of the Apple contract (§2.4) — runtime-neutral, and
 * therefore part of the core export. The half that drives a simulator lives in
 * `./apple`, an optional subpath, exactly as the Playwright layer lives behind
 * `./web`.
 */
import type { AppleJourney } from './types.js'
import { expectedStepIds } from './verify.js'

/**
 * The versioned Apple step marker (§2.4). The version prefix is what lets the
 * parser evolve without silently accepting markers from an older helper.
 */
export const APPLE_MARKER_VERSION = 'njr1'

export function appleMarker(journeyId: string, stepId: string): string {
  return `${APPLE_MARKER_VERSION}:${journeyId}:${stepId}`
}

const MARKER = new RegExp(`^${APPLE_MARKER_VERSION}:([a-z0-9-]+):([a-z0-9-]+)$`)

/**
 * Extract this package's markers from a run's activity titles. A title that
 * claims the njr prefix but does not parse is an error, never ignored: a
 * malformed marker is a broken helper, not noise.
 */
export function parseAppleMarkers(
  activityTitles: readonly string[],
): Array<{ journeyId: string; stepId: string }> {
  const markers: Array<{ journeyId: string; stepId: string }> = []
  for (const title of activityTitles) {
    if (!title.startsWith('njr')) continue
    const match = MARKER.exec(title)
    if (!match) throw new Error(`malformed journey marker: "${title}"`)
    markers.push({ journeyId: match[1] as string, stepId: match[2] as string })
  }
  return markers
}

/**
 * The bind-and-verify half of the Apple contract (§2.4): the executed step-id
 * sequence must equal the declared sequence for the run's scenario exactly.
 * Returns issues rather than throwing so a caller can aggregate.
 */
export function verifyAppleSequence(
  journey: AppleJourney,
  scenarioId: string,
  activityTitles: readonly string[],
): string[] {
  const issues: string[] = []
  let markers: Array<{ journeyId: string; stepId: string }>
  try {
    markers = parseAppleMarkers(activityTitles)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  for (const marker of markers) {
    if (marker.journeyId !== journey.id) {
      issues.push(`marker for foreign journey "${marker.journeyId}" inside "${journey.id}"`)
    }
  }
  const executed = markers
    .filter((marker) => marker.journeyId === journey.id)
    .map((marker) => marker.stepId)
  const expected = expectedStepIds(journey, scenarioId)
  if (executed.join(' ') !== expected.join(' ')) {
    issues.push(
      `executed step sequence [${executed.join(', ')}] does not equal declared ` +
        `sequence [${expected.join(', ')}] for scenario "${scenarioId}"`,
    )
  }
  return issues
}
