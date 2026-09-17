/**
 * The slice of the MapKit JS namespace the `./nuxt` runtime actually touches,
 * declared structurally.
 *
 * Why structural rather than `MapKit` from `@apple/mapkit-loader`: the
 * controllers in this directory have to be drivable from a plain TypeScript
 * test against `./testing`'s fake, with no Vue and no browser. The fake declares
 * its own public types structurally for the same reason (see
 * `src/testing/types.ts`), so a nominal dependency on Apple's classes would make
 * the seam untestable. `tests/nuxt/mapkit-surface.test.ts` carries the
 * compile-time conformance check that pins these declarations to Apple's real
 * types, so they cannot drift without `pnpm typecheck` failing.
 *
 * Every member named here is one the fake models. Reading a member the fake does
 * not model throws `FakeMapKitNotImplemented`, so this file is also the list of
 * what the runtime is allowed to reach for on a map.
 */
export {};
//# sourceMappingURL=mapkit-surface.js.map