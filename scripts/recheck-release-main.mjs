#!/usr/bin/env node
/**
 * After a Release run whose verified commit was no longer main's tip
 * (narduk-libs#1119). Such a run still publishes what its commit bumped, but
 * it skips drift synthesis and release-PR preparation, which only run against
 * current main. It used to end green and say nothing, so a merge race left the
 * next release PR unprepared until someone dispatched release.yml by hand.
 *
 * Logan, 2026-09-26 (askme, verbatim): "Loud re-check now; App token as
 * proposal (Recommended)".
 *
 * One decision, from main's tip now:
 *   current   main is back at the verified commit; nothing to do.
 *   queued    another Release run is queued or waiting; it takes main forward.
 *             Never dispatch into a busy group: a new queued run replaces the
 *             pending one in `narduk-libs-release` (the #477 lesson that
 *             release-proof.yml follows too).
 *   wait-ci   the tip's push CI has not finished; its success triggers Release.
 *   dispatch  the tip's push CI succeeded and no Release run will follow it:
 *             dispatch release.yml with `verified-sha` set to the tip. Each hop
 *             moves strictly forward along main, so repeated hops converge.
 *   warn      the tip's push CI concluded without success; nothing can release
 *             it until that CI is green. A `::warning`, with the command.
 *
 *   GH_TOKEN=... GITHUB_REPOSITORY=... GITHUB_RUN_ID=... VERIFIED_SHA=... \
 *     node scripts/recheck-release-main.mjs
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const waitingStatuses = new Set(['queued', 'waiting', 'pending', 'requested'])
const shaPattern = /^[0-9a-f]{40}$/u

/**
 * `ci` is the newest push CI run for `tip` (undefined before one exists);
 * `releaseRuns` are recent Release runs as the Actions API lists them.
 */
export function recheckDecision({ verifiedSha, tip, ci, releaseRuns, ownRunId }) {
  if (tip === verifiedSha) return { kind: 'current' }
  const waiting = releaseRuns.filter(
    (run) => String(run.id) !== String(ownRunId) && waitingStatuses.has(run.status),
  )
  if (waiting.length > 0) return { kind: 'queued', runIds: waiting.map((run) => run.id) }
  if (!ci || ci.status !== 'completed') return { kind: 'wait-ci', ci }
  if (ci.conclusion === 'success') return { kind: 'dispatch' }
  return { kind: 'warn', ci }
}

/** The annotation line for a decision, or '' when there is nothing to say. */
export function annotate(decision, { verifiedSha, tip, repository }) {
  const short = (sha) => sha.slice(0, 12)
  const moved = `This run released ${short(verifiedSha)}, but main has moved to ${short(tip)}`
  switch (decision.kind) {
    case 'current':
      return ''
    case 'queued':
      return `::notice title=Release continues in a queued run::${moved}. Release run(s) ${decision.runIds.join(', ')} are queued and take main forward, so this run dispatches nothing.`
    case 'wait-ci':
      return `::notice title=Release waits for main CI::${moved}. Its push CI is ${decision.ci ? decision.ci.status : 'not started'}; the Release run its success triggers prepares the release PR.`
    case 'dispatch':
      return `::notice title=Release handed to newer main::${moved}, whose push CI succeeded and no Release run is queued. Dispatched release.yml with verified-sha=${tip}.`
    case 'warn':
      return `::warning title=Release not prepared for main::${moved}. Its push CI run ${decision.ci.id} concluded ${decision.ci.conclusion}, so no Release run can prepare the release PR or synthesize drift for it. Make main's CI green (a green push run triggers Release), or once it is green run: gh workflow run release.yml --repo ${repository} -f verified-sha=${tip}`
    default:
      throw new Error(`unknown decision ${decision.kind}`)
  }
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

async function main() {
  const verifiedSha = process.env.VERIFIED_SHA || ''
  if (!shaPattern.test(verifiedSha)) throw new Error('VERIFIED_SHA must be a full commit SHA')
  const repository = process.env.GITHUB_REPOSITORY
  const { object } = await actionsApi('git/ref/heads/main')
  const tip = object.sha
  if (!shaPattern.test(tip)) throw new Error(`main resolved to ${tip}`)
  const { workflow_runs: ciRuns } = await actionsApi(
    `actions/workflows/ci.yml/runs?event=push&head_sha=${tip}&per_page=20`,
  )
  const ci = [...ciRuns].sort((a, b) => b.id - a.id)[0]
  const { workflow_runs: releaseRuns } = await actionsApi(
    'actions/workflows/release.yml/runs?per_page=30',
  )
  const decision = recheckDecision({
    verifiedSha,
    tip,
    ci,
    releaseRuns,
    ownRunId: process.env.GITHUB_RUN_ID,
  })
  if (decision.kind === 'dispatch')
    await actionsApi('actions/workflows/release.yml/dispatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { 'verified-sha': tip } }),
    })
  const line = annotate(decision, { verifiedSha, tip, repository })
  console.log(line || `main is still at ${verifiedSha}; nothing to hand on.`)
  if (line && process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${line.replace(/^::\w+ title=([^:]+)::/u, '**$1:** ')}\n`,
    )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.log(
      `::warning title=Release re-check failed::${error.message}. Check main's Release state by hand (docs/package-releases.md).`,
    )
    process.exitCode = 1
  })
