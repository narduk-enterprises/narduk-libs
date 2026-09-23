// Repository release-plan gate.
//
// Two independent rules:
//
//  1. Generator pins. The generator (create-narduk-app) emits local package
//     versions as string literals, so Changesets' dependency graph cannot see
//     the coupling: a release that moves a pinned package's version must also
//     release the generator.
//  2. Changed packages. Every changed package that needs a release must be
//     covered by a Changeset -- except packages whose only change is a runtime
//     dependency *range*, which the release job patch-releases from registry
//     drift (scripts/synthesize-manifest-drift.mjs).
//
// Rule 1 used to be read out of `changeset status`, which exits 1 whenever any
// package directory changed without a Changeset. That made rule 2 impossible
// to state precisely and failed the `contracts` gate on Dependabot
// devDependency bumps (PR #323, run 35173069724). The plan is now read with
// `@changesets/get-release-plan`, the same assembler the CLI uses, which
// returns a plan instead of throwing.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import getReleasePlan from '@changesets/get-release-plan'

import { loadWorkspace } from './compute-affected-packages.mjs'
import {
  classifyChangedPackages,
  ignoredPackageNames,
  renderGuardReport,
} from './release-plan-guard.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatorName = '@narduk-enterprises/create-narduk-app'

function parseArguments(argv) {
  const options = { base: undefined, head: 'HEAD', json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    // `pnpm run release-plan:check -- --base origin/main` forwards the bare
    // separator; treat it as the no-op it is rather than an unknown flag.
    if (argument === '--') continue
    if (argument === '--json') {
      options.json = true
      continue
    }
    if (argument === '--base' || argument === '--head') {
      const next = argv[index + 1]
      if (!next) throw new Error(`${argument} requires a value.`)
      options[argument.slice(2)] = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

// Package directories come from pnpm-workspace.yaml, not from a fixed
// `packages/<name>` shape: the workspace is organized into the four families
// modules/, tooling/, design/ and contracts/ (company-hq D-WEBFOUND-2 Q2 (a)).
export function generatorPinnedPackages(workspace) {
  const generator = workspace.byName.get(generatorName)
  if (!generator) throw new Error(`${generatorName} is not a workspace package.`)
  const localPackageNames = new Set(
    workspace.packages
      .map(({ name }) => name)
      .filter((name) => typeof name === 'string' && name.startsWith('@narduk-enterprises/')),
  )
  const generatorSource = readFileSync(join(generator.directory, 'src', 'manifest.ts'), 'utf8')
  const pinned = new Set(
    [...generatorSource.matchAll(/^\s*'(@narduk-enterprises\/[^']+)':\s*'[^']+',\s*$/gm)]
      .map((match) => match[1])
      .filter((name) => localPackageNames.has(name)),
  )
  if (pinned.size === 0) throw new Error('The generator release guard found no local package pins.')
  return pinned
}

export function generatorPinVerdict(plannedReleases, pinnedLocalPackages) {
  const changedPins = plannedReleases.filter((release) => pinnedLocalPackages.has(release.name))
  const generatorRelease = plannedReleases.find((release) => release.name === generatorName)
  if (changedPins.length > 0 && !generatorRelease) {
    return {
      ok: false,
      text: `The release changes generator-owned package pins without releasing ${generatorName}:\n${changedPins
        .map((release) => `- ${release.name}: ${release.oldVersion} -> ${release.newVersion}`)
        .join('\n')}\nAdd a patch changeset for ${generatorName}.\n`,
    }
  }
  return {
    ok: true,
    text:
      changedPins.length === 0
        ? 'Release plan does not change generator-owned package pins.\n'
        : `Release plan updates ${changedPins.length} generator-owned package pin(s) and releases ${generatorName}.\n`,
  }
}

function changesetsBaseBranch() {
  const config = JSON.parse(readFileSync(join(root, '.changeset', 'config.json'), 'utf8'))
  return config.baseBranch || 'main'
}

// Which ref the branch is diffed against (#619). The default used to be the
// local Changesets base branch, and a local `main` is only as fresh as its
// last pull: in a stale worktree every commit that landed on the real `main`
// since then reads as part of this branch, and the guard demands Changesets
// for packages the branch never touched. The remote-tracking ref is the
// default now. A local branch is still used when nothing else exists -- and
// whenever it is used, the note says so, so a wrong baseline shows up in the
// message instead of only in the shape of the answer.
export function resolveComparisonBase({ explicit, baseBranch, refExists }) {
  if (explicit) {
    const local = refExists(`refs/heads/${explicit}`) && !refExists(`refs/remotes/${explicit}`)
    return {
      base: explicit,
      note: local
        ? `Comparing against '${explicit}' (--base), a LOCAL branch; if it is behind its remote, packages changed upstream are reported as this branch's.`
        : `Comparing against '${explicit}' (--base).`,
    }
  }
  const remoteBase = `origin/${baseBranch}`
  if (refExists(`refs/remotes/${remoteBase}`)) {
    return { base: remoteBase, note: `Comparing against '${remoteBase}'.` }
  }
  return {
    base: baseBranch,
    note: `Comparing against '${baseBranch}', a LOCAL branch, because '${remoteBase}' does not exist; if it is behind its remote, packages changed upstream are reported as this branch's.`,
  }
}

function refExists(ref) {
  return (
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true }) !==
    undefined
  )
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (allowFailure) return undefined
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`)
  }
  return result.stdout
}

export function readManifestAtRevision(revision, path) {
  const contents = git(['show', `${revision}:${path}`], { allowFailure: true })
  if (contents === undefined) return undefined
  return JSON.parse(contents)
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const { base, note: baseNote } = resolveComparisonBase({
    explicit: options.base,
    baseBranch: changesetsBaseBranch(),
    refExists,
  })
  const workspace = loadWorkspace(root)
  const pinnedLocalPackages = generatorPinnedPackages(workspace)

  // `getReleasePlan` assembles the same plan `changeset status` prints --
  // including dependent bumps from `updateInternalDependencies` -- without the
  // CLI's "changed but no changesets" error.
  return getReleasePlan(root).then((plan) => {
    const plannedReleases = plan.releases.filter((release) => release.type !== 'none')
    const pinVerdict = generatorPinVerdict(plannedReleases, pinnedLocalPackages)

    // The comparison base must exist locally. CI materializes it before this
    // runs (.github/workflows/ci.yml, "Materialize Changesets base branch").
    // Failing closed here is deliberate: guessing a base would silently waive
    // the requirement for every changed package.
    const resolvedBase = git(['merge-base', base, options.head], { allowFailure: true })
    if (resolvedBase === undefined) {
      throw new Error(
        `Cannot compare ${options.head} against '${base}'. Fetch it (git fetch origin ${changesetsBaseBranch()}) or pass --base <ref>, and check out full history.`,
      )
    }
    const mergeBase = resolvedBase.trim()
    const changedFiles = execFileSync(
      'git',
      ['diff', '--name-only', '-z', mergeBase, options.head],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)

    // Read from the file Changesets itself reads, so the guard and the
    // versioner cannot disagree about which packages are frozen.
    const frozenNames = new Set(
      ignoredPackageNames(JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'))),
    )

    const entries = classifyChangedPackages({
      packages: workspace.packages.map(({ name, relativeDirectory, manifest }) => ({
        name,
        relativeDirectory,
        private: manifest.private === true,
        frozen: frozenNames.has(name),
        files: manifest.files,
      })),
      changedFiles,
      readManifests: (relativeDirectory) => ({
        before: readManifestAtRevision(mergeBase, `${relativeDirectory}/package.json`),
        after: readManifestAtRevision(options.head, `${relativeDirectory}/package.json`),
      }),
    })

    const guardVerdict = renderGuardReport(
      entries,
      plannedReleases.map((release) => release.name),
    )

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            base,
            head: options.head,
            mergeBase,
            plannedReleases: plannedReleases.map(({ name, type, oldVersion, newVersion }) => ({
              name,
              type,
              oldVersion,
              newVersion,
            })),
            packages: entries.map(({ name, verdict, otherFiles, manifest }) => ({
              name,
              verdict,
              otherFiles,
              deferred: manifest.deferred,
              releaseRelevant: manifest.releaseRelevant,
              devOnly: manifest.devOnly,
            })),
            ok: pinVerdict.ok && guardVerdict.ok,
          },
          null,
          2,
        )}\n`,
      )
    }

    process.stdout.write(`${baseNote} Merge base ${mergeBase.slice(0, 12)}.\n`)
    for (const verdict of [guardVerdict, pinVerdict]) {
      if (verdict.ok) process.stdout.write(verdict.text)
      else process.stderr.write(verdict.text)
    }
    if (!guardVerdict.ok || !pinVerdict.ok) process.exitCode = 1
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
