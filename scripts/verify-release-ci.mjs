import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseBranch = 'changeset-release/main'
const shaPattern = /^[a-f0-9]{40}$/u

// Jobs a release PR's CI run must have finished green for it to stand in for
// the push run. ci.yml plans a release PR as a full run (`--all`, browser
// tests on, packed-consumer smoke forced on), so on a full run all of these
// succeed; on an ordinary or path-filtered PR run the browser and smoke jobs
// are `skipped`. Requiring them as `success` is what tells the two apart.
const fullRunJobs = [
  'affected packages',
  'contracts',
  'ci / Required',
  'package / packed-consumer-smoke',
  'package / browser tests',
  'verify',
]

function assertRetainedInMain({ sha, currentMain, comparison }) {
  if (
    !shaPattern.test(sha) ||
    !shaPattern.test(currentMain) ||
    (sha !== currentMain &&
      (comparison?.status !== 'ahead' ||
        comparison.base_commit?.sha !== sha ||
        comparison.merge_base_commit?.sha !== sha))
  )
    throw new Error('Release SHA must be a verified commit retained in main history')
}

export function verifyReleaseEvidence({ sha, repository, currentMain, comparison, runs, jobs }) {
  assertRetainedInMain({ sha, currentMain, comparison })
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

/**
 * The second way to prove a release commit (narduk-libs#1354, cut 2). The
 * release PR's own `pull_request` CI run is a full run on the tree the merge
 * produces, so when that tree is byte-identical to the one the main commit
 * carries, re-running the same suite on a push proves nothing new. Every
 * condition below must hold; any failure throws and the caller falls back to
 * waiting for the push run (`verifyReleaseEvidence`).
 *
 * `pulls` are the pull requests GitHub associates with `sha`; `mainCommit` and
 * `headCommit` are git commit objects (`tree.sha`, `parents`); `runs` are the
 * `ci.yml` `pull_request` runs for the PR head; `jobs` are that run's jobs.
 *
 * Besides tree equality this requires the main commit and the PR head to share
 * their single parent. The PR run checks out GitHub's merge of the head into
 * the base *at run time*; that merge equals the head's own tree only while the
 * base is still the head's parent, and a shared parent proves main did not
 * move between the head being pushed and the merge (history only appends).
 */
export function verifyTreeEvidence({
  sha,
  repository,
  currentMain,
  comparison,
  pulls,
  mainCommit,
  headCommit,
  runs,
  jobs,
}) {
  assertRetainedInMain({ sha, currentMain, comparison })
  const merged = pulls.filter(
    (pr) =>
      pr.merge_commit_sha === sha &&
      Boolean(pr.merged_at) &&
      pr.base?.ref === 'main' &&
      pr.base.repo?.full_name === repository &&
      pr.head?.ref === releaseBranch &&
      pr.head.repo?.full_name === repository &&
      shaPattern.test(pr.head.sha || ''),
  )
  if (merged.length !== 1)
    throw new Error(`Expected exactly one merged ${releaseBranch} pull request for this commit`)
  const [pr] = merged
  if (
    mainCommit?.sha !== sha ||
    headCommit?.sha !== pr.head.sha ||
    !shaPattern.test(mainCommit.tree?.sha || '') ||
    mainCommit.tree.sha !== headCommit.tree?.sha
  )
    throw new Error('The pull request head tree does not match the main commit tree')
  if (
    mainCommit.parents?.length !== 1 ||
    headCommit.parents?.length !== 1 ||
    mainCommit.parents[0].sha !== headCommit.parents[0].sha
  )
    throw new Error('Main moved between the pull request head and its merge')
  const run = [...runs]
    .filter(
      (entry) =>
        entry.head_sha === pr.head.sha &&
        entry.event === 'pull_request' &&
        entry.head_branch === releaseBranch &&
        entry.head_repository?.full_name === repository &&
        entry.repository?.full_name === repository &&
        entry.path === '.github/workflows/ci.yml',
    )
    .sort((a, b) => b.id - a.id)[0]
  if (!run || run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error('The latest pull request CI run for the merged head must have succeeded')
  const attempt = jobs.filter((job) => job.run_id === run.id && job.run_attempt === run.run_attempt)
  for (const name of fullRunJobs) {
    const named = attempt.filter((job) => job.name === name)
    if (named.length !== 1 || named[0].status !== 'completed' || named[0].conclusion !== 'success')
      throw new Error(`The pull request CI run is not a full run: "${name}" did not succeed`)
  }
  if (
    !attempt.some((job) => job.name.startsWith('ci / package / ') && job.conclusion === 'success')
  )
    throw new Error('The pull request CI run is not a full run: no package job succeeded')
  if (attempt.some((job) => job.conclusion !== 'success' && job.conclusion !== 'skipped'))
    throw new Error('The pull request CI run has a job that neither succeeded nor was skipped')
  return { runId: run.id, pr: pr.number, headSha: pr.head.sha, tree: mainCommit.tree.sha }
}

function ghApi(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to read CI evidence (${result.status})`)
  return JSON.parse(result.stdout)
}

function readEvidence(api, repository, sha) {
  const currentMain = api(`repos/${repository}/git/ref/heads/main`).object.sha
  const comparison =
    sha === currentMain ? undefined : api(`repos/${repository}/compare/${sha}...${currentMain}`)
  return { sha, repository, currentMain, comparison }
}

function readPushEvidence(api, base) {
  const { repository, sha } = base
  const runs = api(
    `repos/${repository}/actions/workflows/ci.yml/runs?event=push&head_sha=${sha}&per_page=100`,
  ).workflow_runs
  const latest = [...runs].sort((a, b) => b.id - a.id)[0]
  const jobs = latest
    ? api(
        `repos/${repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`,
      ).jobs
    : []
  return { ...base, runs, jobs }
}

function readTreeEvidence(api, base) {
  const { repository, sha } = base
  const pulls = api(`repos/${repository}/commits/${sha}/pulls?per_page=100`)
  const pr = pulls.find((entry) => entry.merge_commit_sha === sha && entry.head?.sha)
  if (!pr) return { ...base, pulls, runs: [], jobs: [] }
  const mainCommit = api(`repos/${repository}/git/commits/${sha}`)
  const headCommit = api(`repos/${repository}/git/commits/${pr.head.sha}`)
  const runs = api(
    `repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`,
  ).workflow_runs
  const latest = [...runs]
    .filter((entry) => entry.head_sha === pr.head.sha)
    .sort((a, b) => b.id - a.id)[0]
  const jobs = latest
    ? api(
        `repos/${repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`,
      ).jobs
    : []
  return { ...base, pulls, mainCommit, headCommit, runs, jobs }
}

/**
 * `early` is the Release run that starts while the release commit's push CI is
 * still running: only the tree rule can answer then, and not being able to is
 * not a failure, because the run the push CI's completion starts proves the
 * commit the old way.
 */
export function decideRelease({ early, api, repository, sha }) {
  const treeProof = () => {
    const evidence = readTreeEvidence(api, readEvidence(api, repository, sha))
    return {
      verified: true,
      rule: 'tree',
      ...verifyTreeEvidence(evidence),
      mainTree: evidence.mainCommit.tree.sha,
    }
  }
  if (early) {
    try {
      return treeProof()
    } catch (error) {
      return { verified: false, rule: 'tree', reason: error.message }
    }
  }
  try {
    const runId = verifyReleaseEvidence(readPushEvidence(api, readEvidence(api, repository, sha)))
    return { verified: true, rule: 'push', runId }
  } catch (pushError) {
    try {
      return treeProof()
    } catch (treeError) {
      console.log(`Tree rule did not apply: ${treeError.message}`)
      throw pushError
    }
  }
}

function main() {
  const { VERIFIED_SHA: sha, GITHUB_REPOSITORY: repository } = process.env
  if (!/^[a-f0-9]{40}$/u.test(sha || '') || !/^[\w.-]+\/[\w.-]+$/u.test(repository || ''))
    throw new Error('Invalid release inputs')
  const early = process.env.RELEASE_VERIFY_MODE === 'early'
  const result = decideRelease({ early, api: ghApi, repository, sha })
  const out = (verified) => {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `verified=${verified}\nrule=${result.rule}\n`)
  }
  if (!result.verified) {
    console.log(
      `::notice title=Release waits for push CI::The release PR's CI run cannot stand in for ${sha} (${result.reason}). The Release run that main's push CI completion starts will prove and publish it.`,
    )
    out(false)
    return
  }
  const runUrl = (id) => `https://github.com/${repository}/actions/runs/${id}`
  if (result.rule === 'push')
    console.log(`Verified full CI for ${sha} by the push rule: ${runUrl(result.runId)}`)
  else
    console.log(
      `Verified full CI for ${sha} by the tree rule: pull request #${result.pr} run ${runUrl(result.runId)} on head ${result.headSha} has tree ${result.tree}; the main commit has tree ${result.mainTree}.`,
    )
  out(true)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
