// Post-merge publication proof (narduk-libs#490).
//
// release.yml publishes when the CI run for a release-PR merge commit
// succeeds. Nothing used to check afterwards that the versions that commit
// bumped actually reached GitHub Packages and the npm.nard.uk mirror, so a
// "skipped" or lost Release run left sessions to reconstruct by hand whether
// anything published. release-proof.yml runs this script on every push to
// main that touches a package manifest:
//
//   plan    Which publishable packages did this exact commit bump?
//   github  Poll GitHub Packages until every bumped version is served. After a
//           grace period, when CI for the commit succeeded and no Release run
//           is active, re-dispatch release.yml once for the commit. Fail with
//           the exact missing name@version when the deadline passes.
//   mirror  Poll the anonymous npm.nard.uk mirror. `--phase settle` reports
//           what is still missing after the grace period (the workflow then
//           re-dispatches the mirror sync once); `--phase confirm` fails with
//           the exact missing name@version when its deadline passes.
//
// The script prints no credential. It reads GitHub Packages and the Actions
// API with the job-scoped GITHUB_TOKEN only, and the mirror anonymously.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

export const githubRegistry = 'https://npm.pkg.github.com'
export const mirrorRegistry = 'https://npm.nard.uk'
const scope = '@narduk-enterprises/'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const minute = 60_000
const activeRunStatuses = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

const label = ({ name, version }) => `${name}@${version}`
export const labels = (targets) => targets.map(label).join(', ')

function publishable(manifest) {
  return (
    manifest &&
    manifest.private !== true &&
    typeof manifest.name === 'string' &&
    manifest.name.startsWith(scope) &&
    manifest.publishConfig?.registry === githubRegistry
  )
}

// `before` and `after` map a package name to its manifest at the parent and
// at the release commit. A package absent from `before` is new; it is a
// target like any bump. Unchanged versions and private packages are not.
export function releaseTargets(before, after) {
  return [...after.entries()]
    .filter(([, manifest]) => publishable(manifest))
    .filter(([name, manifest]) => before.get(name)?.version !== manifest.version)
    .map(([name, manifest]) => ({
      name,
      version: manifest.version,
      previous: before.get(name)?.version ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/u.exec(version || '')
  if (!match) throw new Error(`Unparseable package version: ${version}`)
  return { core: match.slice(1, 4).map(BigInt), prerelease: match[4] }
}

// Enough of SemVer ordering to tell whether a newer release has overtaken a
// missing version. Prerelease identifiers compare as a whole string.
export function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

// present:    the registry serves this exact version.
// superseded: it does not, but its `latest` is already newer. release.yml
//             refuses to move `latest` backwards, so a re-dispatch cannot
//             publish it; docs/package-releases.md step 4 says ship the newer
//             version instead, which has already happened.
// missing:    it does not, and nothing newer has shipped.
export function versionState(packument, version) {
  if (!packument) return 'missing'
  if (packument.versions && Object.hasOwn(packument.versions, version)) return 'present'
  const latest = packument['dist-tags']?.latest
  if (latest && compareVersions(latest, version) > 0) return 'superseded'
  return 'missing'
}

export function packumentUrl(registry, name) {
  if (!name.startsWith(scope) || !/^@[a-z0-9-]+\/[a-z0-9.-]+$/u.test(name))
    throw new Error(`Unexpected package name: ${name}`)
  return `${registry}/${name.replace('/', '%2f')}`
}

// Reads one packument per target. 404 means the package has never published;
// any other non-success response fails closed rather than reading as missing.
export async function readStates({ registry, targets, token, request = fetch }) {
  const states = new Map()
  for (const target of targets) {
    const headers = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await request(packumentUrl(registry, target.name), {
      headers,
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 404) {
      states.set(label(target), 'missing')
      continue
    }
    if (!response.ok)
      throw new Error(`${registry} answered ${response.status} for ${target.name}; cannot prove it`)
    states.set(label(target), versionState(await response.json(), target.version))
  }
  return states
}

export function partition(targets, states) {
  const byState = { present: [], superseded: [], missing: [] }
  for (const target of targets) byState[states.get(label(target)) ?? 'missing'].push(target)
  return byState
}

// One decision per GitHub Packages poll. `ci` is the latest push CI run for
// the commit (or undefined before it exists); `releaseBusy` is whether any
// Release run is queued, waiting or running.
export function githubDecision({
  byState,
  elapsed,
  graceMs,
  deadlineMs,
  dispatchedAt,
  settleAfterDispatchMs,
  ci,
  releaseBusy,
}) {
  const { missing, superseded } = byState
  if (missing.length === 0) return { kind: 'done' }
  if (elapsed >= deadlineMs)
    return {
      kind: 'fail',
      reason: `not served by ${githubRegistry} after ${Math.round(deadlineMs / minute)} min`,
    }
  if (dispatchedAt !== undefined) {
    if (!releaseBusy && elapsed - dispatchedAt >= settleAfterDispatchMs)
      return {
        kind: 'fail',
        reason: 'the re-dispatched Release run finished without publishing them',
      }
    return { kind: 'wait' }
  }
  if (elapsed < graceMs) return { kind: 'wait' }
  if (!ci || ci.status !== 'completed') return { kind: 'wait' }
  if (ci.conclusion !== 'success')
    return {
      kind: 'fail',
      reason: `push CI run ${ci.id} for this commit concluded ${ci.conclusion}, so Release cannot publish it. Re-run that CI; a green re-run triggers Release, then re-run this proof`,
    }
  if (releaseBusy) return { kind: 'wait' }
  if (superseded.length > 0)
    return {
      kind: 'fail',
      reason: `a re-dispatch would also try ${labels(superseded)}, which newer releases have overtaken, and release.yml refuses to move latest backwards. Recover by hand (docs/package-releases.md, "A publish looks skipped or missing", step 4)`,
    }
  return { kind: 'dispatch' }
}

export async function proveGithubPackages({
  targets,
  readRegistry,
  readCi,
  readReleaseBusy,
  dispatch,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = () => {},
  intervalMs = minute,
  graceMs = 20 * minute,
  deadlineMs = 75 * minute,
  settleAfterDispatchMs = 5 * minute,
}) {
  const started = now()
  let dispatchedAt
  for (;;) {
    const byState = partition(targets, await readRegistry(targets))
    const elapsed = now() - started
    const needsActions = byState.missing.length > 0 && elapsed >= graceMs
    const decision = githubDecision({
      byState,
      elapsed,
      graceMs,
      deadlineMs,
      dispatchedAt,
      settleAfterDispatchMs,
      ci: needsActions && dispatchedAt === undefined ? await readCi() : undefined,
      releaseBusy: needsActions ? await readReleaseBusy() : false,
    })
    if (decision.kind === 'done') return { ...byState, dispatched: dispatchedAt !== undefined }
    if (decision.kind === 'fail')
      return { ...byState, dispatched: dispatchedAt !== undefined, failure: decision.reason }
    if (decision.kind === 'dispatch') {
      await dispatch()
      dispatchedAt = now() - started
      log(`Re-dispatched release.yml once; still missing: ${labels(byState.missing)}`)
    } else {
      log(
        `${Math.round(elapsed / 1000)}s: waiting on ${githubRegistry} for ${labels(byState.missing)}`,
      )
    }
    await sleep(intervalMs)
  }
}

export async function waitForRegistry({
  targets,
  readRegistry,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = () => {},
  intervalMs = 30_000,
  deadlineMs,
}) {
  const started = now()
  for (;;) {
    const states = await readRegistry(targets)
    const missing = targets.filter((target) => states.get(label(target)) !== 'present')
    if (missing.length === 0) return []
    const elapsed = now() - started
    if (elapsed >= deadlineMs) return missing
    log(`${Math.round(elapsed / 1000)}s: waiting on the mirror for ${labels(missing)}`)
    await sleep(intervalMs)
  }
}

// --- CLI --------------------------------------------------------------------

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function minutesOption(name, fallback) {
  const value = Number(option(name, fallback))
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be minutes`)
  return value * minute
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}

function requireSha() {
  const sha = process.env.RELEASE_SHA || ''
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('RELEASE_SHA must be a full commit SHA')
  return sha
}

function readTargets() {
  const targets = JSON.parse(process.env.RELEASE_TARGETS || '[]')
  if (!Array.isArray(targets)) throw new Error('RELEASE_TARGETS must be a JSON array')
  for (const target of targets) {
    packumentUrl(githubRegistry, target.name)
    versionParts(target.version)
  }
  return targets
}

function manifestAt(commit, relativeDirectory) {
  const result = spawnSync('git', ['show', `${commit}:${relativeDirectory}/package.json`], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) return undefined
  return JSON.parse(result.stdout)
}

function plan() {
  const sha = requireSha()
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (head.stdout.trim() !== sha) throw new Error('The checkout is not the release commit')
  const parent = spawnSync('git', ['rev-parse', '--verify', `${sha}^1`], {
    cwd: root,
    encoding: 'utf8',
  })
  if (parent.status !== 0) throw new Error(`Cannot read the parent of ${sha}; fetch depth 2`)
  const workspace = loadWorkspace(root)
  const before = new Map()
  const after = new Map()
  for (const { name, relativeDirectory, manifest } of workspace.packages) {
    after.set(name, manifest)
    const previous = manifestAt(parent.stdout.trim(), relativeDirectory)
    if (previous?.name === name) before.set(name, previous)
  }
  const targets = releaseTargets(before, after)
  output('targets', JSON.stringify(targets))
  output('count', String(targets.length))
  if (targets.length === 0) {
    console.log(`${sha} bumps no publishable package version; nothing to prove.`)
    return
  }
  console.log(`${sha} bumps ${targets.length} publishable version(s): ${labels(targets)}`)
  summary(
    [
      `### Release publication proof for \`${sha.slice(0, 12)}\``,
      '',
      ...targets.map((t) => `- \`${label(t)}\` (was ${t.previous ?? 'unpublished'})`),
    ].join('\n'),
  )
}

async function actionsApi(path, init = {}) {
  const repository = process.env.GITHUB_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository || '')) throw new Error('GITHUB_REPOSITORY is unset')
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub API ${path.split('?')[0]} answered ${response.status}`)
  return response.status === 204 ? undefined : response.json()
}

async function github() {
  const sha = requireSha()
  const targets = readTargets()
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN (the job token) is required to read GitHub Packages')
  const result = await proveGithubPackages({
    targets,
    readRegistry: (list) => readStates({ registry: githubRegistry, targets: list, token }),
    readCi: async () => {
      const { workflow_runs: runs } = await actionsApi(
        `actions/workflows/ci.yml/runs?event=push&head_sha=${sha}&per_page=20`,
      )
      return [...runs].sort((a, b) => b.id - a.id)[0]
    },
    readReleaseBusy: async () => {
      const { workflow_runs: runs } = await actionsApi(
        'actions/workflows/release.yml/runs?per_page=30',
      )
      return runs.some((run) => activeRunStatuses.has(run.status))
    },
    dispatch: () =>
      actionsApi('actions/workflows/release.yml/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { 'verified-sha': sha } }),
      }),
    log: (line) => console.log(line),
    graceMs: minutesOption('grace-minutes', 20),
    deadlineMs: minutesOption('timeout-minutes', 75),
  })
  const served = result.present
  output('served', JSON.stringify(served))
  output('served-count', String(served.length))
  output('dispatched', String(result.dispatched))
  for (const target of result.superseded)
    console.log(
      `::warning title=Superseded release version::${label(target)} was never published, and a newer ${target.name} already is. Not re-publishing it (docs/package-releases.md, step 4).`,
    )
  if (result.failure) {
    for (const target of result.missing)
      console.log(
        `::error title=Release version not published::${label(target)} from ${sha} is missing from ${githubRegistry}: ${result.failure}.`,
      )
    summary(`**GitHub Packages: MISSING** ${labels(result.missing)} (${result.failure})`)
    process.exitCode = 1
    return
  }
  console.log(`${githubRegistry} serves ${labels(served) || 'no targets'}.`)
  summary(
    `**GitHub Packages: served** ${labels(served) || '(none)'}${result.dispatched ? ' after one release.yml re-dispatch' : ''}`,
  )
}

async function mirror() {
  const phase = option('phase', '')
  if (!['settle', 'confirm'].includes(phase)) throw new Error('--phase settle|confirm')
  const targets = readTargets()
  const missing = await waitForRegistry({
    targets,
    readRegistry: (list) => readStates({ registry: mirrorRegistry, targets: list }),
    log: (line) => console.log(line),
    deadlineMs: minutesOption('timeout-minutes', phase === 'settle' ? 15 : 20),
  })
  output('missing', JSON.stringify(missing))
  output('missing-count', String(missing.length))
  if (missing.length === 0) {
    console.log(`${mirrorRegistry} serves ${labels(targets) || 'no targets'}.`)
    summary(`**npm.nard.uk: served** ${labels(targets) || '(none)'}`)
    return
  }
  if (phase === 'settle') {
    console.log(`${mirrorRegistry} is still missing ${labels(missing)}; re-dispatching the sync.`)
    return
  }
  for (const target of missing)
    console.log(
      `::error title=Release version not mirrored::${label(target)} is on ${githubRegistry} but missing from ${mirrorRegistry} after a sync re-dispatch. Check package-delivery "Sync to R2".`,
    )
  summary(`**npm.nard.uk: MISSING** ${labels(missing)}`)
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command === 'plan') plan()
  else if (command === 'github') await github()
  else if (command === 'mirror') await mirror()
  else throw new Error('Usage: prove-release-publication.mjs plan|github|mirror [options]')
}
