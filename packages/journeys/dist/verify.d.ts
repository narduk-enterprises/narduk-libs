import type { Catalog, Journey, Mode, RunManifest } from './types.js';
/**
 * The declared step-id sequence for one (journey, scenario): static `skipWhen`
 * resolved up front. This is the specification promotion verifies a manifest
 * against — expectations always come from the declaration, never from the
 * manifest under test (§4.3).
 */
export declare function expectedStepIds(journey: Journey, scenarioId: string): string[];
export interface VerifyOptions {
    /** The digest of the catalog as it stands NOW. Promotion requires equality. */
    currentDigest?: string;
}
/**
 * Verify one run attempt against the declaration (§4.3). Returns every issue
 * found; an empty list is the only pass. The manifest is evidence — it is
 * never the specification of its own completeness.
 */
export declare function verifyRun(catalog: Catalog, manifest: RunManifest, runDirectory: string, options?: VerifyOptions): string[];
/**
 * Promote a verified, passed run: atomically point `latest` (per journey,
 * profile, mode — the pointer file lives beside `runs/`) at this attempt.
 */
export declare function promoteRun(catalog: Catalog, manifest: RunManifest, runDirectory: string, options: VerifyOptions & {
    runId: string;
    latestPath: string;
}): void;
/** Read and minimally shape-check a run manifest from an attempt directory. */
export declare function readRunManifest(runDirectory: string): RunManifest;
/** The canonical attempt-directory layout (§4.3). */
export declare function runPaths(options: {
    outRoot: string;
    environment: string;
    surface: string;
    journeyId: string;
    profileName: string;
    mode: Mode;
    runId: string;
}): {
    attemptDirectory: string;
    latestPath: string;
    modeDirectory: string;
};
//# sourceMappingURL=verify.d.ts.map