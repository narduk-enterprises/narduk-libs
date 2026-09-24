// One command from a merge SHA to mirror-verified versions (narduk-libs#491).
//
// Ad-hoc `until` loops re-derived Release-event semantics and got them wrong:
//
//   - `gh run list --workflow release.yml` `headSha` is the workflow_run
//     checkout (main's head at trigger time), not verify-ci's VERIFIED_SHA.
//     A completed/skipped run with a matching headSha is not this merge's
//     release.
//   - `gh run list --branch changeset-release/main --status action_required`
//     without `headSha == current PR head` approves superseded SHAs; those
//     runs share the PR concurrency group and cancel the current head.
//
// Usage: node scripts/release-wait.mjs <merge-sha>
// Does not merge a release PR and does not publish.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { mirrorRegistry, packumentUrl, releaseTargets } from './prove-release-publication.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultRepo = 'narduk-enterprises/narduk-libs'
const defaultDeadlineMs = 90 * 60_000
const defaultIntervalMs = 15_000

export function requireMergeSha(value) {
  if (!/^[a-f0-9]{40}$/u.test(value || '')) {
    throw new Error('release-wait requires a full commit SHA')
  }
  return value
}

export function selectPushCiRun({ mergeSha, runs }) {
  requireMergeSha(mergeSha)
  return (
    [...runs]
      .filter(
        (run) =>
          run.headSha === mergeSha &&
          run.event === 'push' &&
          run.headBranch === 'main' &&
          run.status === 'completed' &&
          run.conclusion === 'success',
      )
      .sort((left, right) => right.id - left.id)[0] ?? null
  )
}

// Key on verify-ci VERIFIED_SHA. Do not key on run.headSha: for workflow_run
// that field is main HEAD, not the triggering CI commit.
export function selectReleaseRun({ mergeSha, runs }) {
  requireMergeSha(mergeSha)
  return (
    [...runs]
      .filter(
        (run) =>
          run.verifiedSha === mergeSha &&
          run.status === 'completed' &&
          run.conclusion === 'success',
      )
      .sort((left, right) => right.id - left.id)[0] ?? null
  )
}

export function approveableRunIds({ currentHeadSha, runs }) {
  requireMergeSha(currentHeadSha)
  return runs
    .filter((run) => run.status === 'action_required' && run.headSha === currentHeadSha)
    .map((run) => run.id)
}

export function publishTag(target) {
  return `${target.name}@${target.version}`
}

export function missingPublishTags(expected, existing) {
  const have = new Set(existing)
  return expected.filter((tag) => !have.has(tag))
}

export function mirrorMissing(targets, packuments) {
  return targets.filter((target) => {
    const versions = packuments.get(target.name)?.versions
    return !versions || !Object.hasOwn(versions, target.version)
  })
}

export function parseVerifiedShaFromLog(text) {
  return /Verified full CI for ([0-9a-f]{40})/u.exec(text || '')?.[1] ?? null
}

export async function waitForRelease({
  mergeSha,
  intervalMs = defaultIntervalMs,
  deadlineMs = defaultDeadlineMs,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  readPushCi,
  readReleaseRuns,
  readReleasePrHead,
  readHeldRuns,
  approveRuns,
  readTargets,
  readTags,
  readMirror,
  log = () => {},
}) {
  requireMergeSha(mergeSha)
  const started = now()
  let releaseRunId
  let approved = false

  for (;;) {
    if (now() - started >= deadlineMs) {
      throw new Error(`release-wait timed out waiting for ${mergeSha}`)
    }

    if (!selectPushCiRun({ mergeSha, runs: await readPushCi() })) {
      log(`waiting for push CI on ${mergeSha}`)
      await sleep(intervalMs)
      continue
    }

    const release = selectReleaseRun({ mergeSha, runs: await readReleaseRuns() })
    if (!release) {
      log(`waiting for the Release run whose verify-ci VERIFIED_SHA is ${mergeSha}`)
      await sleep(intervalMs)
      continue
    }
    releaseRunId = release.id

    const currentHeadSha = await readReleasePrHead()
    if (!approved && currentHeadSha) {
      const ids = approveableRunIds({ currentHeadSha, runs: await readHeldRuns() })
      if (ids.length > 0) await approveRuns(ids)
      approved = true
    }

    const targets = await readTargets()
    if (targets.length === 0) {
      if (!currentHeadSha) {
        log('waiting for changeset-release/main to refresh')
        await sleep(intervalMs)
        continue
      }
      return { releaseRunId, versions: [] }
    }

    const versions = targets.map(publishTag)
    const tags = missingPublishTags(versions, await readTags())
    if (tags.length > 0) {
      log(`waiting for publish tags ${tags.join(', ')}`)
      await sleep(intervalMs)
      continue
    }

    const missing = mirrorMissing(targets, await readMirror())
    if (missing.length > 0) {
      log(`waiting for npm.nard.uk ${missing.map(publishTag).join(', ')}`)
      await sleep(intervalMs)
      continue
    }

    return { releaseRunId, versions }
  }
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function gh(args, { reject = true } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (!reject) return ''
    throw new Error(`gh ${args[0]} failed (${result.status}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function gitShow(spec) {
  const result = spawnSync('git', ['show', spec], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (result.status !== 0) return undefined
  return JSON.parse(result.stdout)
}

function manifestsAt(sha) {
  const map = new Map()
  for (const { name, relativeDirectory } of loadWorkspace(root).packages) {
    const manifest = gitShow(`${sha}:${relativeDirectory}/package.json`)
    if (manifest?.name) map.set(manifest.name, manifest)
    else if (manifest) map.set(name, manifest)
  }
  return map
}

function parentSha(sha) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${sha}^1`], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`Cannot read the parent of ${sha}`)
  return result.stdout.trim()
}

export function createGithubIo({ repo, mergeSha, request = fetch }) {
  requireMergeSha(mergeSha)
  const verifiedCache = new Map()

  function api(path) {
    return JSON.parse(gh(['api', `repos/${repo}/${path}`]))
  }

  async function readVerifiedSha(run) {
    if (verifiedCache.has(run.id)) return verifiedCache.get(run.id)
    const jobs = api(`actions/runs/${run.id}/jobs?per_page=100`).jobs || []
    const verify = jobs.find((job) => job.name === 'verify-ci')
    if (!verify || verify.status !== 'completed' || verify.conclusion !== 'success') {
      verifiedCache.set(run.id, null)
      return null
    }
    const log = gh(['run', 'view', String(run.id), '--repo', repo, '--job', 'verify-ci', '--log'], {
      reject: false,
    })
    const sha = parseVerifiedShaFromLog(log)
    verifiedCache.set(run.id, sha)
    return sha
  }

  async function readPrHead() {
    const out = gh(
      [
        'pr',
        'view',
        'changeset-release/main',
        '--repo',
        repo,
        '--json',
        'headRefOid',
        '--jq',
        '.headRefOid',
      ],
      { reject: false },
    ).trim()
    return /^[a-f0-9]{40}$/u.test(out) ? out : null
  }

  async function targets() {
    const parent = parentSha(mergeSha)
    const fromMerge = releaseTargets(manifestsAt(parent), manifestsAt(mergeSha))
    if (fromMerge.length > 0) return fromMerge
    const head = (await readPrHead()) || mergeSha
    return releaseTargets(manifestsAt(mergeSha), manifestsAt(head))
  }

  return {
    async readPushCi() {
      const { workflow_runs: runs } = api(
        `actions/workflows/ci.yml/runs?event=push&head_sha=${mergeSha}&per_page=20`,
      )
      return (runs || []).map((run) => ({
        id: run.id,
        event: run.event,
        headSha: run.head_sha,
        headBranch: run.head_branch,
        status: run.status,
        conclusion: run.conclusion,
      }))
    },
    async readReleaseRuns() {
      const { workflow_runs: runs } = api('actions/workflows/release.yml/runs?per_page=30')
      const listed = []
      for (const run of runs || []) {
        listed.push({
          id: run.id,
          headSha: run.head_sha,
          status: run.status,
          conclusion: run.conclusion,
          event: run.event,
          verifiedSha: await readVerifiedSha(run),
        })
      }
      return listed
    },
    readReleasePrHead: readPrHead,
    async readHeldRuns() {
      const rows = JSON.parse(
        gh([
          'run',
          'list',
          '--repo',
          repo,
          '--branch',
          'changeset-release/main',
          '--status',
          'action_required',
          '--json',
          'databaseId,headSha',
        ]) || '[]',
      )
      return rows.map((row) => ({
        id: row.databaseId,
        headSha: row.headSha,
        status: 'action_required',
      }))
    },
    async approveRuns(ids) {
      for (const id of ids) {
        gh(['api', '-X', 'POST', `repos/${repo}/actions/runs/${id}/approve`])
      }
    },
    readTargets: targets,
    async readTags() {
      const refs = api('git/matching-refs/tags/@narduk-enterprises')
      return (Array.isArray(refs) ? refs : []).map((ref) =>
        String(ref.ref || '').replace(/^refs\/tags\//u, ''),
      )
    },
    async readMirror() {
      const pending = await targets()
      const packuments = new Map()
      for (const target of pending) {
        const response = await request(packumentUrl(mirrorRegistry, target.name), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        })
        if (response.status === 404) {
          packuments.set(target.name, { versions: {} })
          continue
        }
        if (!response.ok) {
          throw new Error(`${mirrorRegistry} answered ${response.status} for ${target.name}`)
        }
        packuments.set(target.name, await response.json())
      }
      return packuments
    },
  }
}

async function main() {
  const mergeSha = requireMergeSha(process.argv[2] || '')
  const repo = option('repo', process.env.GITHUB_REPOSITORY || defaultRepo)
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repo)) throw new Error('Invalid --repo')
  const timeoutMinutes = Number(option('timeout-minutes', 90))
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error('--timeout-minutes must be a positive number')
  }
  const io = createGithubIo({ repo, mergeSha })
  const result = await waitForRelease({
    mergeSha,
    deadlineMs: timeoutMinutes * 60_000,
    ...io,
    log: (line) => console.log(line),
  })
  console.log(
    `Release run ${result.releaseRunId} for ${mergeSha} is mirrored: ${
      result.versions.join(', ') || '(no publishable bump)'
    }`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
