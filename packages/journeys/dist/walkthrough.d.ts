import type { Catalog } from './types.js';
export interface WalkthroughOptions {
    outRoot: string;
    environment: string;
    profileName: string;
    currentDigest: string;
    /** Where the walkthrough page lands. */
    destination: string;
    /** Explicit override for assembling runs whose appRevision disagree (§4.3). */
    allowMixedAppRevision?: boolean;
}
/**
 * The publishable narrative output (§2.6, §4.3): built only from PROMOTED,
 * passed, capture-mode runs whose declaration digest equals the catalog as it
 * stands now, and refusing to mix application revisions without an explicit
 * override. A journey with no promoted capture is reported, never silently
 * absent.
 */
export declare function buildWalkthrough(catalog: Catalog, options: WalkthroughOptions): {
    written: string;
    missing: string[];
};
//# sourceMappingURL=walkthrough.d.ts.map