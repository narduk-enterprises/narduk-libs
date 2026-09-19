/**
 * Vector tile decoding, kept apart from `./client` on purpose.
 *
 * This is the only entry that reaches `@mapbox/vector-tile` and `pbf`. A map
 * consumer imports `./client` and injects the decoder; a worker script imports
 * this. `tests/vector-tiles/dependency-boundary.test.ts` walks the import
 * graph and fails if protobuf ever leaks the other way.
 */
export * from './mvt.js';
export * from './serve.js';
//# sourceMappingURL=index.js.map