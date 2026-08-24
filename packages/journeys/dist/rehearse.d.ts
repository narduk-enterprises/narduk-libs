import type { Catalog } from './types.js';
export declare const REHEARSAL_WATERMARK = "REHEARSAL \u2014 generated from the declaration, no run behind it. Not evidence; not publishable.";
/**
 * The declaration-only narrative output (§2.6): prose beats and outcomes,
 * text only, watermarked. This is what a presenter rehearses from without a
 * live app; the publishable walkthrough is built from promoted capture runs
 * and lives in walkthrough.ts.
 */
export declare function buildRehearsal(catalog: Catalog): string;
//# sourceMappingURL=rehearse.d.ts.map