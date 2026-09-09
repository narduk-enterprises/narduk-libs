/**
 * Output classification for the packed-consumer smoke gate.
 *
 * `runChecked()` in scripts/release-packages.mjs fails the gate when a
 * subprocess emits ANY warning-shaped line, not only when it exits non-zero.
 * That fail-closed contract is load-bearing and predates this module: it is
 * what caught the ESLint 9/10 peer-dependency drift in PR #51 (run
 * 30764151785), where the packed consumer installed cleanly with exit code 0
 * while pnpm reported unmet peers, and it is why the eslint/unhead pins at the
 * top of release-packages.mjs are read from the workspace instead of
 * hardcoded. Nothing here loosens that: unexpected output still fails.
 *
 * It lives in its own module purely so `node --test` can cover it.
 * release-packages.mjs is an executable script with top-level side effects
 * (it packs tarballs and exits), so a test cannot import it.
 */

const warningOrErrorTokenPattern =
  /(?:^|[\s:[(])(?:warn(?:ing)?|error)(?=$|[\s:\])])|(?:deprecation|experimental|MaxListenersExceeded)Warning:/iu

/**
 * pnpm warnings that report only how slow the network was, on a request that
 * SUCCEEDED. Both are emitted from pnpm's success paths (verified against
 * pnpm 10.33.4's dist/pnpm.cjs):
 *
 *  - `Request took <n>ms: <uri>` fires after `response.json()` resolves, when
 *    the elapsed time exceeds `fetchWarnTimeoutMs` (default 10_000). The
 *    metadata document was fetched and parsed correctly; only the clock was
 *    unusual.
 *  - `Tarball download average speed …` fires after the tarball downloaded in
 *    full and passed pnpm's expected-size integrity check, when average
 *    throughput was under `fetchMinSpeedKiBps`.
 *
 * Neither says anything about the packed artifacts under test, so neither can
 * be a true positive for this gate — but both used to turn it red. On
 * 2026-08-27 the `packed-consumer-smoke` job failed five consecutive times
 * between 15:05 and 15:31 UTC (runs 33085892640, 33086539818 across three
 * attempts, and 33087897977 on `main`) with nothing in the findings but a
 * single `Request took {42002,43138,44766,46789,47696}ms:
 * https://registry.npmjs.org/@typescript-eslint%2Ftypes`, on a diff that had
 * passed the same gate at 14:43 on the same runner pool (narduk-libs#98). The
 * stall itself is a runner-network problem, filed separately against the pool
 * owner; that it could ever fail this gate is the bug fixed here.
 *
 * These patterns match the WHOLE line, anchored at both ends, against pnpm's
 * exact message shape. A real failure that merely quotes one of these phrases
 * (`ERROR  Request took …ms: … failed`, a build script echoing the text) does
 * not match and still fails the gate. Add an entry here only for output that
 * is provably emitted from a success path and provably carries no signal about
 * the artifacts — a warning that is merely inconvenient does not qualify.
 *
 * pnpm renders warnings as `\u2009WARN\u2009 <message>`; U+2009 THIN SPACE is
 * Unicode whitespace, so `\s` covers it.
 */
const networkLatencyOnlyWarningPatterns = [
  // \u2009WARN\u2009 Request took 43138ms: https://registry.npmjs.org/@typescript-eslint%2Ftypes
  /^\s*WARN\s+Request took \d+ms: \S+$/u,
  // \u2009WARN\u2009 Tarball download average speed 12 KiB/s (size 3400 KiB) is below 100 KiB/s: https://… (GET)
  /^\s*WARN\s+Tarball download average speed \d+ KiB\/s \(size \d+ KiB\) is below \d+ KiB\/s: \S+ \(GET\)$/u,
]

/**
 * Bundler warnings about THIRD-PARTY source that the bundler itself resolves
 * on its success path. Same bar as the network patterns above: provably
 * emitted from a success path, provably carrying no signal about the packed
 * artifacts under test.
 *
 * The one entry so far is Rollup's misplaced-`@__PURE__`-annotation notice.
 * `zod@4.5.1` (published 2026-08-28T17:58Z) ships three such comments, so the
 * generated consumer's `vite build` prints, per occurrence:
 *
 *   [warn] ../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/util.js (330:0): A comment
 *
 *   (followed by the annotation comment itself on its own line)
 *
 *   in "…/node_modules/zod/v4/core/util.js" contains an annotation that Rollup
 *   cannot interpret due to the position of the comment. The comment will be
 *   removed to avoid issues.
 *
 * Only the first line carries a warn token, so only it reaches the findings.
 * Rollup then drops the comment and completes the build — the artifact is
 * unaffected, and the code being complained about is upstream's, addressable
 * only by an upstream release. That combination turned every run of this gate
 * red from 17:58Z onward with a diff that had nothing to do with it
 * (narduk-libs#101, first hit run 33203587597).
 *
 * The pattern is anchored to the whole line and requires BOTH the
 * `node_modules/` path segment and Rollup's exact first-line shape. A
 * first-party file emitting the same notice (`[warn] src/… (1:0): A comment`)
 * still fails the gate, as does any `[error]` about a third-party path. When a
 * different third-party warning class breaks the train next, it gets its own
 * entry here if and only if it clears the same bar — do not widen this one.
 */
const thirdPartyBundlerNoticePatterns = [
  // [warn] ../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/regexes.js (70:0): A comment
  /^(?:\[warn\]|WARN)\s+\S*node_modules\/\S+ \(\d+:\d+\): A comment$/u,
]

export function stripAnsi(value) {
  return value.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
}

/**
 * True when `line` is one of the pure network-latency observations above and
 * therefore must not fail the gate.
 */
export function isNetworkLatencyOnlyWarning(line) {
  return networkLatencyOnlyWarningPatterns.some((pattern) => pattern.test(line))
}

/**
 * True when `line` is a bundler notice about third-party source, resolved on
 * the bundler's own success path, and therefore must not fail the gate.
 */
export function isThirdPartyBundlerNotice(line) {
  return thirdPartyBundlerNoticePatterns.some((pattern) => pattern.test(line))
}

/**
 * Every warning/error-shaped line in `output` that the smoke gate should fail
 * on, trimmed, in order. Empty means the output is clean.
 */
export function collectWarningFindings(output) {
  return stripAnsi(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        warningOrErrorTokenPattern.test(line) &&
        !isNetworkLatencyOnlyWarning(line) &&
        !isThirdPartyBundlerNotice(line),
    )
}
