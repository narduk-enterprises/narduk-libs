import type { Audience, Catalog, Journey, Profile, Scenario, Sequence, Story } from './types.js';
/**
 * Load-time validation, the second gate after the types (§2.2). Collects
 * every problem before throwing so a malformed catalog reports completely,
 * and a catalog that loads is one the runner can trust structurally.
 */
export declare function defineCatalog(catalog: Catalog): Catalog;
/** Identity helpers, for declaration-site type inference. */
export declare const defineScenario: (scenario: Scenario) => Scenario;
export declare const defineJourney: <J extends Journey>(journey: J) => J;
export declare const defineAudience: (audience: Audience) => Audience;
export declare const defineStory: (story: Story) => Story;
export declare const defineSequence: (sequence: Sequence) => Sequence;
export declare const defineProfiles: <P extends Record<string, Profile>>(profiles: P) => P;
//# sourceMappingURL=define.d.ts.map