import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CANARY_ID,
  CANARY_PULL_REQUEST,
  canaryEnvelope,
  canaryFingerprint,
  consumeCanary,
  createCanaryGithubIo,
  executeLog,
  executedProof,
  freshInstallLog,
  requireMainRef,
  reusedLog,
  runPhase,
  waitForCanaryArtifact,
  writeExecutedProof,
} from './packed-consumer-reuse-canary.mjs'
import {
  findReusablePackedConsumerProof,
  fingerprintInputs,
  lookupConsumerProof,
  matchesProof,
  proofArtifactName,
} from './reuse-packed-consumer-proof.mjs'

const repository = 'narduk-enterprises/narduk-libs'
const sha = 'a'.repeat(40)
const tree = 'c'.repeat(40)
const runId = 123
const runAttempt = 2
const now = Date.parse('2026-09-24T04:00:00Z')
const fingerprint = canaryFingerprint({ tree, node: 'v24.21.0', runnerOs: 'Linux' })
const proof = executedProof({
  repository,
  runId,
  runAttempt,
  tree,
  fingerprint,
  completedAt: '2026-09-24T03:59:00Z',
})

function environment() {
  return {
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: String(runId),
    GITHUB_RUN_ATTEMPT: String(runAttempt),
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_TOKEN: 'token',
    RUNNER_OS: 'Linux',
  }
}

function artifact() {
  return {
    id: 17,
    name: proofArtifactName(runAttempt),
    expired: false,
    size_in_bytes: 500,
    workflow_run: { id: runId, head_sha: sha },
  }
}

function githubIo({ artifacts = [artifact()], proof: receipt = proof } = {}) {
  const envelope = canaryEnvelope({ repository, sha, runId, runAttempt })
  let reads = 0
  return {
    reads: () => reads,
    requestJson: async (path) => {
      if (path === `/repos/${repository}/commits/${sha}/pulls`) return envelope.pulls
      if (
        path ===
        `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=10`
      )
        return { workflow_runs: envelope.runs }
      if (
        path ===
        `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`
      )
        return { jobs: envelope.jobs }
      if (path === `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`)
        return { artifacts }
      throw new Error(`Unexpected canary lookup ${path}`)
    },
    readArtifact: async (id) => {
      reads += 1
      assert.equal(id, 17)
      return receipt
    },
  }
}

test('the canary asserts main and keeps production lookup closed on dispatch', async () => {
  assert.equal(requireMainRef('refs/heads/main'), 'refs/heads/main')
  assert.throws(
    () => requireMainRef('refs/heads/packed-consumer-reuse-canary-202'),
    /asserts branch/u,
  )
  assert.equal(await lookupConsumerProof({ tree, fingerprint }, environment()), undefined)
  assert.equal(CANARY_ID, 'narduk-libs#202')
  assert.equal(CANARY_PULL_REQUEST, 202)
})

test('a synthetic PR-to-main envelope plus the live artifact name reuses an executed receipt', async () => {
  const envelope = canaryEnvelope({ repository, sha, runId, runAttempt })
  assert.equal(envelope.pulls[0].base.ref, 'main')
  assert.equal(envelope.pulls[0].merge_commit_sha, sha)
  assert.equal(envelope.runs[0].path, '.github/workflows/ci.yml')
  assert.equal(envelope.runs[0].event, 'pull_request')
  assert.equal(envelope.jobs[0].name, 'package / packed-consumer-smoke')
  const io = githubIo()
  assert.deepEqual(
    await consumeCanary({
      repository,
      sha,
      tree,
      fingerprint,
      inputDigests: proof.inputDigests,
      now,
      requestJson: io.requestJson,
      readArtifact: io.readArtifact,
    }),
    { runId, runAttempt, pullRequest: CANARY_PULL_REQUEST, fingerprint },
  )
  assert.equal(io.reads(), 1)
  assert.equal(
    matchesProof(proof, { repository, run: envelope.runs[0], tree, fingerprint, now }),
    true,
  )
})

test('the finder still rejects the canary workflow path and a reused receipt', async () => {
  const io = githubIo()
  const envelope = canaryEnvelope({ repository, sha, runId, runAttempt })
  assert.equal(
    await findReusablePackedConsumerProof({
      repository,
      sha,
      tree,
      fingerprint,
      now,
      requestJson: async (path) => {
        if (
          path ===
          `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=10`
        )
          return {
            workflow_runs: [
              { ...envelope.runs[0], path: '.github/workflows/packed-consumer-reuse-canary.yml' },
            ],
          }
        return io.requestJson(path)
      },
      readArtifact: io.readArtifact,
    }),
    undefined,
  )
  assert.equal(
    await consumeCanary({
      repository,
      sha,
      tree,
      fingerprint,
      now,
      requestJson: io.requestJson,
      readArtifact: async () => ({ ...proof, kind: 'reused' }),
    }),
    undefined,
  )
})

test('produce writes an executed receipt the consumer jobs can accept', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-canary-proof-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const lines = []
  const result = await runPhase('produce', {
    environment: environment(),
    tree,
    node: 'v24.21.0',
    proofDirectory: directory,
    now,
    log: (line) => lines.push(line),
  })
  assert.equal(result.kind, 'executed')
  assert.equal(result.fingerprint, fingerprint)
  const written = JSON.parse(readFileSync(join(directory, 'proof.json'), 'utf8'))
  assert.equal(written.kind, 'executed')
  assert.equal(written.schemaVersion, 1)
  assert.equal(written.fingerprint, fingerprint)
  assert.match(
    lines.join('\n'),
    new RegExp(freshInstallLog.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  )
})

test('consume-accepted reuses the live artifact; missing and changed inputs execute', async () => {
  const acceptedIo = githubIo()
  const acceptedLines = []
  const accepted = await runPhase('consume-accepted', {
    environment: environment(),
    tree,
    node: 'v24.21.0',
    now,
    githubIo: acceptedIo,
    sleep: async () => {},
    log: (line) => acceptedLines.push(line),
  })
  assert.deepEqual(accepted.prior, {
    runId,
    runAttempt,
    pullRequest: CANARY_PULL_REQUEST,
    fingerprint,
  })
  assert.match(
    acceptedLines.join('\n'),
    new RegExp(reusedLog(accepted.prior).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  )
  assert.match(acceptedLines.join('\n'), /Fresh external install remains required/u)

  const missingLines = []
  const missing = await runPhase('fallback-missing', {
    environment: environment(),
    tree,
    node: 'v24.21.0',
    now,
    githubIo: githubIo({ artifacts: [] }),
    log: (line) => missingLines.push(line),
  })
  assert.equal(missing.prior, undefined)
  assert.match(
    missingLines.join('\n'),
    new RegExp(executeLog.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  )

  const changedIo = githubIo()
  const changed = await runPhase('fallback-changed', {
    environment: environment(),
    tree,
    node: 'v24.21.0',
    now,
    githubIo: changedIo,
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(changed.prior, undefined)
  assert.equal(changedIo.reads(), 1)
})

test('live artifact REST is used for the zip; the envelope stays synthetic', async () => {
  const paths = []
  const io = createCanaryGithubIo({
    repository,
    sha,
    runId,
    runAttempt,
    token: 'token',
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      paths.push(`${parsed.pathname}${parsed.search}`)
      if (url.endsWith(`/actions/runs/${runId}/artifacts?per_page=100`)) {
        return {
          ok: true,
          json: async () => ({ artifacts: [artifact()] }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    },
  })
  assert.deepEqual(await io.requestJson(`/repos/${repository}/commits/${sha}/pulls`), [
    canaryEnvelope({ repository, sha, runId, runAttempt }).pulls[0],
  ])
  const listed = await io.requestJson(
    `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
  )
  assert.deepEqual(listed.artifacts, [artifact()])
  assert.deepEqual(paths, [`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`])
  await assert.rejects(() => io.requestJson('/unrelated'), /Unexpected canary lookup/u)
})

test('waitForCanaryArtifact polls until the production artifact name appears', async () => {
  let calls = 0
  const found = await waitForCanaryArtifact({
    repository,
    runId,
    runAttempt,
    headSha: sha,
    now: (() => {
      let tick = 0
      return () => {
        tick += 1
        return tick
      }
    })(),
    timeoutMs: 10,
    sleep: async () => {},
    requestJson: async () => {
      calls += 1
      return { artifacts: calls < 3 ? [] : [artifact()] }
    },
  })
  assert.equal(found.id, 17)
  assert.equal(calls, 3)
})

test('the packed consumer still installs packed artifacts before considering reuse', () => {
  const source = readFileSync(new URL('./release-packages.mjs', import.meta.url), 'utf8')
  const packedInstall = source.indexOf(
    "label: 'install every packed package in an external consumer'",
  )
  const generatedInstall = source.indexOf(
    "label: 'install the generated app from packed artifacts'",
  )
  const frozenInstall = source.indexOf(
    "label: 'repeat generated app install with the frozen lockfile'",
  )
  const proveCall = source.indexOf('await proveGeneratedConsumer(')
  const lookup = source.indexOf('await lookupConsumerProof(')
  assert.ok(
    packedInstall > 0 && proveCall > packedInstall,
    'packed install must run before the generated-app proof',
  )
  assert.ok(
    generatedInstall > 0 && frozenInstall > generatedInstall && lookup > frozenInstall,
    'both generated-app installs must precede reuse lookup',
  )
  assert.match(source, /Resolve and install both external consumers before considering reuse/u)
  const reuse = readFileSync(new URL('./reuse-packed-consumer-proof.mjs', import.meta.url), 'utf8')
  assert.match(reuse, /GITHUB_EVENT_NAME !== 'push'/u)
  assert.match(reuse, /run\.path !== '\.github\/workflows\/ci\.yml'/u)
})

test('writeExecutedProof keeps a single proof.json the upload step can retain', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-canary-write-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = writeExecutedProof(proof, directory)
  assert.equal(path, join(directory, 'proof.json'))
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), proof)
  assert.notEqual(fingerprint, fingerprintInputs({ tree, canary: 'other' }))
})
