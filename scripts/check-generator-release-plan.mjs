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
import { classifyChangedPackages, renderGuardReport } from './release-plan-guard.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatorName = '@narduk-enterprises/create-narduk-app'

function parseArguments(argv) {
  const options = { base: undefined, head: 'HEAD', json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
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
  const base = options.base ?? changesetsBaseBranch()
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
        `Cannot compare ${options.head} against '${base}'. Create the Changesets base branch locally (git branch --force ${base} origin/${base}) and check out full history.`,
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

    const entries = classifyChangedPackages({
      packages: workspace.packages.map(({ name, relativeDirectory, manifest }) => ({
        name,
        relativeDirectory,
        private: manifest.private === true,
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
