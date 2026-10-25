// npm.nard.uk allowlist gate (narduk-libs; background: @narduk-enterprises/narduk-notify@0.1.0).
//
// The public mirror at npm.nard.uk serves only the packages named in
// `ALLOWLISTED_PACKAGE_NAMES` in narduk-enterprises/package-delivery
// `src/registry-contract.ts`. A new public package that is missing from that
// list is skipped by the sync, and the only symptom used to be `mirror-confirm`
// timing out about 20 minutes into the release-proof run that follows the
// release merge. This gate moves the failure to the pull request.
//
// Why a checked-in mirror (`scripts/npm-mirror-allowlist.json`) and not a live
// read of package-delivery in CI: package-delivery is private, this repository
// is public, and the `contracts` job holds only `contents: read` on this
// repository. Reading the file would take a cross-repository credential in a
// public repository's pull-request CI, and fork and Dependabot runs receive no
// secrets, so failing closed on the read would turn every one of them red.
//
// A mirror alone could be satisfied by appending a name to the JSON without
// touching package-delivery, so `--upstream` closes the loop: it reads
// `registry-contract.ts` through `gh api`, requires the mirror to equal it
// exactly, and fails closed (exit 2) when the read or the parse is inconclusive.
// Run it with the package-delivery change merged, before the mirror edit lands.
//
// Exit codes: 0 pass, 1 a package is missing or the mirror drifted from
// upstream, 2 inconclusive (a read or parse failed; never treated as a pass).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const MIRROR_PATH = join(root, 'scripts', 'npm-mirror-allowlist.json')
export const UPSTREAM_REPOSITORY = 'narduk-enterprises/package-delivery'
export const UPSTREAM_PATH = 'src/registry-contract.ts'
export const EXIT_INCONCLUSIVE = 2

export class InconclusiveError extends Error {}

export function readMirror(path = MIRROR_PATH) {
  let mirror
  try {
    mirror = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new InconclusiveError(`Cannot read the allowlist mirror ${path}: ${error.message}`)
  }
  if (
    typeof mirror.scope !== 'string' ||
    !Array.isArray(mirror.packages) ||
    mirror.packages.length === 0 ||
    mirror.packages.some((name) => typeof name !== 'string')
  ) {
    throw new InconclusiveError(
      `${path} must carry a "scope" string and a non-empty "packages" array of names.`,
    )
  }
  return mirror
}

// Every non-private workspace package, as the full name and the unscoped name
// the allowlist uses. Package directories come from pnpm-workspace.yaml.
export function publicPackages(workspace) {
  return workspace.packages
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ name, relativeDirectory }) => ({ name, relativeDirectory }))
}

export function checkAgainstAllowlist({ packages, scope, allowlisted }) {
  const allowed = new Set(allowlisted)
  const problems = []
  for (const { name, relativeDirectory } of packages) {
    const prefix = `${scope}/`
    if (!name.startsWith(prefix)) {
      problems.push(
        `${name} (${relativeDirectory}) is public but outside the mirrored scope ${scope}; npm.nard.uk can never serve it. Make it private or move it into the scope.`,
      )
      continue
    }
    const short = name.slice(prefix.length)
    if (!allowed.has(short)) {
      problems.push(
        `${name} (${relativeDirectory}) is public but "${short}" is not in ALLOWLISTED_PACKAGE_NAMES, so npm.nard.uk would skip it and release-proof mirror-confirm would time out.`,
      )
    }
  }
  return problems
}

export function parseUpstreamContract(source) {
  const scope = source.match(/export const NPM_SCOPE\s*=\s*"([^"]+)"/u)?.[1]
  if (!scope) throw new InconclusiveError('NPM_SCOPE not found in registry-contract.ts.')
  const body = source.match(
    /export const ALLOWLISTED_PACKAGE_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/u,
  )?.[1]
  if (body === undefined) {
    throw new InconclusiveError('ALLOWLISTED_PACKAGE_NAMES not found in registry-contract.ts.')
  }
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
  const packages = [...withoutComments.matchAll(/"([^"]+)"/gu)].map((match) => match[1])
  if (packages.length === 0) {
    throw new InconclusiveError('ALLOWLISTED_PACKAGE_NAMES parsed to zero names.')
  }
  return { scope, packages }
}

export function compareWithUpstream({ mirror, upstream, upstreamCommit }) {
  const problems = []
  if (mirror.scope !== upstream.scope) {
    problems.push(`Mirror scope ${mirror.scope} differs from upstream NPM_SCOPE ${upstream.scope}.`)
  }
  const local = new Set(mirror.packages)
  const remote = new Set(upstream.packages)
  for (const name of [...remote].sort()) {
    if (!local.has(name)) problems.push(`Upstream lists "${name}"; the mirror does not.`)
  }
  for (const name of [...local].sort()) {
    if (!remote.has(name)) {
      problems.push(
        `The mirror lists "${name}"; package-delivery at ${upstreamCommit.slice(0, 12)} does not.`,
      )
    }
  }
  return problems
}

// Reads registry-contract.ts at the tip of package-delivery's default branch,
// pinned to one commit so the sha and the content cannot disagree.
export function fetchUpstreamViaGh(run = execFileSync) {
  const gh = (args) => run('gh', args, { encoding: 'utf8', timeout: 30_000 })
  try {
    const commit = gh(['api', `repos/${UPSTREAM_REPOSITORY}/commits/main`, '--jq', '.sha']).trim()
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      throw new Error(`unexpected commit id ${JSON.stringify(commit)}`)
    }
    const source = gh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw+json',
      `repos/${UPSTREAM_REPOSITORY}/contents/${UPSTREAM_PATH}?ref=${commit}`,
    ])
    return { commit, source }
  } catch (error) {
    throw new InconclusiveError(
      `Cannot read ${UPSTREAM_REPOSITORY} ${UPSTREAM_PATH} (${String(error.message).split('\n')[0]}). Inconclusive, not a pass.`,
    )
  }
}

export function runCheck({ workspace, mirror, upstreamFetcher }) {
  const packages = publicPackages(workspace)
  const lines = []
  let problems = checkAgainstAllowlist({
    packages,
    scope: mirror.scope,
    allowlisted: mirror.packages,
  })
  if (problems.length > 0) {
    problems.push(
      `Fix: add the package to ALLOWLISTED_PACKAGE_NAMES in ${UPSTREAM_REPOSITORY} ${UPSTREAM_PATH} and merge it, then add it to scripts/npm-mirror-allowlist.json (run "node scripts/check-npm-mirror-allowlist.mjs --upstream" to prove the two match).`,
    )
  } else {
    lines.push(
      `All ${packages.length} public packages are in the npm.nard.uk allowlist mirror (${mirror.packages.length} names).`,
    )
  }
  if (upstreamFetcher) {
    const { commit, source } = upstreamFetcher()
    const drift = compareWithUpstream({
      mirror,
      upstream: parseUpstreamContract(source),
      upstreamCommit: commit,
    })
    if (drift.length === 0) {
      lines.push(`Mirror equals ${UPSTREAM_REPOSITORY} ${UPSTREAM_PATH} at ${commit}.`)
    }
    problems = problems.concat(drift)
  }
  return { ok: problems.length === 0, problems, lines }
}

function main(argv) {
  const unknown = argv.filter((argument) => argument !== '--upstream' && argument !== '--')
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)
  const result = runCheck({
    workspace: loadWorkspace(root),
    mirror: readMirror(),
    upstreamFetcher: argv.includes('--upstream') ? fetchUpstreamViaGh : undefined,
  })
  for (const line of result.lines) process.stdout.write(`${line}\n`)
  for (const problem of result.problems) process.stderr.write(`${problem}\n`)
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = error instanceof InconclusiveError ? EXIT_INCONCLUSIVE : 1
  }
}
