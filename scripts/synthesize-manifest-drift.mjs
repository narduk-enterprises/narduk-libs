// Release-time patch Changesets for published manifest drift.
//
// A Dependabot runtime-dependency bump (PR #324's shape) changes only
// `dependencies` ranges. The repository release-plan gate lets that merge
// without a human Changeset (scripts/release-plan-guard.mjs, verdict
// `deferred`) precisely because this script exists: on `main`, before the
// Changesets action prepares a version, it compares every publishable
// package's dependency ranges against the manifest of the version that is
// actually on the registry and writes a patch Changeset for each package
// whose published manifest is now stale. The security fix therefore reaches
// consumers without anyone pushing a commit to a Dependabot branch.
//
// Safety properties this script must keep -- each one is pinned by a test in
// synthesize-manifest-drift.test.mjs:
//
//  - It can never publish. A synthesized Changeset makes the Changesets action
//    take its *version* path, which opens the `chore: release packages` PR.
//    That PR gets full CI and a human merges it. Publication happens on a
//    later run, from a commit with no pending Changesets.
//  - It never delays or alters a pending publication. If any publishable
//    package's current version is missing from the registry, that version is
//    waiting to publish; the script writes nothing and exits 0.
//  - It fails closed. Any registry read that is neither a successful manifest
//    nor a clean 404 aborts the release job rather than silently skipping a
//    package that owes consumers a release.
//  - It keeps the generator-pin rule satisfiable. Synthesizing a patch for a
//    generator-pinned package makes `release-plan:check` (which runs first
//    inside `release:version`) demand a create-narduk-app release, so the
//    script adds that Changeset itself when its own output caused the demand.
//  - `workspace:` specifiers are excluded. pnpm rewrites them to exact
//    versions at publish time, so they always "differ" from the published
//    manifest and would synthesize a release on every single run.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import getReleasePlan from '@changesets/get-release-plan'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { generatorPinnedPackages } from './check-generator-release-plan.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://npm.pkg.github.com'
const generatorName = '@narduk-enterprises/create-narduk-app'

// The sections a consumer resolves from the published manifest. Unlike the
// PR-time guard, `peerDependencies` is included here: a peer range that a
// human deliberately moved reaches `main` with its own Changeset, is released,
// and then no longer drifts -- but a peer range that reached `main` any other
// way still owes consumers a release.
export const DRIFT_SECTIONS = Object.freeze([
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
])

// Specifier protocols pnpm resolves to a concrete version when it packs, so the
// published manifest can never carry them and a literal comparison would report
// drift forever -- a synthesized patch release on every push to main, in a loop.
// `catalog:` is here before the workspace declares a catalog on purpose: the
// failure mode is silent and self-sustaining, and the guard rejects nothing
// today by naming it.
export const RESOLVED_AT_PUBLISH_PROTOCOLS = Object.freeze(['workspace:', 'catalog:'])

export function isResolvedAtPublish(range) {
  return (
    typeof range === 'string' &&
    RESOLVED_AT_PUBLISH_PROTOCOLS.some((protocol) => range.startsWith(protocol))
  )
}

export function packageSlug(name) {
  return name.replace(/^@/u, '').replaceAll('/', '-')
}

export function changesetPath(name) {
  return `.changeset/auto-manifest-${packageSlug(name)}.md`
}

/**
 * Compare a local manifest against the manifest of its published version.
 *
 * @returns {Array<{section: string, name: string, published: string|undefined, local: string|undefined}>}
 */
export function manifestDrift(local, published) {
  const drift = []
  for (const section of DRIFT_SECTIONS) {
    const localSection = local?.[section] || {}
    const publishedSection = published?.[section] || {}
    const names = new Set([...Object.keys(localSection), ...Object.keys(publishedSection)])
    for (const name of [...names].sort()) {
      const localRange = localSection[name]
      // pnpm rewrites `workspace:` and `catalog:` to a concrete version when it
      // packs, so the published manifest can never match the source. Changesets
      // already owns internal-dependency bumps (updateInternalDependencies:
      // patch); a catalog bump is an ordinary manifest change on the packages
      // that use it, which the PR-time guard classifies.
      if (isResolvedAtPublish(localRange)) continue
      const publishedRange = publishedSection[name]
      if (localRange === publishedRange) continue
      drift.push({ section, name, published: publishedRange, local: localRange })
    }
  }
  return drift
}

export function renderDriftChangeset(name, drift) {
  const sections = [...new Set(drift.map((entry) => entry.section))].sort()
  const details = drift
    .map(
      (entry) =>
        `- \`${entry.section}.${entry.name}\`: ${entry.published ?? '(absent)'} -> ${entry.local ?? '(removed)'}`,
    )
    .join('\n')
  return [
    '---',
    `'${name}': patch`,
    '---',
    '',
    `Release the ${sections.join(' and ')} recorded on main. The published version's manifest still carries the previous ranges:`,
    '',
    details,
    '',
  ].join('\n')
}

/**
 * Decide what to synthesize. Pure: every registry read is already resolved.
 *
 * @param {object} options
 * @param {Array<{name: string, version: string, manifest: object}>} options.packages publishable packages
 * @param {Set<string>|string[]} options.covered packages a pending Changeset already releases
 * @param {Map<string, {published: boolean, manifest?: object}>} options.registryRecords
 * @returns {{skipped?: string, releases: Array<{name: string, drift: Array, body: string, path: string}>, covered: string[]}}
 */
export function planDriftSynthesis({ packages, covered, registryRecords }) {
  const coveredNames = new Set(covered)
  const pendingPublication = packages
    .filter(({ name }) => registryRecords.get(name)?.published !== true)
    .map(({ name, version }) => `${name}@${version}`)

  // A version that is not on the registry yet is waiting for this very run to
  // publish it. Writing a Changeset now would flip the Changesets action from
  // its publish path to its version path and strand that publication for a
  // round trip, so the whole comparison is skipped instead.
  if (pendingPublication.length > 0) {
    return {
      skipped: `${pendingPublication.length} version(s) are not published yet: ${pendingPublication.join(', ')}`,
      releases: [],
      covered: [],
    }
  }

  const releases = []
  // Packages that drift but whose release a pending Changeset already carries.
  // Tracked, not silently dropped: "nothing to write" and "nothing drifts" are
  // different states, and an operator diagnosing a missing release needs to see
  // which one this run was in.
  const coveredDrift = []
  for (const { name, manifest } of packages) {
    const drift = manifestDrift(manifest, registryRecords.get(name).manifest)
    if (drift.length === 0) continue
    if (coveredNames.has(name)) {
      coveredDrift.push(name)
      continue
    }
    releases.push({
      name,
      drift,
      path: changesetPath(name),
      body: renderDriftChangeset(name, drift),
    })
  }
  return { releases, covered: coveredDrift }
}

export function renderSynthesisSummary(covered) {
  return covered.length === 0
    ? 'Every published package manifest matches main.\n'
    : `No manifest drift left to synthesize; a pending Changeset already releases ${covered.length} drifted package(s): ${[...covered].sort().join(', ')}.\n`
}

export function renderGeneratorChangeset(names) {
  return [
    '---',
    `'${generatorName}': patch`,
    '---',
    '',
    `Repin the generator to the versions released for published manifest drift: ${[...names]
      .sort()
      .join(', ')}.`,
    '',
  ].join('\n')
}

/**
 * The generator emits pinned package versions as string literals, so
 * `release-plan:check` (which runs before `changeset version` inside
 * `release:version`) refuses a plan that moves a pin without releasing the
 * generator. Synthesis must satisfy that rule for the releases it introduced.
 */
export function generatorFollowUp({ plannedNames, pinnedNames, synthesizedNames }) {
  if (synthesizedNames.length === 0) return undefined
  const planned = new Set(plannedNames)
  if (planned.has(generatorName)) return undefined
  const movedPins = [...planned].filter((name) => pinnedNames.has(name))
  if (movedPins.length === 0) return undefined
  return {
    name: generatorName,
    path: changesetPath(generatorName),
    body: renderGeneratorChangeset(movedPins),
  }
}

/**
 * Turn one `pnpm view` result into a registry record, or throw.
 *
 * Only two outcomes are acceptable: the exact published manifest, or a clean
 * E404 meaning that version is not on the registry. Everything else -- a
 * network failure, an auth failure, an unparseable body, a body describing
 * some other version -- aborts the release job, because treating it as "no
 * drift" would silently withhold a release the package owes its consumers.
 */
export function interpretRegistryResult(result, name, version) {
  if (result.error) throw result.error
  let value
  try {
    value = JSON.parse(result.stdout)
  } catch {
    throw new Error(`Registry metadata for ${name}@${version} is unreadable`)
  }
  if (result.status !== 0) {
    if (value?.error?.code === 'E404') return { published: false }
    throw new Error(`Registry metadata for ${name}@${version} failed (${result.status})`)
  }
  // `pnpm view <name>@<range>` answers with an array when a range matches more
  // than one version. An exact version must answer with exactly one manifest.
  const manifest = Array.isArray(value) ? value[0] : value
  if (!manifest || manifest.version !== version) {
    throw new Error(`Registry metadata for ${name}@${version} did not answer that exact version`)
  }
  return { published: true, manifest }
}

function registryManifest(name, version) {
  return interpretRegistryResult(
    spawnSync('pnpm', ['view', `${name}@${version}`, '--json', `--registry=${registry}`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    }),
    name,
    version,
  )
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const workspace = loadWorkspace(root)
  const pinnedNames = generatorPinnedPackages(workspace)
  const packages = workspace.packages
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ name, manifest }) => ({ name, version: manifest.version, manifest }))

  const plan = await getReleasePlan(root)
  const covered = plan.releases
    .filter((release) => release.type !== 'none')
    .map((release) => release.name)

  const registryRecords = new Map(
    packages.map(({ name, version }) => [name, registryManifest(name, version)]),
  )

  const {
    skipped,
    releases,
    covered: coveredDrift,
  } = planDriftSynthesis({ packages, covered, registryRecords })
  if (skipped) {
    process.stdout.write(`Skipping manifest-drift synthesis: ${skipped}\n`)
    return
  }
  if (releases.length === 0) {
    process.stdout.write(renderSynthesisSummary(coveredDrift))
    return
  }

  for (const release of releases) {
    if (!dryRun) writeFileSync(join(root, release.path), release.body)
    process.stdout.write(
      `${dryRun ? 'Would write' : 'Wrote'} ${release.path} for ${release.drift.length} drifted range(s):\n${release.drift
        .map((entry) => `- ${entry.section}.${entry.name}: ${entry.published} -> ${entry.local}`)
        .join('\n')}\n`,
    )
  }
  if (dryRun) return

  // Re-assemble with the synthesized files in place so the pin rule is judged
  // against the plan `release:version` will actually see, dependent bumps and
  // all.
  const assembled = await getReleasePlan(root)
  const followUp = generatorFollowUp({
    plannedNames: assembled.releases
      .filter((release) => release.type !== 'none')
      .map((release) => release.name),
    pinnedNames,
    synthesizedNames: releases.map((release) => release.name),
  })
  if (followUp) {
    writeFileSync(join(root, followUp.path), followUp.body)
    process.stdout.write(`Wrote ${followUp.path} to keep the generator pins releasable.\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
