import type { AppleJourney } from './types.js';
/**
 * The versioned Apple step marker (§2.4). The version prefix is what lets the
 * parser evolve without silently accepting markers from an older helper.
 */
export declare const APPLE_MARKER_VERSION = "njr1";
export declare function appleMarker(journeyId: string, stepId: string): string;
/**
 * Extract this package's markers from a run's activity titles. A title that
 * claims the njr prefix but does not parse is an error, never ignored: a
 * malformed marker is a broken helper, not noise.
 */
export declare function parseAppleMarkers(activityTitles: readonly string[]): Array<{
    journeyId: string;
    stepId: string;
}>;
/**
 * The bind-and-verify half of the Apple contract (§2.4): the executed step-id
 * sequence must equal the declared sequence for the run's scenario exactly.
 * Returns issues rather than throwing so a caller can aggregate.
 */
export declare function verifyAppleSequence(journey: AppleJourney, scenarioId: string, activityTitles: readonly string[]): string[];
//# sourceMappingURL=apple.d.ts.map