/**
 * `preflight` — reproduce the pull-request fast path locally, without writing.
 *
 * CI answers three questions about a branch, in this order: which packages the
 * diff affects, whether the repository contracts still hold, and whether the
 * affected packages pass their own gates. This runs the same three, through
 * the same code CI runs, so a local pass means something.
 *
 * It must not modify tracked files. That is not a promise, it is checked: the
 * tracked working tree is snapshotted before the first phase and again after
 * every phase, and a phase that dirties the tree fails the run and names the
 * files. `narduk-lint` rewrites `lint-budget.json` in local mode
 * (narduk-libs#623), which is exactly the failure this command must not
 * repeat, so the package gates are additionally run with `CI=true` to suppress
 * that write at the source. Prevention and detection are separate on purpose:
 * the guard still catches the next writer nobody has found yet.
 *
 * Usage: pnpm run preflight [--base <ref>] [--no-fetch] [--no-consumer]
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  changedFilesBetween,
  computeAffectedSet,
  loadWorkspace,
} from './compute-affected-packages.mjs'
import { packageGates } from './ci-package-plan.mjs'
import { runPackageGates } from './ci-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every tracked path git considers dirty, plus every untracked path, as a map
 * from path to status. `--porcelain=v1 -z` is stable across git versions and
 * reports untracked entries as `??`, which is how a *created* budget file is
 * seen -- the #623 report's own instance was a file that did not exist before
 * the gate ran.
 *
 * @param {string} repositoryRoot
 * @param {typeof spawnSync} [execute]
 * @returns {Map<string, string>}
 */
export function trackedTreeSnapshot(repositoryRoot, execute = spawnSync) {
  const result = execute('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git status failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`)
  }
  const snapshot = new Map()
  // -z records are "XY path\0", except renames, which carry the original path
  // as a second NUL-terminated field. Consuming that field keeps a rename from
  // being read as an extra entry with an empty status.
  const records = result.stdout.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const status = record.slice(0, 2)
    snapshot.set(record.slice(3), status)
    if (status.startsWith('R') || status.startsWith('C')) index += 1
  }
  return snapshot
}

/**
 * Paths a phase dirtied: present and different now, absent before. A tree that
 * was already dirty when the run started is the author's own work and is not
 * reported -- only what this command caused.
 *
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {string[]}
 */
export function newlyDirtyPaths(before, after) {
  const dirtied = []
  for (const [path, status] of after) {
    if (before.get(path) !== status) dirtied.push(path)
  }
  return dirtied.sort()
}

/**
 * Wrap a `spawnSync`-shaped runner so package gates cannot write the files
 * they are only meant to check. `CI=true` is what puts `narduk-lint` in the
 * mode where it never rewrites `lint-budget.json` (its `--ci` default), and it
 * is what the gates already run under in CI, so this makes the local run more
 * like CI rather than less.
 *
 * @param {typeof spawnSync} [execute]
 * @returns {typeof spawnSync}
 */
export function nonWritingExecute(execute = spawnSync) {
  return (file, args, options = {}) =>
    execute(file, args, { ...options, env: { ...process.env, ...options.env, CI: 'true' } })
}

/**
 * The union of what is committed against the base and what is still only in
 * the working tree. CI can only see the former; the author is usually asking
 * about the latter, and answering about the wrong one is how a preflight earns
 * distrust.
 *
 * @param {string} repositoryRoot
 * @param {string} base
 * @returns {string[]}
 */
export function preflightChangedFiles(repositoryRoot, base) {
  const committed = changedFilesBetween(repositoryRoot, base, 'HEAD')
  const working = [...trackedTreeSnapshot(repositoryRoot).keys()]
  return [...new Set([...committed, ...working])].sort()
}

function parsePreflightArgs(argv) {
  const options = { base: 'origin/main', fetch: true, consumer: true }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--base') options.base = argv[(index += 1)]
    else if (argument.startsWith('--base=')) options.base = argument.slice('--base='.length)
    else if (argument === '--no-fetch') options.fetch = false
    else if (argument === '--no-consumer') options.consumer = false
    else throw new Error(`Unknown preflight argument: ${argument}`)
  }
  if (!options.base) throw new Error('--base requires a ref.')
  return options
}

export { parsePreflightArgs }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

async function main() {
  const options = parsePreflightArgs(process.argv.slice(2))
  const run = (file, args, extra = {}) =>
    spawnSync(file, args, { cwd: root, stdio: 'inherit', ...extra })

  // A stale `origin/main` is not a neutral default: `release-plan:check` reads
  // it, and against a stale one it reports packages the branch never touched.
  // The contracts job materializes the base branch for the same reason.
  if (options.fetch) {
    const fetched = run('git', ['fetch', '--quiet', 'origin', 'main'])
    if (fetched.status !== 0) {
      console.warn(`preflight: could not fetch origin/main; ${options.base} may be stale.`)
    }
  }

  const baseline = trackedTreeSnapshot(root)
  const failures = []

  const guard = (label) => {
    const dirtied = newlyDirtyPaths(baseline, trackedTreeSnapshot(root))
    if (dirtied.length === 0) return
    failures.push(`${label} modified the working tree`)
    console.error(
      `\npreflight: the working tree changed during ${label}, which a check must never do:\n` +
        dirtied.map((path) => `  ${path}`).join('\n') +
        '\nDiscard those paths before committing (narduk-libs#623).\n' +
        'If you were editing while this ran, those are your own edits, not the phase: ' +
        'the guard can only see that the tree changed, not who changed it. Re-run on a ' +
        'settled tree to tell the two apart.',
    )
  }

  const phase = (label, file, args) => {
    console.log(`\n=== ${label} ===`)
    const result = run(file, args)
    if (result.status !== 0) failures.push(`${label} failed (exit ${result.status})`)
    guard(label)
    return result.status === 0
  }

  // --- Plan ---------------------------------------------------------------
  const changedFiles = preflightChangedFiles(root, options.base)
  const workspace = loadWorkspace(root)
  const plan = computeAffectedSet({ changedFiles, consumerScopeMode: 'scoped' })
  const baseSha = spawnSync('git', ['rev-parse', '--short', options.base], {
    cwd: root,
    encoding: 'utf8',
  }).stdout?.trim()
  console.log(`=== plan (against ${options.base}${baseSha ? ` ${baseSha}` : ''}) ===`)
  console.log(`Changed files: ${changedFiles.length}`)
  console.log(
    `Affected packages (${plan.affectedNames.length}): ${plan.affectedNames.join(', ') || 'none'}`,
  )
  console.log(`Packed-consumer proof: ${plan.packedConsumer}`)
  console.log(`Generated-app proof:   ${plan.generatedConsumer}`)
  if (plan.consumerScope?.length) {
    console.log(
      `Packed-consumer scope (${plan.consumerScope.length}): ${plan.consumerScope.join(', ')}`,
    )
  }
  guard('plan')

  // --- Contracts, in the contracts job's own order ------------------------
  phase('versions:check', 'pnpm', ['run', 'versions:check'])
  phase('scripts:test', 'pnpm', ['run', 'scripts:test'])
  phase('release-plan:check', 'node', [
    'scripts/check-generator-release-plan.mjs',
    '--base',
    options.base,
  ])
  phase('format:check', 'pnpm', ['run', 'format:check'])
  phase('surface:check', 'pnpm', ['run', 'surface:check'])

  // --- The affected packages' own gates -----------------------------------
  const gateable = plan.affectedNames.filter((name) => {
    const entry = workspace.byName.get(name)
    return packageGates.every((gate) => typeof entry?.manifest.scripts?.[gate] === 'string')
  })
  const skipped = plan.affectedNames.filter((name) => !gateable.includes(name))
  if (skipped.length > 0) {
    console.log(`\npreflight: no package gates for ${skipped.join(', ')} (missing scripts).`)
  }
  if (gateable.length > 0) {
    console.log(`\n=== package gates (${gateable.length}) ===`)
    // CI fans these out across runners; here they are serial. Say so before
    // spending the time rather than leaving the author wondering whether it
    // hung -- a global trigger such as the root package.json or the lockfile
    // selects every package, and that is the expensive case by design.
    if (gateable.length > 6) {
      console.log(
        `This diff reaches ${gateable.length} packages, so all ${packageGates.length} gates run for each of them, serially. ` +
          'A narrower diff is the only thing that makes this quick.',
      )
    }
    try {
      for (const { name, gate, status } of runPackageGates(
        gateable,
        workspace,
        nonWritingExecute(),
      )) {
        if (status !== 0) failures.push(`${name} / ${gate} failed (exit ${status})`)
      }
    } catch (error) {
      failures.push(`package gates: ${error.message}`)
    }
    guard('package gates')
  }

  // --- The packed-artifact proof, artifacts only --------------------------
  if (options.consumer && plan.packedConsumer) {
    const args = [
      'scripts/release-packages.mjs',
      '--dry-run',
      '--consumer-smoke',
      '--artifacts-only',
    ]
    if (plan.consumerScope?.length) args.push('--packages', plan.consumerScope.join(','))
    phase('packed-consumer (artifacts only)', 'node', args)
  } else if (plan.packedConsumer) {
    console.log('\npreflight: skipping the packed-consumer proof (--no-consumer).')
  }

  console.log('')
  if (failures.length > 0) {
    console.error(`preflight: FAILED\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
    process.exit(1)
  }
  console.log('preflight: OK — the working tree is unchanged.')
}
