// Live CI canary for accepted PR-to-main packed-consumer reuse (narduk-libs#202).
//
// Production lookupConsumerProof stays push-to-main and ci.yml-only. Main
// proofs are usually cold because a concurrent version commit changes the
// tree or packed inputs. This canary manufactures one executed receipt,
// uploads it under the production artifact name, then consumes it through
// findReusablePackedConsumerProof against a live Actions artifact zip.
// The PR-to-main envelope is synthetic so the production finder can accept
// this run; the artifact list and zip download are real REST calls.
//
// Phases:
//   produce             write an executed proof.json
//   consume-accepted    live REST lookup must reuse
//   fallback-missing    empty artifact list must execute
//   fallback-changed    mutated fingerprint must execute
//
// Fresh external install remains required in production. This canary does
// not pack, install, generate, deploy or publish.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findReusablePackedConsumerProof,
  fingerprintInputs,
  lookupConsumerProof,
  proofArtifactName,
  readProofArchive,
} from './reuse-packed-consumer-proof.mjs'

export const CANARY_ID = 'narduk-libs#202'
export const CANARY_PULL_REQUEST = 202
export const executeLog =
  '[consumer-smoke] Prior proof unavailable or invalid; executing all generated-app gates.'
export const freshInstallLog =
  '[consumer-smoke] Fresh external install remains required; only generated-app quality/migrations/performance/wrangler may reuse.'
export const reusedLog = (prior) =>
  `[consumer-smoke] Reused generated-app proof from PR #${prior.pullRequest}, run ${prior.runId}, attempt ${prior.runAttempt}; exact installed inputs ${prior.fingerprint}.`

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultProofDirectory = join(root, '.ci-evidence', 'packed-consumer-proof')
const shaPattern = /^[0-9a-f]{40}$/u
export const canaryPhases = ['produce', 'consume-accepted', 'fallback-missing', 'fallback-changed']

export function requireMainRef(ref) {
  if (ref !== 'refs/heads/main') {
    throw new Error('Packed-consumer reuse canary asserts branch main')
  }
  return ref
}

export function readTree(cwd = root, exec = execFileSync) {
  const tree = exec('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim()
  if (!shaPattern.test(tree)) throw new Error('Canary tree is not a full SHA')
  return tree
}

export function canaryInputs({
  tree,
  node = process.version,
  runnerOs = process.env.RUNNER_OS ?? process.platform,
}) {
  return { tree, canary: CANARY_ID, node, runnerOs }
}

export function canaryFingerprint(inputs) {
  return fingerprintInputs(canaryInputs(inputs))
}

export function executedProof({
  repository,
  runId,
  runAttempt,
  tree,
  fingerprint,
  completedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    kind: 'executed',
    repository,
    runId: Number(runId),
    runAttempt: Number(runAttempt),
    tree,
    fingerprint,
    inputDigests: {
      tree: fingerprintInputs(tree),
      canary: fingerprintInputs(CANARY_ID),
    },
    completedAt,
  }
}

export function writeExecutedProof(proof, directory = defaultProofDirectory) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'proof.json')
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`)
  return path
}

export function canaryEnvelope({ repository, sha, runId, runAttempt }) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !shaPattern.test(sha)) {
    throw new Error('Invalid canary repository or commit')
  }
  const id = Number(runId)
  const attempt = Number(runAttempt)
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error('Invalid canary run identity')
  }
  return {
    pulls: [
      {
        number: CANARY_PULL_REQUEST,
        merged_at: '2026-09-24T00:00:00Z',
        merge_commit_sha: sha,
        base: { ref: 'main', repo: { full_name: repository } },
        head: { sha, repo: { full_name: repository } },
      },
    ],
    runs: [
      {
        id,
        run_attempt: attempt,
        head_sha: sha,
        event: 'pull_request',
        path: '.github/workflows/ci.yml',
        head_repository: { full_name: repository },
        status: 'completed',
        conclusion: 'success',
      },
    ],
    jobs: [
      {
        name: 'package / packed-consumer-smoke',
        status: 'completed',
        conclusion: 'success',
        run_attempt: attempt,
      },
    ],
  }
}

function githubRequest({ fetchImpl, token, path }) {
  return fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  })
}

export function createCanaryGithubIo({
  repository,
  sha,
  runId,
  runAttempt,
  token,
  artifacts,
  fetchImpl = fetch,
}) {
  const envelope = canaryEnvelope({ repository, sha, runId, runAttempt })
  const request = async (path) => {
    const response = await githubRequest({ fetchImpl, token, path })
    if (!response.ok) throw new Error(`GitHub proof lookup failed (${response.status})`)
    return response
  }
  return {
    requestJson: async (path) => {
      if (path === `/repos/${repository}/commits/${sha}/pulls`) return envelope.pulls
      if (
        path ===
        `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=10`
      )
        return { workflow_runs: envelope.runs }
      if (
        path ===
        `/repos/${repository}/actions/runs/${envelope.runs[0].id}/attempts/${envelope.runs[0].run_attempt}/jobs?per_page=100`
      )
        return { jobs: envelope.jobs }
      if (
        path === `/repos/${repository}/actions/runs/${envelope.runs[0].id}/artifacts?per_page=100`
      ) {
        if (artifacts !== undefined) return { artifacts }
        return (await request(path)).json()
      }
      throw new Error(`Unexpected canary lookup ${path}`)
    },
    readArtifact: async (id) => {
      const response = await request(`/repos/${repository}/actions/artifacts/${id}/zip`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > 65536) throw new Error('Proof artifact exceeds its size bound')
      const directory = mkdtempSync(join(tmpdir(), 'narduk-canary-proof-'))
      try {
        const archive = join(directory, 'proof.zip')
        writeFileSync(archive, bytes)
        return readProofArchive(archive)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
}

export async function consumeCanary({
  repository,
  sha,
  tree,
  fingerprint,
  inputDigests,
  requestJson,
  readArtifact,
  now = Date.now(),
}) {
  return findReusablePackedConsumerProof({
    repository,
    sha,
    tree,
    fingerprint,
    inputDigests,
    now,
    requestJson,
    readArtifact,
  })
}

export async function waitForCanaryArtifact({
  repository,
  runId,
  runAttempt,
  headSha,
  requestJson,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 30_000,
}) {
  const name = proofArtifactName(runAttempt)
  const deadline = now() + timeoutMs
  for (;;) {
    const { artifacts } = await requestJson(
      `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
    )
    const matches = (artifacts || []).filter(
      (artifact) =>
        artifact.name === name &&
        !artifact.expired &&
        artifact.workflow_run?.id === Number(runId) &&
        artifact.workflow_run?.head_sha === headSha &&
        artifact.size_in_bytes > 0 &&
        artifact.size_in_bytes < 65536 &&
        Number.isSafeInteger(artifact.id),
    )
    if (matches.length > 1) throw new Error(`Canary found duplicate proof artifacts named ${name}`)
    if (matches.length === 1) return matches[0]
    if (now() >= deadline) {
      throw new Error(`Canary proof artifact ${name} did not appear on run ${runId}`)
    }
    await sleep(1000)
  }
}

export async function runPhase(phase, options = {}) {
  if (!canaryPhases.includes(phase)) {
    throw new Error(
      `Usage: node scripts/packed-consumer-reuse-canary.mjs <${canaryPhases.join('|')}>`,
    )
  }
  const {
    environment = process.env,
    log = console.log,
    now = Date.now(),
    githubIo,
    tree: treeOverride,
    node: nodeOverride,
    runnerOs: runnerOsOverride,
    proofDirectory = defaultProofDirectory,
    sleep,
    timeoutMs,
  } = options
  requireMainRef(environment.GITHUB_REF)
  const repository = environment.GITHUB_REPOSITORY
  const sha = environment.GITHUB_SHA
  const runId = Number(environment.GITHUB_RUN_ID)
  const runAttempt = Number(environment.GITHUB_RUN_ATTEMPT)
  const tree = treeOverride ?? readTree()
  const node = nodeOverride ?? process.version
  const runnerOs = runnerOsOverride ?? environment.RUNNER_OS ?? process.platform
  const fingerprint = canaryFingerprint({ tree, node, runnerOs })
  const inputDigests = {
    tree: fingerprintInputs(tree),
    canary: fingerprintInputs(CANARY_ID),
  }
  const started = Date.now()
  const elapsed = () => Date.now() - started

  if (phase === 'produce') {
    const proof = executedProof({
      repository,
      runId,
      runAttempt,
      tree,
      fingerprint,
      completedAt: new Date(now).toISOString(),
    })
    writeExecutedProof(proof, proofDirectory)
    log(freshInstallLog)
    log(
      `[canary] produce ${elapsed()}ms wrote executed proof tree=${tree} fingerprint=${fingerprint}`,
    )
    return { kind: 'executed', tree, fingerprint, proof }
  }

  const production = await lookupConsumerProof({ tree, fingerprint, inputDigests }, environment)
  if (production) {
    throw new Error('lookupConsumerProof must stay closed for the canary dispatch')
  }

  const io =
    githubIo ??
    createCanaryGithubIo({
      repository,
      sha,
      runId,
      runAttempt,
      token: environment.GITHUB_TOKEN,
      artifacts: phase === 'fallback-missing' ? [] : undefined,
    })

  if (phase !== 'fallback-missing') {
    await waitForCanaryArtifact({
      repository,
      runId,
      runAttempt,
      headSha: sha,
      requestJson: io.requestJson,
      ...(sleep ? { sleep } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    })
  }

  const consumeFingerprint =
    phase === 'fallback-changed'
      ? canaryFingerprint({ tree: 'e'.repeat(40), node, runnerOs })
      : fingerprint
  const consumeDigests =
    phase === 'fallback-changed'
      ? { ...inputDigests, tree: fingerprintInputs('changed') }
      : inputDigests

  const prior = await consumeCanary({
    repository,
    sha,
    tree,
    fingerprint: consumeFingerprint,
    inputDigests: consumeDigests,
    requestJson: io.requestJson,
    readArtifact: io.readArtifact,
    now,
  })

  if (phase === 'consume-accepted') {
    if (!prior) throw new Error('Canary expected accepted reuse of the live proof artifact')
    log(reusedLog(prior))
    log(freshInstallLog)
    log(
      `[canary] consume-accepted ${elapsed()}ms reused=true pull=${prior.pullRequest} run=${prior.runId} attempt=${prior.runAttempt}`,
    )
    return { kind: 'reused', prior }
  }

  if (prior) throw new Error(`Canary expected ${phase} to execute the full proof`)
  log(executeLog)
  log(freshInstallLog)
  log(`[canary] ${phase} ${elapsed()}ms reused=false`)
  return { kind: 'executed', prior: undefined }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPhase(process.argv[2], {})
}
