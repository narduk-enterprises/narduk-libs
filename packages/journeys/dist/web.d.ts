import type { Catalog, Mode, WorldHooks, WorldQuery } from './types.js';
export interface RegisterJourneysOptions {
    catalog: Catalog;
    world: WorldHooks;
    base: string;
    outRoot: string;
    environment: string;
    profileName: string;
    commit?: string;
    declarationDigest: string;
    /** Defaults to process.env.JOURNEYS_MODE, then 'test'. */
    mode?: Mode;
    /** Register only these journey ids (default: every web journey). */
    only?: string[];
}
/**
 * GET-only, same-origin, JSON-only — by construction (§2.3). A throw anywhere
 * in here fails the step; the adapter never converts a query failure into a
 * skip.
 */
export declare function createWorldQuery(base: string): WorldQuery;
/**
 * Register one Playwright `test()` per web journey, one `test.step()` per
 * declared step. Call from a spec file. Journeys sharing a world run serially
 * inside one worker by construction here (registration order); isolation
 * across targets is the caller's arrangement per the world-session rules (§5).
 */
export declare function registerJourneys(options: RegisterJourneysOptions): void;
//# sourceMappingURL=web.d.ts.map