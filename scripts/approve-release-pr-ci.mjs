#!/usr/bin/env node
/**
 * Plans the approval of the CI run GitHub holds for the `chore: release
 * packages` PR (narduk-libs#1354, cut 1; Logan, 2026-10-02, askme, verbatim:
 * "Use the estate App token (Recommended)").
 *
 * The Release workflow pushes `changeset-release/main` with its job-scoped
 * GITHUB_TOKEN, so GitHub creates the PR's `pull_request` CI run but holds it
 * as `action_required` until someone approves it (median 574 s of waiting on
 * 2026-10-02). docs/package-releases.md, "Approving `chore: release packages`
 * PR runs", is the hand procedure. This script decides which run that
 * procedure may approve; the approve call itself is made by the
 * `approve-release-pr-ci` job with a per-run token from the estate App
 * `narduk-lane-automation`, downscoped to this repository and `actions: write`.
 * This script holds no credential beyond the read-only job token, and writes
 * nothing to GitHub.
 *
 * The guard is the point. It names a run only when every one of these holds,
 * and otherwise names nothing and says why:
 *   - the pull request is open, is the one the Release job just created or
 *     updated, targets `main`, and its head branch is `changeset-release/main`
 *     in this repository (never a fork);
 *   - its head commit is the commit the Release job of THIS run left checked
 *     out (`EXPECTED_HEAD`), so a superseded head is never approved, and that
 *     commit was authored and committed by github-actions[bot] with the
 *     release title;
 *   - the run is the `ci.yml` `pull_request` run for exactly that head commit,
 *     on that branch, from this repository, and is `action_required`.
 * Superseded heads' held runs are never named: on 2026-09-22 an unfiltered
 * approve released 20 runs and cancelled the current head's.
 *
 * It can never fail a release: `main` turns every error into a `::warning`
 * and exits 0, and the workflow jobs are `continue-on-error`. The manual
 * approval path is unchanged and still works.
 *
 *   GH_TOKEN=... GITHUB_REPOSITORY=... EXPECTED_HEAD=... PR_NUMBER=... \
 *     node scripts/approve-release-pr-ci.mjs
 * Writes `runs` (space-separated run ids) and `head` to $GITHUB_OUTPUT.
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const releaseBranch = 'changeset-release/main'
export const releaseTitle = 'chore: release packages'
export const botEmail = '41898282+github-actions[bot]@users.noreply.github.com'
const shaPattern = /^[0-9a-f]{40}$/u

/**
 * Returns `{ approve: [runId...] }` or `{ approve: [], reason }`. `pr` is the
 * pull request object, `commit` the git commit object of its head, `runs` the
 * `ci.yml` `pull_request` runs listed for `expectedHead`.
 */
export function selectRunsToApprove({ repository, expectedHead, prNumber, pr, commit, runs }) {
  const refuse = (reason) => ({ approve: [], reason })
  if (!shaPattern.test(expectedHead || ''))
    return refuse('the Release job reported no release PR head')
  if (!pr || pr.state !== 'open') return refuse('the release pull request is not open')
  if (String(pr.number) !== String(prNumber))
    return refuse(`the pull request is #${pr.number}, not the #${prNumber} this run updated`)
  if (pr.base?.ref !== 'main') return refuse('the pull request does not target main')
  if (pr.head?.ref !== releaseBranch)
    return refuse(`the head branch is ${pr.head?.ref}, not ${releaseBranch}`)
  if (pr.head.repo?.full_name !== repository || pr.base.repo?.full_name !== repository)
    return refuse('the head repository is not this repository')
  if (pr.head.sha !== expectedHead)
    return refuse(
      `the pull request head is ${String(pr.head.sha).slice(0, 12)}, not the ${expectedHead.slice(0, 12)} this run pushed; the run that pushed the newer head approves its own`,
    )
  if (
    commit?.sha !== expectedHead ||
    commit.author?.email !== botEmail ||
    commit.committer?.email !== botEmail ||
    !String(commit.message || '').startsWith(releaseTitle)
  )
    return refuse('the head commit was not authored by the Release workflow')
  const approve = runs
    .filter(
      (run) =>
        run.status === 'completed' &&
        run.conclusion === 'action_required' &&
        run.event === 'pull_request' &&
        run.head_sha === expectedHead &&
        run.head_branch === releaseBranch &&
        run.head_repository?.full_name === repository &&
        run.repository?.full_name === repository &&
        run.path === '.github/workflows/ci.yml',
    )
    .map((run) => run.id)
  if (approve.length === 0) return refuse('no held ci.yml run for that head yet')
  return { approve }
}

async function api(path) {
  const repository = process.env.GITHUB_REPOSITORY
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub API ${path.split('?')[0]} answered ${response.status}`)
  return response.status === 204 ? undefined : response.json()
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function summarize(line) {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${line.replace(/^::\w+ title=([^:]+)::/u, '**$1:** ')}\n`,
    )
}

/**
 * The held run appears a few seconds after the push, so a refusal for "no held
 * run yet" is retried inside a hard deadline (12 reads, 5 s apart); every other
 * refusal is final.
 */
export async function plan({ read, wait = sleep, attempts = 12, intervalMs = 5000 }) {
  let last = { approve: [], reason: 'not read' }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = selectRunsToApprove(await read())
    if (last.approve.length > 0 || !last.reason.startsWith('no held ci.yml run')) break
    if (attempt < attempts) await wait(intervalMs)
  }
  return last
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

async function main() {
  const { EXPECTED_HEAD: expectedHead, PR_NUMBER: prNumber } = process.env
  const repository = process.env.GITHUB_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository || '')) throw new Error('GITHUB_REPOSITORY is unset')
  if (!shaPattern.test(expectedHead || '') || !/^[0-9]+$/u.test(prNumber || '')) {
    summarize(
      '::notice title=Release PR CI left to manual approval::the Release job reported no release pull request head, so no run was planned for approval. Approve it as docs/package-releases.md describes.',
    )
    return
  }
  const result = await plan({
    read: async () => ({
      repository,
      expectedHead,
      prNumber,
      pr: await api(`pulls/${prNumber}`),
      commit: await api(`git/commits/${expectedHead}`),
      runs: (
        await api(
          `actions/workflows/ci.yml/runs?event=pull_request&status=action_required&head_sha=${expectedHead}&per_page=20`,
        )
      ).workflow_runs,
    }),
  })
  if (result.approve.length > 0) {
    setOutput('runs', result.approve.join(' '))
    setOutput('head', expectedHead)
    summarize(
      `::notice title=Release PR CI approval planned::held ci.yml run(s) ${result.approve.join(', ')} for release PR #${prNumber} head ${expectedHead} may be approved.`,
    )
  } else
    summarize(
      `::notice title=Release PR CI left to manual approval::${result.reason}. Nothing was planned for approval; approve the held run as docs/package-releases.md describes if one exists.`,
    )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    summarize(
      `::warning title=Release PR CI approval failed::${error.message}. The release is unaffected; approve the held run as docs/package-releases.md describes.`,
    )
  })
