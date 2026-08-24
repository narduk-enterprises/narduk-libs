import { expectedStepIds } from './verify.js';
/**
 * The versioned Apple step marker (§2.4). The version prefix is what lets the
 * parser evolve without silently accepting markers from an older helper.
 */
export const APPLE_MARKER_VERSION = 'njr1';
export function appleMarker(journeyId, stepId) {
    return `${APPLE_MARKER_VERSION}:${journeyId}:${stepId}`;
}
const MARKER = new RegExp(`^${APPLE_MARKER_VERSION}:([a-z0-9-]+):([a-z0-9-]+)$`);
/**
 * Extract this package's markers from a run's activity titles. A title that
 * claims the njr prefix but does not parse is an error, never ignored: a
 * malformed marker is a broken helper, not noise.
 */
export function parseAppleMarkers(activityTitles) {
    const markers = [];
    for (const title of activityTitles) {
        if (!title.startsWith('njr'))
            continue;
        const match = MARKER.exec(title);
        if (!match)
            throw new Error(`malformed journey marker: "${title}"`);
        markers.push({ journeyId: match[1], stepId: match[2] });
    }
    return markers;
}
/**
 * The bind-and-verify half of the Apple contract (§2.4): the executed step-id
 * sequence must equal the declared sequence for the run's scenario exactly.
 * Returns issues rather than throwing so a caller can aggregate.
 */
export function verifyAppleSequence(journey, scenarioId, activityTitles) {
    const issues = [];
    let markers;
    try {
        markers = parseAppleMarkers(activityTitles);
    }
    catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
    for (const marker of markers) {
        if (marker.journeyId !== journey.id) {
            issues.push(`marker for foreign journey "${marker.journeyId}" inside "${journey.id}"`);
        }
    }
    const executed = markers
        .filter((marker) => marker.journeyId === journey.id)
        .map((marker) => marker.stepId);
    const expected = expectedStepIds(journey, scenarioId);
    if (executed.join(' ') !== expected.join(' ')) {
        issues.push(`executed step sequence [${executed.join(', ')}] does not equal declared ` +
            `sequence [${expected.join(', ')}] for scenario "${scenarioId}"`);
    }
    return issues;
}
//# sourceMappingURL=apple.js.map