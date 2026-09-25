import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  changedFilesBetween,
  computeAffectedSet,
  loadWorkspace,
} from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
import { packageGates } from './ci-package-plan.mjs'
import { dependencySections } from './packed-consumer-scope.mjs'

export function runPackageGates(names, workspace, execute = spawnSync) {
  validateBatch(names, workspace, packageGates)
  const ordered = dependencyOrder(names, workspace)
  return [
    ...buildOutOfBatchDependencies(ordered, workspace, execute),
    ...runGates(ordered, workspace, packageGates, execute),
  ]
}

export function runBrowserGates(names, workspace, execute = spawnSync) {
  return runGates(names, workspace, ['test:e2e'], execute)
}

function workspaceDependencies(name, workspace) {
  const { manifest } = workspace.byName.get(name)
  const names = new Set()
  for (const section of dependencySections)
    for (const dependency of Object.keys(manifest[section] || {}))
      if (dependency !== name && workspace.byName.has(dependency)) names.add(dependency)
  return [...names].sort()
}

// A batch member's gates run after every in-batch workspace package it depends
// on, so the dependency's own `build` gate has produced its `dist/` first
// (#292). Ties keep the selection order; a cycle keeps it too.
export function dependencyOrder(names, workspace) {
  const selected = new Set(names)
  const ordered = []
  const visiting = new Set()
  const visit = (name) => {
    if (ordered.includes(name) || visiting.has(name)) return
    visiting.add(name)
    for (const dependency of workspaceDependencies(name, workspace))
      if (selected.has(dependency)) visit(dependency)
    visiting.delete(name)
    ordered.push(name)
  }
  for (const name of names) visit(name)
  return ordered
}

// A workspace package that exports from `dist/` cannot be resolved by a
// consumer until it is built. One that exports source needs nothing.
function exportsBuildOutput(manifest) {
  return /["/]dist\//.test(JSON.stringify([manifest.exports, manifest.main, manifest.types]))
}

// Every workspace package the batch reaches outside itself, transitively, that
// exports build output: a gate must never depend on a `dist/` that happens to
// be lying around from an earlier run, which is how a local run passed while
// the same package failed CI with a bare TS2307 (#292, PR #290).
export function outOfBatchBuilds(names, workspace) {
  const selected = new Set(names)
  const reached = new Set()
  const pending = [...names]
  while (pending.length) {
    for (const dependency of workspaceDependencies(pending.pop(), workspace)) {
      if (selected.has(dependency) || reached.has(dependency)) continue
      reached.add(dependency)
      pending.push(dependency)
    }
  }
  return [...reached]
    .filter((name) => {
      const { manifest } = workspace.byName.get(name)
      return exportsBuildOutput(manifest) && typeof manifest.scripts?.build === 'string'
    })
    .sort()
}

function buildOutOfBatchDependencies(names, workspace, execute) {
  const dependencies = outOfBatchBuilds(names, workspace)
  if (dependencies.length === 0) return []
  const started = performance.now()
  console.log(`::group::dependency build: ${dependencies.join(', ')}`)
  // A recursive `pnpm run` over several filters runs them in dependency order.
  const result = execute(
    'pnpm',
    [...dependencies.flatMap((name) => ['--filter', name]), 'run', 'build'],
    { cwd: root, stdio: 'inherit' },
  )
  console.log('::endgroup::')
  if (result.error) throw result.error
  if (result.signal) throw new Error(`dependency build interrupted by ${result.signal}`)
  return [
    {
      name: dependencies.join(', '),
      gate: 'dependency build',
      status: result.status ?? 1,
      seconds: (performance.now() - started) / 1000,
    },
  ]
}

function validateBatch(names, workspace, gates) {
  if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('A batch must contain a nonempty, unique package selection.')
  }
  // Validate the entire batch before running anything. pnpm itself succeeds
  // when a filter matches no package, which is not acceptable evidence here.
  for (const name of names) {
    const entry = workspace.byName.get(name)
    if (!entry) throw new Error(`Unknown workspace package: ${name}`)
    for (const gate of gates) {
      if (
        typeof entry.manifest.scripts?.[gate] !== 'string' ||
        !entry.manifest.scripts[gate].trim()
      ) {
        throw new Error(`${name} is missing required script ${gate}`)
      }
    }
  }
}

function runGates(names, workspace, gates, execute) {
  validateBatch(names, workspace, gates)
  const results = []
  for (const name of names) {
    for (const gate of gates) {
      const started = performance.now()
      console.log(`::group::${name} / ${gate}`)
      const result = execute('pnpm', ['--filter', name, 'run', gate], {
        cwd: root,
        stdio: 'inherit',
      })
      console.log('::endgroup::')
      if (result.error) throw result.error
      if (result.signal) throw new Error(`${name} / ${gate} interrupted by ${result.signal}`)
      results.push({
        name,
        gate,
        status: result.status ?? 1,
        seconds: (performance.now() - started) / 1000,
      })
    }
  }
  return results
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.signal || result.status})`)
}

function gitFiles(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Cannot read local changes')
  return result.stdout.split('\0').filter(Boolean)
}

function localPlan(args) {
  const options = { base: 'origin/main', head: 'HEAD', all: false, plan: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--all' || arg === '--plan') options[arg.slice(2)] = true
    else if ((arg === '--base' || arg === '--head') && args[index + 1])
      options[arg.slice(2)] = args[++index]
    else throw new Error(`Unknown or incomplete option: ${arg}`)
  }
  const changedFiles = options.all
    ? []
    : [
        ...changedFilesBetween(root, options.base, options.head),
        ...gitFiles(['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
        ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
      ]
  return { ...options, ...computeAffectedSet({ root, changedFiles, forceAll: options.all }) }
}

function main() {
  const args = process.argv.slice(2)
  const batchMode = args.length === 1 && args[0] === '--batch'
  const browserMode = args.length === 1 && args[0] === '--browser'
  const workspace = loadWorkspace(root)
  const plan = batchMode || browserMode ? undefined : localPlan(args)
  if (plan) console.log(JSON.stringify({ ...plan, packageGates }, null, 2))
  if (plan?.plan) return
  const names = browserMode
    ? JSON.parse(process.env.BROWSER_PACKAGES_JSON || 'null')
    : batchMode
      ? JSON.parse(process.env.PACKAGE_MATRIX_JSON || 'null')?.packages
      : plan.affectedNames
  if (plan) {
    for (const script of ['versions:check', 'release-plan:check', 'format:check', 'scripts:test'])
      run('pnpm', ['run', script])
  }
  const results =
    plan && names.length === 0
      ? []
      : browserMode
        ? runBrowserGates(names, workspace)
        : runPackageGates(names, workspace)
  const summary = results
    .map(
      ({ name, gate, status, seconds }) =>
        `| ${name} | ${gate} | ${status === 0 ? 'pass' : 'FAIL'} | ${seconds.toFixed(1)} |`,
    )
    .join('\n')
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n| Package | Gate | Result | Seconds |\n| --- | --- | --- | ---: |\n${summary}\n`,
    )
  if (results.some(({ status }) => status !== 0)) {
    process.exitCode = 1
    return
  }
  if (plan) {
    if (
      plan.browserPackages.length &&
      runBrowserGates(plan.browserPackages, workspace).some(({ status }) => status !== 0)
    )
      throw new Error('A package browser gate failed')
    if (plan.packedConsumer) {
      run('node', ['scripts/prepare-packed-consumer.mjs'])
      run('pnpm', [
        'run',
        'release:consumer-smoke',
        ...(plan.generatedConsumer ? [] : ['--artifacts-only']),
      ])
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
