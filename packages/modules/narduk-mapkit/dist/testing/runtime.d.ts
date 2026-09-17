import type { FakeMapKitOptions, FakeMapKitRuntime } from './types.js';
/**
 * The entire fake, as ONE self-contained function.
 *
 * Every import above is `import type`, so `verbatimModuleSyntax` erases all of
 * them and the compiled function references nothing outside its own body. That
 * is what lets `createFakeMapKitRuntime.toString()` be injected verbatim into a
 * browser through `page.addInitScript()` with no bundler -- see
 * `fakeMapKitInitScript()` in `./index.ts`, and the round-trip test in
 * `tests/testing/init-script.test.ts` that evaluates the generated source in an
 * isolated realm and drives the resulting namespace.
 *
 * Do not add a value import to this file, do not reference a module-scope
 * constant from inside the function, and do not hoist a helper out of it.
 */
export declare function createFakeMapKitRuntime(rawOptions?: FakeMapKitOptions): FakeMapKitRuntime;
//# sourceMappingURL=runtime.d.ts.map