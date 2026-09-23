// Which changed workspace packages need a human Changeset, and which are
// released automatically.
//
// `changeset status` cannot answer this: it treats *any* file under a package
// directory as a change that needs a Changeset and exits 1, so a Dependabot
// devDependency bump across 26 packages fails the `contracts` gate with a diff
// that cannot affect a single published artifact (narduk-libs PR #323, run
// 35173069724). This module classifies each changed package instead, and the
// release plan itself is read with `@changesets/get-release-plan`, which never
// errors on "changed but no changeset".
//
// Four verdicts per changed package:
//
// - `ok`             nothing about the published artifact changed.
// - `frozen`         the package is in the Changesets `ignore` list, so it
//                    cannot be versioned at all and owes no release however
//                    much of it changed. A Changeset naming it would make
//                    `changeset version` throw rather than release it, so
//                    "add a Changeset" is not an available answer here.
// - `deferred`       only runtime dependency *ranges* moved. The published
//                    manifest now differs from `main`, so the package does
//                    need a patch release -- but the release job synthesizes
//                    that Changeset from registry evidence
//                    (scripts/synthesize-manifest-drift.mjs), so no human
//                    commit is required on the branch.
// - `needs-changeset` everything else.
//
// The field lists are allowlists on purpose: a manifest field this module has
// never heard of is release-relevant, so a new npm field cannot silently
// become exempt.

import { posix } from 'node:path'

// Manifest fields whose change cannot reach a consumer of the published
// tarball. Everything not named here is release-relevant.
//
// - `devDependencies`: stripped from nothing (npm publishes the field) but
//   never installed for a consumer of the tarball, and never part of the
//   package's own build output -- the build runs from this repository's
//   lockfile, not from a consumer's resolution of these ranges.
// - `scripts`: published verbatim, but only the lifecycle keys below run for
//   anyone other than this repository. See PUBLISH_LIFECYCLE_SCRIPTS.
export const DEV_ONLY_MANIFEST_FIELDS = Object.freeze(['devDependencies', 'scripts'])

// Script keys that run when this repository packs/publishes the package, or
// when a consumer installs it. A change to one of these changes the published
// artifact or the consumer's install, so it is release-relevant even though
// the rest of `scripts` is not. `build` is included because every packing
// lifecycle script in this workspace delegates to it (`prepare`, `prepack`).
export const PUBLISH_LIFECYCLE_SCRIPTS = Object.freeze([
  'build',
  'install',
  'postinstall',
  'postpack',
  'postprepare',
  'postpublish',
  'prepack',
  'preinstall',
  'prepare',
  'preprepare',
  'prepublish',
  'prepublishOnly',
  'publish',
])

// The list above is a seed, not the answer. npm runs `pre<name>`/`post<name>`
// around each of those keys, and this workspace's lifecycle scripts delegate
// further: `prebuild` exists in seven packages, and narduk-timeseries' is
// `node scripts/clean-dist.mjs && pnpm run deps:build`. Editing either changes
// the packed artifact, so the release-relevant set is the closure of the seed
// over `run <key>` references inside the same manifest. Over-approximating is
// deliberate: a script key that turns out not to run costs one Changeset,
// while a missed one ships a changed tarball with no release.
export function publishLifecycleScriptKeys(scripts = {}) {
  const relevant = new Set()
  const pending = []
  for (const key of PUBLISH_LIFECYCLE_SCRIPTS) {
    for (const name of [key, `pre${key}`, `post${key}`]) {
      if (relevant.has(name)) continue
      relevant.add(name)
      pending.push(name)
    }
  }
  while (pending.length > 0) {
    const body = scripts[pending.pop()]
    if (typeof body !== 'string') continue
    for (const [, referenced] of body.matchAll(/\brun\s+(?:-\S+\s+)*([\w@/:.-]+)/gu)) {
      if (!(referenced in scripts) || relevant.has(referenced)) continue
      relevant.add(referenced)
      pending.push(referenced)
    }
  }
  return relevant
}

// Dependency sections whose *range* changes are released automatically by
// release-time manifest-drift synthesis. `peerDependencies` is deliberately
// absent: a peer range is the package's own compatibility contract, and
// widening or moving it is a semver decision a human makes in a Changeset.
export const DEFERRED_DEPENDENCY_FIELDS = Object.freeze(['dependencies', 'optionalDependencies'])

// A range in one of these protocols is resolved to a concrete version at
// publish time, so release-time drift synthesis cannot compare it against the
// registry. Deferring such a change would owe a release nothing ever writes.
const LINKED_PROTOCOLS = ['workspace:', 'catalog:']

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

// Key-order-insensitive deep comparison: `pnpm add` and Dependabot both
// rewrite manifests, and a reordered `dependencies` block is not a change.
export function changedKeys(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...keys]
    .filter((key) => stableStringify((before || {})[key]) !== stableStringify((after || {})[key]))
    .sort()
}

function isLinkedSpecifier(value) {
  return typeof value === 'string' && LINKED_PROTOCOLS.some((p) => value.startsWith(p))
}

/**
 * Classify one package manifest diff.
 *
 * @param {object|undefined} before manifest at the comparison base
 * @param {object|undefined} after manifest at the head
 * @returns {{devOnly: Array, deferred: Array, releaseRelevant: Array}}
 */
export function classifyManifestChange(before, after) {
  const devOnly = []
  const deferred = []
  const releaseRelevant = []

  if (!before && !after) return { devOnly, deferred, releaseRelevant }
  if (!before || !after) {
    // The manifest itself appeared or disappeared: the package is new or
    // removed, which is always a release decision.
    releaseRelevant.push({ field: 'package.json', keys: [], reason: before ? 'removed' : 'added' })
    return { devOnly, deferred, releaseRelevant }
  }

  for (const field of changedKeys(before, after)) {
    if (field === 'scripts') {
      const keys = changedKeys(before.scripts, after.scripts)
      // Both sides: adding and removing a delegation are equally relevant.
      const reachable = new Set([
        ...publishLifecycleScriptKeys(before.scripts),
        ...publishLifecycleScriptKeys(after.scripts),
      ])
      const lifecycle = keys.filter((key) => reachable.has(key))
      if (lifecycle.length > 0) {
        releaseRelevant.push({ field, keys: lifecycle, reason: 'publish lifecycle script' })
      } else {
        devOnly.push({ field, keys })
      }
      continue
    }

    if (DEV_ONLY_MANIFEST_FIELDS.includes(field)) {
      devOnly.push({ field, keys: changedKeys(before[field], after[field]) })
      continue
    }

    if (DEFERRED_DEPENDENCY_FIELDS.includes(field)) {
      const beforeSection = before[field] || {}
      const afterSection = after[field] || {}
      const keys = changedKeys(beforeSection, afterSection)
      const added = keys.filter((key) => !(key in beforeSection))
      const removed = keys.filter((key) => !(key in afterSection))
      // A `workspace:` or `catalog:` specifier is rewritten to a concrete
      // version at publish time, so drift synthesis cannot compare it against
      // the registry.
      const linked = keys.filter(
        (key) => isLinkedSpecifier(beforeSection[key]) || isLinkedSpecifier(afterSection[key]),
      )
      if (added.length > 0 || removed.length > 0 || linked.length > 0) {
        releaseRelevant.push({
          field,
          keys,
          reason:
            added.length > 0 || removed.length > 0
              ? 'dependency added or removed'
              : 'workspace- or catalog-linked dependency',
        })
      } else {
        deferred.push({ field, keys })
      }
      continue
    }

    releaseRelevant.push({ field, keys: changedKeys(before[field], after[field]) })
  }

  return { devOnly, deferred, releaseRelevant }
}

/**
 * Package-root files that feed only this repository's own gates and are in no
 * package's `files` list, so no tarball contains them (pinned by
 * scripts/lint-budget-strict.test.mjs). Changing one changes nothing a
 * consumer installs, so, like a devDependency bump, it owes no release.
 * `lint-budget.json` is narduk-lint's warning budget (#673).
 */
export const NEVER_PUBLISHED_FILES = new Set(['lint-budget.json'])

/**
 * Package paths that hold only tests and test configuration (#686). A change to
 * one owes no release **only when the package's `files` list leaves it out**:
 * narduk-analytics, for example, publishes its `vitest.config.ts`.
 *
 * Both conditions are needed. `files` alone is not enough, because a package
 * that publishes `dist/` builds it from `src/` at pack time, so `src/` is
 * outside `files` and still changes the tarball. This list names paths no
 * package in this workspace builds from; anything it does not name keeps the
 * original requirement.
 */
export const TEST_ONLY_PATH_PATTERNS = Object.freeze([
  /^(?:tests?|__tests__|e2e)\//u,
  /^(?:vitest|playwright)(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/u,
])

// npm packs these from the package root whatever `files` says.
const ALWAYS_PACKED = /^(?:package\.json|readme|licen[cs]e|changelog)(?:\.[^/]*)?$/iu
const GLOB_CHARS = /[*?[\]{}!]/u

/**
 * Whether `relativePath` is inside the package's `files` surface. No `files`
 * list means npm packs everything, and a glob this cannot evaluate counts as a
 * match, so every doubt resolves toward "published".
 *
 * @param {string} relativePath posix path relative to the package root
 * @param {unknown} files the manifest's `files` field
 */
export function isInPublishedFiles(relativePath, files) {
  if (!Array.isArray(files)) return true
  if (ALWAYS_PACKED.test(relativePath)) return true
  return files.some((entry) => {
    if (typeof entry !== 'string') return true
    const pattern = entry.replace(/^\.\//u, '').replace(/\/+$/u, '')
    if (!GLOB_CHARS.test(pattern)) {
      return relativePath === pattern || relativePath.startsWith(`${pattern}/`)
    }
    if (typeof posix.matchesGlob !== 'function') return true
    return (
      posix.matchesGlob(relativePath, pattern) || posix.matchesGlob(relativePath, `${pattern}/**`)
    )
  })
}

function owesNoRelease(relativePath, files) {
  if (NEVER_PUBLISHED_FILES.has(relativePath)) return true
  return (
    TEST_ONLY_PATH_PATTERNS.some((pattern) => pattern.test(relativePath)) &&
    !isInPublishedFiles(relativePath, files)
  )
}

function packageForPath(packages, path) {
  return packages
    .filter(
      (workspacePackage) =>
        path === workspacePackage.relativeDirectory ||
        path.startsWith(`${workspacePackage.relativeDirectory}/`),
    )
    .sort((left, right) => right.relativeDirectory.length - left.relativeDirectory.length)[0]
}

/**
 * Classify every workspace package touched by a diff.
 *
 * @param {object} options
 * @param {Array<{name: string, relativeDirectory: string, private?: boolean, frozen?: boolean, files?: unknown}>} options.packages
 *   `files` is the head manifest's `files` field.
 * @param {string[]} options.changedFiles posix paths relative to the repo root
 * @param {(relativeDirectory: string) => {before: object|undefined, after: object|undefined}} options.readManifests
 * @returns {Array<{name: string, verdict: string, otherFiles: string[], manifest: object}>}
 */
export function classifyChangedPackages({ packages, changedFiles, readManifests }) {
  const touched = new Map()

  for (const path of changedFiles) {
    const workspacePackage = packageForPath(packages, path)
    if (!workspacePackage) continue
    if (!touched.has(workspacePackage.name)) {
      touched.set(workspacePackage.name, {
        workspacePackage,
        otherFiles: [],
        manifestChanged: false,
      })
    }
    const entry = touched.get(workspacePackage.name)
    const relativePath = path.slice(workspacePackage.relativeDirectory.length + 1)
    if (relativePath === 'package.json') entry.manifestChanged = true
    else if (!owesNoRelease(relativePath, workspacePackage.files)) {
      entry.otherFiles.push(relativePath)
    }
  }

  return [...touched.values()]
    .map(({ workspacePackage, otherFiles, manifestChanged }) => {
      let manifest = { devOnly: [], deferred: [], releaseRelevant: [] }
      if (manifestChanged) {
        const { before, after } = readManifests(workspacePackage.relativeDirectory)
        manifest = classifyManifestChange(before, after)
      }

      let verdict = 'ok'
      // A package in the Changesets `ignore` list cannot be versioned at all,
      // so no release is owed however much of it changed -- and a Changeset
      // naming it would make `changeset version` throw rather than release it.
      // Reported as its own verdict, not folded into `ok`: a frozen package
      // whose source keeps moving is a fact an operator should see.
      if (workspacePackage.frozen === true) verdict = 'frozen'
      else if (otherFiles.length > 0 || manifest.releaseRelevant.length > 0)
        verdict = 'needs-changeset'
      else if (manifest.deferred.length > 0) {
        // A private package is never published, so no registry drift exists
        // for synthesis to find and no release is owed.
        verdict = workspacePackage.private === true ? 'ok' : 'deferred'
      }

      return {
        name: workspacePackage.name,
        private: workspacePackage.private === true,
        frozen: workspacePackage.frozen === true,
        verdict,
        otherFiles: otherFiles.sort(),
        manifest,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * The Changesets `ignore` list, matched the way Changesets itself matches it:
 * exact package names (`@changesets/should-skip-package` does
 * `ignore.includes(packageJson.name)`). `@changesets/config` also expands
 * globs there; this workspace has never used one, and a glob this function
 * under-matches degrades to the previous loud failure rather than to a silent
 * wrong release.
 *
 * Lives here because this module imports nothing from this repository, so both
 * `check-generator-release-plan.mjs` and `synthesize-manifest-drift.mjs` can
 * read one definition without an import cycle between them.
 *
 * @param {object} config parsed `.changeset/config.json`
 * @returns {string[]}
 */
export function ignoredPackageNames(config) {
  const ignore = config?.ignore
  return Array.isArray(ignore) ? ignore.filter((name) => typeof name === 'string') : []
}

function describeEntry({ field, keys, reason }) {
  const named = keys.length > 0 ? ` (${keys.join(', ')})` : ''
  return `${field}${named}${reason ? ` -- ${reason}` : ''}`
}

export function describePackageVerdict(entry) {
  const reasons = [
    ...entry.otherFiles.map((path) => `${path} changed`),
    ...entry.manifest.releaseRelevant.map(describeEntry),
  ]
  if (reasons.length === 0) {
    reasons.push(...entry.manifest.deferred.map(describeEntry))
  }
  // A frozen package can be reported for a dev-only change, which no other
  // verdict reaches; without this the line would end at the colon.
  if (reasons.length === 0) {
    reasons.push(...entry.manifest.devOnly.map(describeEntry))
  }
  return reasons.length === 0 ? entry.name : `${entry.name}: ${reasons.join('; ')}`
}

// The exact file a contributor must add. Printed verbatim by the failure so a
// human (or an agent) can write it without guessing the format.
export const SUGGESTED_CHANGESET_PATH = '.changeset/release-changed-packages.md'

export function renderSuggestedChangeset(names, summary) {
  return [
    '---',
    ...[...new Set(names)].sort().map((name) => `'${name}': patch`),
    '---',
    '',
    summary,
    '',
  ].join('\n')
}

/**
 * Render the whole guard verdict.
 *
 * @returns {{ok: boolean, text: string}}
 */
export function renderGuardReport(entries, coveredNames) {
  const covered = new Set(coveredNames)
  const uncovered = entries.filter(
    (entry) => entry.verdict === 'needs-changeset' && !covered.has(entry.name),
  )
  const deferred = entries.filter(
    (entry) => entry.verdict === 'deferred' && !covered.has(entry.name),
  )
  const frozen = entries.filter((entry) => entry.verdict === 'frozen')
  const lines = []

  if (frozen.length > 0) {
    lines.push(
      `${frozen.length} changed package(s) are frozen in the Changesets \`ignore\` list and release nothing:`,
      ...frozen.map((entry) => `- ${describePackageVerdict(entry)}`),
    )
  }

  if (deferred.length > 0) {
    lines.push(
      `${deferred.length} changed package(s) only moved runtime dependency ranges; the release job patch-releases them from registry drift:`,
      ...deferred.map((entry) => `- ${describePackageVerdict(entry)}`),
    )
  }

  if (uncovered.length === 0) {
    const settled = entries.filter((entry) => !deferred.includes(entry) && !frozen.includes(entry))
    // With every changed package deferred, the count above is 0 and the line
    // reads as if nothing was examined. The deferred block already said what
    // happened, so say nothing more.
    if (entries.length === 0) {
      lines.push('No workspace package changed against the Changesets base branch.')
    } else if (settled.length > 0) {
      lines.push(
        `${settled.length} changed package(s) are already released by a Changeset or need no release.`,
      )
    }
    return { ok: true, text: `${lines.join('\n')}\n` }
  }

  const names = uncovered.map((entry) => entry.name)
  lines.push(
    `${uncovered.length} changed package(s) need a Changeset before this change can release:`,
    ...uncovered.map((entry) => `- ${describePackageVerdict(entry)}`),
    '',
    `Add ${SUGGESTED_CHANGESET_PATH} with exactly this content:`,
    '',
    renderSuggestedChangeset(names, 'Describe the change these packages release.'),
  )
  return { ok: false, text: `${lines.join('\n')}\n` }
}
