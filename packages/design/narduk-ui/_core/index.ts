/**
 * Framework-free measurement logic, published as `narduk-ui/core`.
 *
 * Kept importable without Vue on purpose: server routes, tests and future
 * non-Vue consumers need to classify freshness and format measurements without
 * pulling in a component runtime. `narduk-ui/instruments` builds on this.
 */
export * from "./measure";
export * from "./signal";
