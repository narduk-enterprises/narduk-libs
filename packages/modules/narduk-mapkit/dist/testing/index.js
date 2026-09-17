/**
 * A deterministic, offline fake of Apple MapKit JS v6.
 *
 * Why it ships inside `@narduk-enterprises/narduk-mapkit` rather than in a test
 * package: it fakes this library's own dependency, so it drifts the moment the
 * library's MapKit usage does, and the type-level conformance suite that pins
 * it to `@types/apple-mapkit` has to live beside the code it pins.
 *
 * It models only what this library and its consumers actually call. Reading or
 * writing any other member of `mapkit` or `mapkit.Map` throws
 * `FakeMapKitNotImplemented: <member>` rather than answering `undefined` -- a
 * silent no-op is how a fake produces a green test for code that would fail
 * against Apple.
 *
 * Nothing here is imported by the package's production entry points; `./testing`
 * is a separate export condition and carries no runtime dependency.
 */
import { createFakeMapKitRuntime } from './runtime.js';
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
export function createFakeMapKit(options = {}) {
    const runtime = createFakeMapKitRuntime(options);
    return {
        inspect: runtime.inspect,
        install(target = globalThis) {
            const hadOwn = Object.hasOwn(target, 'mapkit');
            const previous = target['mapkit'];
            target['mapkit'] = runtime.mapkit;
            return () => {
                if (hadOwn)
                    target['mapkit'] = previous;
                else
                    delete target['mapkit'];
            };
        },
        load: runtime.load,
        mapkit: runtime.mapkit,
    };
}
/** `createFakeMapKit(...)` with `install()` already called; returns the handle. */
export function installFakeMapKit(options = {}) {
    const handle = createFakeMapKit(options);
    return { ...handle, uninstall: handle.install() };
}
/**
 * Source for Playwright's `page.addInitScript({ content })`.
 *
 * The whole fake is one self-contained function whose only imports are
 * type-only, so its compiled source is valid standalone JavaScript. That is why
 * this needs no bundler and produces no second implementation to keep in sync.
 * It publishes `window.mapkit` and `window.__fakeMapKit` (the runtime, whose
 * `inspect` surface is readable from `page.evaluate`).
 */
export function fakeMapKitInitScript(options = {}) {
    return [
        ';(() => {',
        `  const runtime = (${createFakeMapKitRuntime.toString()})(${JSON.stringify(options)});`,
        '  globalThis.__fakeMapKit = runtime;',
        '  globalThis.mapkit = runtime.mapkit;',
        '})();',
    ].join('\n');
}
/**
 * True for the error the fake throws for an unmodelled member.
 *
 * Use this rather than `instanceof`: the error class is defined inside the
 * self-contained runtime function, so a fake injected into a browser through
 * `fakeMapKitInitScript()` throws a structurally identical error from a
 * different realm.
 */
export function isFakeMapKitNotImplemented(value) {
    return (value instanceof Error &&
        value.name === 'FakeMapKitNotImplemented' &&
        typeof value.member === 'string');
}
//# sourceMappingURL=index.js.map