/**
 * Who owns which generated file after scaffolding.
 *
 * `create-narduk-app` is a one-shot generator: this repository's AGENTS.md
 * forbids it from holding "a continuing sync, reconcile, drift, or control-plane
 * relationship with apps". `upgrade` therefore does not re-apply the scaffold.
 * It re-applies the small, named set below -- and the unit it owns is usually
 * smaller than the file, because the reference app proves that the files
 * themselves carry real app-owned content (its `ci.yml` caller inputs, its own
 * Playwright configuration, its own fifty-odd package scripts).
 *
 * Anything not named here is `seed`: created once at scaffold time, app-owned
 * afterwards, and never read or written by `upgrade`.
 */

/** Comment forms a file may use to disown a managed target, by extension. */
const UNMANAGED_COMMENT_SYNTAX: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(?:md|markdown)$/u, '<!-- narduk:unmanaged -->'],
  [/\.ya?ml$/u, '# narduk:unmanaged'],
  [/\.(?:ts|mts|js|mjs)$/u, '// narduk:unmanaged'],
]

/**
 * The opt-out token. An app writes it in its own comment syntax inside the
 * first {@link UNMANAGED_SCAN_LINES} lines of a managed file; `upgrade` then
 * reports the file as unmanaged, never rewrites it, and does not count it as
 * drift. This is the sanctioned home for an app-owned Dependabot
 * security-exception `ignore` rule or a divergent end-to-end test layout.
 */
export const UNMANAGED_MARKER = 'narduk:unmanaged'

/** Only a header opt-out counts, so the token cannot be tripped by prose. */
export const UNMANAGED_SCAN_LINES = 5

/** Markers delimiting a generator-owned region inside an app-owned file. */
export const REGION_MARKERS = {
  agentsRouter: {
    start: '<!-- narduk:router:start -->',
    end: '<!-- narduk:router:end -->',
  },
  // The end-to-end flake policy is estate policy stated in an app-owned
  // document: the surrounding prose describes the app's own specs and must
  // stay app-owned, while the retry/quarantine rules have one right answer
  // for every app and should converge.
  e2eFlakePolicy: {
    start: '<!-- narduk:e2e-policy:start -->',
    end: '<!-- narduk:e2e-policy:end -->',
  },
} as const

export type RegionName = keyof typeof REGION_MARKERS

/**
 * The shared-workflow reference in an app's own CI caller. The caller's inputs
 * are the app's policy (shard count, e2e arguments, build artefact path); the
 * pinned SHA is estate policy, and is the part that actually goes stale.
 */
export const CI_CALLER_PIN_PATTERN =
  /narduk-enterprises\/workflows\/\.github\/workflows\/nuxt-cloudflare\.yml@[0-9a-f]{40}/u

/**
 * Root `package.json` scripts whose exact body is a contract rather than a
 * preference: an artefact path the compliance audit reads, the environment
 * that decides which Worker shape CI builds, or the migration-source and
 * database-name arguments `narduk-app db migrate` requires.
 *
 * Deliberately excluded: `foundation:shared-ui-pinned` (two valid shapes exist
 * in the estate -- delegate to `apps/web`, or run the checker at the root and
 * emit its own JSON -- so the script NAME is the contract, via the CI caller's
 * `extra-scripts`, and the body is app-local), every dependency version
 * (Dependabot owns estate package currency under D-TOOLCHAIN-1, and two
 * mechanisms editing the same lines is the reconcile relationship this
 * generator must not have), and every other script an app has added.
 */
export const MANAGED_SCRIPT_KEYS = [
  'build:ci',
  'db:migrate:local',
  'db:migrate:remote',
  'foundation:check',
  'manifests:validate',
] as const

export type OwnershipMode = 'file' | 'keys' | 'pin' | 'region'

export interface ManagedTarget {
  /** Path relative to the app root, matching the generated file's path. */
  path: string
  mode: OwnershipMode
  /** Human-readable description of the owned unit, printed in the summary. */
  unit: string
  /** Which marker pair delimits the region. Required for `region` targets. */
  region?: RegionName
}

/**
 * Every unit `upgrade` refreshes. Adding a row here is a deliberate decision,
 * and `file` mode is reserved for machine-consumed configuration that carries
 * no app-specific content by construction. Prose and app code stay `seed`:
 * running the codemod against the reference app proved the point, because its
 * own `docs/e2e-testing.md` documents its real specs and its own
 * `playwright.config.ts` is ahead of this generator's template, so managing
 * either would have proposed a regression rather than an upgrade.
 */
export const MANAGED_TARGETS: readonly ManagedTarget[] = [
  {
    path: '.github/workflows/ci.yml',
    mode: 'pin',
    unit: 'shared nuxt-cloudflare workflow pin',
  },
  {
    path: '.github/workflows/copilot-setup-steps.yml',
    mode: 'file',
    unit: 'whole file',
  },
  { path: '.github/dependabot.yml', mode: 'file', unit: 'whole file' },
  { path: 'AGENTS.md', mode: 'region', region: 'agentsRouter', unit: 'narduk:router block' },
  {
    path: 'docs/e2e-testing.md',
    mode: 'region',
    region: 'e2eFlakePolicy',
    unit: 'narduk:e2e-policy block',
  },
  {
    path: 'package.json',
    mode: 'keys',
    unit: 'scripts: ' + MANAGED_SCRIPT_KEYS.join(', '),
  },
]

export function managedTargetFor(path: string): ManagedTarget | undefined {
  return MANAGED_TARGETS.find((target) => target.path === path)
}

/** The opt-out token in the comment syntax the given path actually uses. */
export function unmanagedMarkerFor(path: string): string {
  const match = UNMANAGED_COMMENT_SYNTAX.find(([pattern]) => pattern.test(path))
  return match ? match[1] : '# ' + UNMANAGED_MARKER
}

/** True when the app has disowned this file in its own header. */
export function isDisowned(contents: string): boolean {
  return contents
    .split('\n')
    .slice(0, UNMANAGED_SCAN_LINES)
    .some((line) => line.includes(UNMANAGED_MARKER))
}
