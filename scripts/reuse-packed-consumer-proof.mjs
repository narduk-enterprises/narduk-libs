import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Extends PR #80's same-repository merged-PR lookup. A matching source tree
// alone cannot prove a fresh, externally resolved consumer. The caller first
// packs and installs again, then compares its complete input fingerprint.
export const proofArtifactName = (attempt) => `packed-consumer-proof-${attempt}`
const jobName = 'package / packed-consumer-smoke'
const maximumAge = 7 * 24 * 60 * 60 * 1000
const shaPattern = /^[0-9a-f]{40}$/u
const digestPattern = /^[0-9a-f]{64}$/u

export function fingerprintInputs(inputs) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stable(value[key])]),
      )
    return value
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(inputs)))
    .digest('hex')
}

export function matchesProof(proof, { repository, run, tree, fingerprint, now }) {
  const age = now - Date.parse(proof?.completedAt)
  return (
    proof?.schemaVersion === 1 &&
    proof.kind === 'executed' &&
    proof.repository === repository &&
    proof.runId === run.id &&
    proof.runAttempt === run.run_attempt &&
    proof.tree === tree &&
    shaPattern.test(tree) &&
    digestPattern.test(fingerprint) &&
    proof.fingerprint === fingerprint &&
    age >= 0 &&
    age <= maximumAge
  )
}

export function readProofArchive(archive) {
  // Python is part of both isolated browser images; unzip is not. Read one
  // bounded member in memory without extracting any artifact-controlled path.
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    members = archive.infolist()
    if len(members) != 1 or members[0].filename != "proof.json":
        raise ValueError("Expected one proof.json member")
    if not 0 < members[0].file_size <= 65536:
        raise ValueError("Proof exceeds its size bound")
    with archive.open(members[0]) as proof:
        content = proof.read(65537)
    if len(content) > 65536:
        raise ValueError("Proof exceeds its size bound")
    sys.stdout.buffer.write(content)
`,
        archive,
      ],
      { encoding: 'utf8', maxBuffer: 65536, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  )
}

export async function findReusablePackedConsumerProof({
  repository,
  sha,
  tree,
  fingerprint,
  inputDigests = {},
  baseBranch = 'main',
  requestJson,
  readArtifact,
  now = Date.now(),
}) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !shaPattern.test(sha))
    throw new Error('Invalid proof lookup repository or commit')
  const pulls = await requestJson(`/repos/${repository}/commits/${sha}/pulls`)
  const candidates = pulls.filter(
    (pull) =>
      pull.merged_at &&
      pull.merge_commit_sha === sha &&
      pull.base?.ref === baseBranch &&
      pull.base?.repo?.full_name === repository &&
      pull.head?.repo?.full_name === repository &&
      shaPattern.test(pull.head?.sha || ''),
  )
  for (const pull of candidates.slice(0, 3)) {
    const { workflow_runs: runs } = await requestJson(
      `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=10`,
    )
    // Only the latest attempt of the latest run may prove this PR head. An
    // older success cannot conceal a failed/cancelled rerun on the same head.
    const run = runs
      .filter((item) => item.head_sha === pull.head.sha)
      .sort((left, right) => right.id - left.id)[0]
    if (
      !run ||
      run.event !== 'pull_request' ||
      run.path !== '.github/workflows/ci.yml' ||
      run.head_repository?.full_name !== repository ||
      run.status !== 'completed' ||
      run.conclusion !== 'success' ||
      !Number.isSafeInteger(run.id) ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      continue
    const { jobs } = await requestJson(
      `/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    )
    const gates = jobs.filter((job) => job.name === jobName)
    if (
      gates.length !== 1 ||
      gates[0].status !== 'completed' ||
      gates[0].conclusion !== 'success' ||
      gates[0].run_attempt !== run.run_attempt
    )
      continue
    const { artifacts } = await requestJson(
      `/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
    )
    const matches = artifacts.filter(
      (artifact) =>
        artifact.name === proofArtifactName(run.run_attempt) &&
        !artifact.expired &&
        artifact.workflow_run?.id === run.id &&
        artifact.workflow_run?.head_sha === pull.head.sha &&
        artifact.size_in_bytes > 0 &&
        artifact.size_in_bytes < 65536 &&
        Number.isSafeInteger(artifact.id),
    )
    if (matches.length !== 1) continue
    const proof = await readArtifact(matches[0].id)
    if (matchesProof(proof, { repository, run, tree, fingerprint, now }))
      return { runId: run.id, runAttempt: run.run_attempt, pullRequest: pull.number, fingerprint }
    const changed = Object.keys(inputDigests).filter(
      (key) => proof?.inputDigests?.[key] !== inputDigests[key],
    )
    if (changed.length)
      console.log(
        `[consumer-smoke] Prior proof input differences: ${changed.join(', ')}; executing the full proof.`,
      )
  }
  return undefined
}

export async function lookupConsumerProof(options, environment = process.env) {
  // Local, dispatch and PR runs always execute the proof. This is only an
  // immediate merged-PR -> main reuse, never a cross-PR cache of green checks.
  if (
    environment.GITHUB_EVENT_NAME !== 'push' ||
    environment.GITHUB_REF !== 'refs/heads/main' ||
    !environment.GITHUB_TOKEN ||
    !environment.PLAYWRIGHT_BROWSERS_PATH
  )
    return undefined
  const repository = environment.GITHUB_REPOSITORY
  const signal = AbortSignal.timeout(20_000)
  const request = async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    })
    if (!response.ok) throw new Error(`GitHub proof lookup failed (${response.status})`)
    return response
  }
  try {
    return await findReusablePackedConsumerProof({
      ...options,
      repository,
      sha: environment.GITHUB_SHA,
      requestJson: async (path) => (await request(path)).json(),
      readArtifact: async (id) => {
        const response = await request(`/repos/${repository}/actions/artifacts/${id}/zip`)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > 65536) throw new Error('Proof artifact exceeds its size bound')
        const directory = mkdtempSync(join(tmpdir(), 'narduk-consumer-proof-'))
        try {
          const archive = join(directory, 'proof.zip')
          writeFileSync(archive, bytes)
          return readProofArchive(archive)
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      },
    })
  } catch {
    console.log(
      '[consumer-smoke] Prior proof unavailable or invalid; executing all generated-app gates.',
    )
    return undefined
  }
}

export const fileDigest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
