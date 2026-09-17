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

export function runPackageGates(names, workspace, execute = spawnSync) {
  return runGates(names, workspace, packageGates, execute)
}

export function runBrowserGates(names, workspace, execute = spawnSync) {
  return runGates(names, workspace, ['test:e2e'], execute)
}

function runGates(names, workspace, gates, execute) {
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
        ...gitFiles(['diff', '--name-only', '-z', 'HEAD']),
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
