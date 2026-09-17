/**
 * Public types for the deterministic fake MapKit JS v6.
 *
 * These are declared structurally rather than as `Pick<>`s of
 * `@types/apple-mapkit`, so the published `./testing` types resolve for a
 * consumer that has not installed Apple's types. The link back to Apple's real
 * surface is a type-level conformance suite in this package's
 * `tests/testing/apple-types.test.ts`: it compares every member below against
 * `apple-mapkit/mapkit` member by member, so the fake cannot drift from the
 * real types without `pnpm typecheck` failing.
 */
export {};
//# sourceMappingURL=types.js.map