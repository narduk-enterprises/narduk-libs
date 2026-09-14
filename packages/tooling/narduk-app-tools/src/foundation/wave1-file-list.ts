/**
 * The narduk-libs#76 "Wave 1 -- adopt existing" fork list, for item 4.2 (spec
 * §3 item 4: "no local copy of package-owned behaviour" -- "the #76 Wave-1
 * file list, by whitespace-normalised content hash").
 *
 * Each entry is a KNOWN vendored copy of behaviour a narduk-libs package now
 * owns: a `sha256` of its whitespace-normalised content (see
 * `normalizedContentHash()` below), which package/command replaces it, and
 * which repos were seen carrying it at the time this list was built
 * (2026-09-04, from local checkouts of the four `narduk-enterprises-clients`
 * template consumers named in #76's Wave 1 section). This is a DENYLIST of
 * fingerprints, not an allowlist of paths: `foundation:check` walks the
 * checkout and flags any file whose normalised content matches one of these
 * hashes, regardless of where it lives.
 *
 * This list is expected to grow as more Wave-1 items are confirmed identical
 * across consumers; a hash that stops matching any real file (because the
 * fork was deleted, which is the point) is inert, not wrong.
 */

export interface Wave1ForkEntry {
  /** Stable id for this fingerprint, used in sub-check evidence. */
  id: string
  /** What the vendored file used to do. */
  description: string
  /** The narduk-libs package (or `narduk-app-tools` command) that now owns it. */
  ownedBy: string
  /** sha256 of `normalizedContentHash()` applied to the forked file's content. */
  sha256: string
  /** Repo-relative paths this fork was known to live at, for operator context
   * only -- matching is by hash, never by path. */
  knownPaths: string[]
}

export const WAVE1_FORK_LIST: Wave1ForkEntry[] = [
  {
    id: 'narduk-toolchain-wrapper',
    description:
      'the client-template db-migrate/deploy-local/registry-auth wrapper script, byte-identical ' +
      'across harmony-hot-sauce, llb-cpa, tprinvest and papa-everetts-pizza per #76 Wave 1',
    ownedBy: '@narduk-enterprises/narduk-app-tools (db migrate / deploy-local / registry-auth)',
    sha256: '1b6f3139340b6db909f012d95302a0e1da55dd3ea52bb9eb76a173f6596e6acd',
    knownPaths: ['scripts/narduk-toolchain.mjs'],
  },
  {
    id: 'package-registry-auth-variant-a',
    description:
      'the client-template GitHub Packages auth script (harmony-hot-sauce / llb-cpa variant) ' +
      'replaced by narduk-app-tools registry-auth',
    ownedBy: '@narduk-enterprises/narduk-app-tools (registry-auth)',
    sha256: 'e61307de84c9f5e321eda56551b003db3cd51942227b1b1618763bd0b730c096',
    knownPaths: ['scripts/package-registry-auth.mjs'],
  },
  {
    id: 'package-registry-auth-variant-b',
    description:
      'the client-template GitHub Packages auth script (tprinvest / papa-everetts-pizza variant) ' +
      'replaced by narduk-app-tools registry-auth',
    ownedBy: '@narduk-enterprises/narduk-app-tools (registry-auth)',
    sha256: '366d088bab9075854fdd50e75a0ac440aeaf808b4414069b12a467ef859f4042',
    knownPaths: ['scripts/package-registry-auth.mjs'],
  },
  {
    id: 'lakestat-freshness-chip',
    description:
      "lakestat-us's local FreshnessChip.vue, forking narduk-ui's NsFreshnessChip component (#76 " +
      'Wave 1: "narduk-ui NsFreshnessChip -- lakestat still has a local FreshnessChip.vue")',
    ownedBy: '@narduk-enterprises/narduk-ui (NsFreshnessChip)',
    sha256: '1a96ea502c6f67e31f97722ef50b56c91755d7dd58c6f8b58cda69553c810801',
    knownPaths: ['apps/web/app/components/lakestat/FreshnessChip.vue'],
  },
]

/** Directories `foundation:check` walks looking for a Wave-1 fork. Bounded on
 * purpose -- every known fork so far lives under one of these; a full-repo
 * walk would cost minutes on a large app for no better signal. */
export const WAVE1_SCAN_DIRS = [
  'scripts',
  'tests',
  'apps/web/app/components',
  'app/components',
  'components',
] as const

export const WAVE1_SCAN_EXTENSIONS = ['.mjs', '.js', '.ts', '.vue'] as const
