import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyReleaseEvidence({ sha, repository, currentMain, runs, jobs }) {
  if (!/^[a-f0-9]{40}$/u.test(sha) || sha !== currentMain)
    throw new Error('Release SHA must equal current main')
  const run = [...runs]
    .filter(
      (entry) => entry.head_sha === sha && entry.event === 'push' && entry.head_branch === 'main',
    )
    .sort((a, b) => b.id - a.id)[0]
  if (
    !run ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.repository?.full_name !== repository
  ) {
    throw new Error('The latest main CI run for this exact SHA must have succeeded')
  }
  const aggregates = jobs.filter(
    (job) => job.name === 'verify' && job.run_id === run.id && job.run_attempt === run.run_attempt,
  )
  if (
    aggregates.length !== 1 ||
    aggregates[0].conclusion !== 'success' ||
    aggregates[0].status !== 'completed'
  ) {
    throw new Error('The exact CI attempt must contain one successful full verify aggregate')
  }
  return run.id
}

function api(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to read CI evidence (${result.status})`)
  return JSON.parse(result.stdout)
}

function main() {
  const { VERIFIED_SHA: sha, GITHUB_REPOSITORY: repository } = process.env
  if (!/^[a-f0-9]{40}$/u.test(sha || '') || !/^[\w.-]+\/[\w.-]+$/u.test(repository || ''))
    throw new Error('Invalid release inputs')
  const currentMain = api(`repos/${repository}/git/ref/heads/main`).object.sha
  const runs = api(
    `repos/${repository}/actions/workflows/ci.yml/runs?event=push&head_sha=${sha}&per_page=100`,
  ).workflow_runs
  const latest = [...runs].sort((a, b) => b.id - a.id)[0]
  const jobs = latest
    ? api(
        `repos/${repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`,
      ).jobs
    : []
  const runId = verifyReleaseEvidence({ sha, repository, currentMain, runs, jobs })
  console.log(`Verified full CI for ${sha}: https://github.com/${repository}/actions/runs/${runId}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
