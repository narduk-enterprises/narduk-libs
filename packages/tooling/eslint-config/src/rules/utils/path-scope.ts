/**
 * Shared, segment-aware path gates for every rule in this package.
 *
 * v1 open-coded its path gates and got them wrong twice over:
 *
 *  1. **The leading-slash bug class.** Eight rules gated on
 *     `filename.includes('/app/stores/')`. ESLint hands rules whatever
 *     filename the caller used, and `eslint .` (plus every RuleTester case
 *     that passes a relative `filename`) produces *relative* paths such as
 *     `app/stores/user.ts`. Those have no leading slash, so the gate was
 *     permanently false and the rule was dead in exactly the configuration
 *     apps run.
 *
 *  2. **The `myapp/app/` first-index bug.** The naive fix — also accepting
 *     `startsWith('app/')` or searching for the bare substring `app/` — makes
 *     the gate match *inside another segment*. `packages/myapp/app/…` contains
 *     the substring `app/` at index 12 (the tail of `myapp/`), so any code
 *     that searched for the first occurrence resolved the wrong app root.
 *
 * Both classes disappear once the path is compared **by segment** instead of
 * by substring, which is what this module does. Every rule in this package
 * must use these helpers rather than re-deriving a gate inline.
 */

/** Windows drive prefix (`C:`), dropped during normalization. */
const WINDOWS_DRIVE_SEGMENT = /^[a-z]:$/i

/** `foo.test.ts`, `foo.spec.vue`, `helpers.test.utils.ts`, … */
const TEST_FILE_INFIX = /\.(?:test|spec)\./i

/**
 * Directory names that mean "this file is test or fixture code".
 *
 * The union of the seven divergent inline copies v1 shipped
 * (`utils/nuxt-detection.ts`, `cloudflare/utils.ts`, `hydration/no-ssr-dom-access.ts`,
 * and four more in `nuxt/` and `server/`), so no rule loses an exemption it
 * previously had.
 */
const TEST_DIRECTORY_SEGMENTS = new Set([
  '__fixtures__',
  '__mocks__',
  '__snapshots__',
  '__test__',
  '__tests__',
  'e2e',
  'fixtures',
  'spec',
  'specs',
  'test',
  'tests',
])

/**
 * Normalize a filename to POSIX separators.
 *
 * Convenience for rules that need the raw string; the two gates below are the
 * supported contract and should be preferred.
 */
export function toPosixPath(filename: string): string {
  return typeof filename === 'string' ? filename.replaceAll('\\', '/') : ''
}

/**
 * Split a filename into meaningful path segments.
 *
 * Drops empty segments (leading `/`, doubled separators, trailing `/`), `.`,
 * and a Windows drive prefix, so absolute, relative, POSIX and Windows spellings
 * of the same file produce the same comparable segment list.
 */
function toSegments(filename: string): string[] {
  const normalized = toPosixPath(filename)

  if (normalized.length === 0) {
    return []
  }

  return normalized
    .split('/')
    .filter(
      (segment) => segment.length > 0 && segment !== '.' && !WINDOWS_DRIVE_SEGMENT.test(segment),
    )
}

/**
 * Is `filename` inside the directory described by `segments`?
 *
 * The segments must appear as a **contiguous run, in the given order**, and the
 * run must end above the file itself — matching what v1's `/app/stores/`-style
 * gates meant, without either of their bugs. Works identically for absolute and
 * relative filenames, and for POSIX and Windows separators.
 *
 * Each argument may itself contain separators, so `inAppScope(f, 'app/stores')`
 * and `inAppScope(f, 'app', 'stores')` are equivalent.
 *
 * ```ts
 * inAppScope('app/stores/user.ts', 'app', 'stores')                  // true
 * inAppScope('/repo/myapp/app/stores/user.ts', 'app', 'stores')      // true
 * inAppScope('C:\\repo\\app\\stores\\user.ts', 'app', 'stores')      // true
 * inAppScope('packages/myapp/stores/user.ts', 'app', 'stores')       // false — `myapp` is not `app`
 * inAppScope('app/stores', 'app', 'stores')                          // false — that is the directory, not a file in it
 * ```
 */
export function inAppScope(filename: string, ...segments: string[]): boolean {
  return findDirectoryRun(filename, segments) !== null
}

/**
 * The segments of `filename` below the first directory run `segments` names,
 * or `null` when `filename` is not inside one. Matching is exactly
 * `inAppScope`'s, so a rule that gates on `inAppScope(f, 'components')` and
 * then needs the path *under* that root gets both answers from one definition.
 *
 * This is the segment-aware replacement for `filename.indexOf('components/')`,
 * which matched inside a checkout directory such as `app-components/` and made
 * every folder after it count (narduk-libs#777).
 *
 * ```ts
 * segmentsAfter('app/components/orders/Row.vue', 'app', 'components')  // ['orders', 'Row.vue']
 * segmentsAfter('/w/app-components/repo/components/Row.vue', 'components')  // ['Row.vue']
 * segmentsAfter('app/pages/index.vue', 'components')                    // null
 * ```
 */
export function segmentsAfter(filename: string, ...segments: string[]): string[] | null {
  const run = findDirectoryRun(filename, segments)
  return run === null ? null : run.parts.slice(run.end)
}

/**
 * Locate the first contiguous, in-order run of `segments` in `filename`'s
 * segments that ends above the basename. `end` is the index just past it.
 */
function findDirectoryRun(
  filename: string,
  segments: readonly string[],
): { end: number; parts: string[] } | null {
  const wanted = segments
    .flatMap((segment) => toPosixPath(segment).split('/'))
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (wanted.length === 0) {
    return null
  }

  const parts = toSegments(filename)

  // The run has to sit strictly above the basename: the last segment is the
  // file, and a rule asking for `app/stores` means "a file *inside* it".
  const runEndLimit = parts.length - 1

  for (let start = 0; start + wanted.length <= runEndLimit; start += 1) {
    let matched = true

    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (parts[start + offset] !== wanted[offset]) {
        matched = false
        break
      }
    }

    if (matched) {
      return { end: start + wanted.length, parts }
    }
  }

  return null
}

/**
 * Is `filename` test, spec, or fixture code?
 *
 * Rules use this to stay quiet in test code, where the pattern they guard
 * against is usually deliberate. Segment-aware, so it fires for a relative
 * `tests/server/api.test.ts` — v1's `includes('/tests/')` copies did not.
 *
 * **Do not use this inside a deployed server-route tree.** A `.test.` infix in
 * the *basename* is a naming convention, not a deployment boundary, and Nitro
 * routes `server/api/deploy.test.post.ts` exactly like any other handler. Use
 * `inTestOrFixtureDirectory()` there — `isExemptTestPath()` in
 * `utils/mutation-route` selects between the two.
 */
export function isTestOrFixturePath(filename: string): boolean {
  const parts = toSegments(filename)

  if (parts.length === 0) {
    return false
  }

  // Any segment may carry the infix: `api.test.ts`, and also a directory
  // spelled `foo.spec.d`, which v1's whole-path `includes('.test.')` matched.
  if (parts.some((segment) => TEST_FILE_INFIX.test(segment))) {
    return true
  }

  // Directory segments only — a file literally named `tests.ts` is not a test.
  // Compared case-insensitively so a `Tests/` directory is not a silent hole.
  return parts.slice(0, -1).some((segment) => TEST_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))
}

/**
 * Is `filename` inside a test or fixture **directory**?
 *
 * The basename is never consulted, so this is the exemption a deployed route
 * tree can safely use: a file only escapes a security rule by *living
 * somewhere Nitro does not serve from*, never by how it is spelled.
 *
 * The adversarial pass that produced this split shipped
 * `server/api/deploy.test.post.ts` containing `sql.raw(untrustedSql)` and every
 * server-tier rule went quiet — `isTestOrFixturePath()` matched the infix and
 * suppressed the whole tier on a route Nitro deploys as `POST /api/deploy.test`.
 *
 * ```ts
 * inTestOrFixtureDirectory('server/api/deploy.test.post.ts')   // false — a real route
 * inTestOrFixtureDirectory('tests/server/api/deploy.post.ts')  // true
 * inTestOrFixtureDirectory('server/api/__tests__/x.post.ts')   // true
 * inTestOrFixtureDirectory('app/fixtures.spec.d/x.ts')         // true — infix on a directory
 * ```
 */
export function inTestOrFixtureDirectory(filename: string): boolean {
  const parts = toSegments(filename)

  if (parts.length === 0) {
    return false
  }

  return parts
    .slice(0, -1)
    .some(
      (segment) =>
        TEST_DIRECTORY_SEGMENTS.has(segment.toLowerCase()) || TEST_FILE_INFIX.test(segment),
    )
}

/**
 * Any Nitro `server/` source — handlers, utils, plugins, middleware — at any
 * nesting depth, relative or absolute. Wider than the route-only
 * `analyzeServerRoutePath()`; used by rules about server code in general.
 */
export function isServerSourcePath(filename: string): boolean {
  const normalized = toPosixPath(filename)
  return normalized.startsWith('server/') || normalized.includes('/server/')
}
