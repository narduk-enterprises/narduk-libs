/**
 * Package scope for the packed-consumer proof.
 *
 * `release-packages.mjs --consumer-smoke` packs, publints, installs and probes
 * every publishable package. That is the right proof for a release and for the
 * default branch, and it is most of what the `packed-consumer-smoke` job costs.
 * On a pull request that touches one isolated package it is also mostly work
 * about packages the diff cannot reach.
 *
 * This module owns the rule that narrows it, and the rule is deliberately
 * one-directional: it may only ever narrow a run that is already known to be
 * dependency-local, and every uncertainty widens back to the full set. A
 * scoping rule that silently skips the package a pull request broke is worse
 * than no scoping at all.
 *
 * Where the narrowing is applied is a separate decision from this rule, and it
 * is made in `.github/workflows/ci.yml`: pull requests scope, and `push` to
 * `main` does not. `verify-release-ci.mjs` accepts the exact release SHA's
 * `push`-event `main` `verify` aggregate as publication proof, so a scoped run
 * behind that aggregate would make the publication proof partial without
 * saying so. Keeping `main` full also means every merge exercises every
 * package, which is why no scheduled all-package run is needed.
 */

// Every manifest section that can make one workspace package's contents depend
// on another. Mirrors what `loadWorkspace` walks when it builds the dependent
// graph; `compute-affected-packages.mjs` imports it from here so the two
// directions of the same graph can never be walked over different sections.
export const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

export const consumerScopeModes = ['full', 'scoped']

/**
 * The exact package pins `assertExactGeneratedPackagePins` requires the
 * generated all-capability app to carry. This is the list that assertion has
 * always enforced, moved here unchanged so a scoped run can ask, before it
 * packs anything, whether the set it is about to pack could satisfy it.
 *
 * Kept here rather than inside `release-packages.mjs` because that file is an
 * executable script with top-level side effects and cannot be imported by
 * `node --test` (the same constraint that put `isGeneratedBuildPhase` in
 * `consumer-smoke-phases.mjs`).
 */
export const generatedConsumerRequiredPackages = [
  '@narduk-enterprises/narduk-ai',
  '@narduk-enterprises/narduk-analytics',
  '@narduk-enterprises/narduk-app-tools',
  '@narduk-enterprises/narduk-auth',
  '@narduk-enterprises/narduk-core',
  '@narduk-enterprises/narduk-seo',
  '@narduk-enterprises/narduk-shell',
  '@narduk-enterprises/narduk-testkit',
  '@narduk-enterprises/narduk-uploads',
]

/**
 * Every workspace package the seeds depend on, transitively, including the
 * seeds. Private packages are traversed -- a publishable package can reach
 * another publishable package through a private build helper -- but callers
 * filter the result to what they can actually pack.
 */
export function workspaceDependencyClosure(seedNames, byName) {
  const closure = new Set()
  const pending = [...seedNames]

  while (pending.length > 0) {
    const name = pending.shift()
    if (closure.has(name)) continue
    const entry = byName.get(name)
    if (!entry) continue
    closure.add(name)
    for (const section of dependencySections) {
      for (const dependency of Object.keys(entry.manifest[section] || {})) {
        if (byName.has(dependency) && !closure.has(dependency)) pending.push(dependency)
      }
    }
  }
  return closure
}

/**
 * Resolve which publishable packages the packed-consumer proof must pack.
 *
 * Widen, never narrow, on every uncertainty:
 * - `mode` other than `scoped` packs everything, so `scoped` is opt-in at the
 *   call site and no caller acquires narrowing by forgetting an argument;
 * - `fullRun` packs everything, which is what carries an unclassified
 *   repository path, a shared-tooling change and an explicit `--all`;
 * - `generatedConsumer` packs everything, because the generated app installs
 *   the generator's entire pinned closure from tarballs and resolves anything
 *   unpacked from the registry, at a version a pull request has not published;
 * - a scope that comes back empty packs everything rather than proving nothing.
 */
export function resolveConsumerScope({
  mode = 'full',
  packedConsumer,
  generatedConsumer,
  fullRun,
  workspace,
  consumerAffectedNames,
}) {
  if (!consumerScopeModes.includes(mode)) {
    throw new Error(`Unknown consumer scope mode: ${mode}`)
  }

  const publishable = workspace.packages
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ name }) => name)
    .sort()
  const full = (reason) => ({ consumerScope: publishable, consumerScopeReason: reason })

  if (!packedConsumer) {
    return { consumerScope: [], consumerScopeReason: 'no packed-artifact proof is required' }
  }
  if (mode !== 'scoped') return full('unscoped run: every publishable package')
  if (fullRun) return full('a full run packs every publishable package')
  if (generatedConsumer) {
    return full('the generated-app proof installs the whole pinned generator closure')
  }

  const closure = workspaceDependencyClosure(consumerAffectedNames, workspace.byName)
  const scoped = publishable.filter((name) => closure.has(name))
  if (scoped.length === 0) return full('scoping selected no publishable package')
  if (scoped.length === publishable.length) return full('the scope already covers every package')
  return {
    consumerScope: scoped,
    consumerScopeReason: `scoped to ${scoped.length} of ${publishable.length} publishable packages and their workspace dependency closure`,
  }
}

/** The generator itself, which the proof runs out of the consumer install. */
export const consumerSmokeGeneratorPackage = '@narduk-enterprises/create-narduk-app'

/**
 * Whether a packed set can carry the generated-app half of the proof: the
 * generator must be installable and every pin the assertion checks must be
 * present. A scoped artifacts-only run normally cannot, and skipping it there
 * is correct rather than merely cheap -- the generator pins only the packages
 * in `generatedConsumerRequiredPackages`, so a diff reaching none of them
 * cannot make one of those pins stale, and a diff that does reach one makes
 * the run `generatedConsumer`, which never scopes.
 */
export function generatedConsumerProofAvailable(packedNames) {
  const packed = new Set(packedNames)
  return [consumerSmokeGeneratorPackage, ...generatedConsumerRequiredPackages].every((name) =>
    packed.has(name),
  )
}

/**
 * Narrow an already-validated publishable package list to `scope`, failing
 * closed on any name that is not in it. An unknown or unpublishable name means
 * the planner and this script disagree about the workspace, and continuing
 * would pack a set neither of them described.
 */
export function selectScopedPackages(packages, scope) {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new Error('A packed-consumer scope must name at least one package.')
  }
  if (new Set(scope).size !== scope.length) {
    throw new Error('A packed-consumer scope must not repeat a package.')
  }
  const available = new Map(packages.map((entry) => [entry.manifest.name, entry]))
  const missing = scope.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(
      `The packed-consumer scope names packages that are not publishable here: ${missing.join(', ')}`,
    )
  }
  return packages.filter(({ manifest }) => scope.includes(manifest.name))
}

/** Parse `--packages=a,b` / `--packages a,b` from an argv slice. */
export function parsePackagesArgument(argv) {
  const names = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    let value
    if (argument.startsWith('--packages=')) value = argument.slice('--packages='.length)
    else if (argument === '--packages') value = argv[++index]
    else continue
    if (value === undefined) throw new Error('--packages requires a value.')
    for (const name of value.split(',')) {
      const trimmed = name.trim()
      if (trimmed) names.push(trimmed)
    }
  }
  return names.length > 0 ? names : undefined
}
