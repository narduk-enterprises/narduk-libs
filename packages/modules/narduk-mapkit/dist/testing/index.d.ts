import type { FakeMapKitHandle, FakeMapKitNotImplementedError, FakeMapKitOptions } from './types.js';
export type * from './types.js';
/**
 * Build a fake MapKit namespace plus its test-only inspector.
 *
 * ```ts
 * const fake = createFakeMapKit({ auth: { mode: 'accept' } })
 * const restore = fake.install()
 * // ... drive the code under test against globalThis.mapkit ...
 * restore()
 * ```
 */
export declare function createFakeMapKit(options?: FakeMapKitOptions): FakeMapKitHandle;
/** `createFakeMapKit(...)` with `install()` already called; returns the handle. */
export declare function installFakeMapKit(options?: FakeMapKitOptions): FakeMapKitHandle & {
    uninstall: () => void;
};
/**
 * Source for Playwright's `page.addInitScript({ content })`.
 *
 * The whole fake is one self-contained function whose only imports are
 * type-only, so its compiled source is valid standalone JavaScript. That is why
 * this needs no bundler and produces no second implementation to keep in sync.
 * It publishes `window.mapkit` and `window.__fakeMapKit` (the runtime, whose
 * `inspect` surface is readable from `page.evaluate`).
 */
export declare function fakeMapKitInitScript(options?: FakeMapKitOptions): string;
/**
 * True for the error the fake throws for an unmodelled member.
 *
 * Use this rather than `instanceof`: the error class is defined inside the
 * self-contained runtime function, so a fake injected into a browser through
 * `fakeMapKitInitScript()` throws a structurally identical error from a
 * different realm.
 */
export declare function isFakeMapKitNotImplemented(value: unknown): value is FakeMapKitNotImplementedError;
//# sourceMappingURL=index.d.ts.map