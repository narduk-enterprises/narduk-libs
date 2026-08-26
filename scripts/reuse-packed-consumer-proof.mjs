import { appendFileSync } from 'node:fs'

const apiVersion = '2022-11-28'
const packedConsumerCheckName = 'package / packed-consumer-smoke'

function parseRepository(value) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(value)) {
    throw new Error(`Invalid repository name: ${value}`)
  }
  return value
}

function isSameRepositoryMergedPullRequest(pullRequest, { repository, sha, baseBranch }) {
  return (
    pullRequest?.merged_at &&
    pullRequest.merge_commit_sha === sha &&
    pullRequest.base?.ref === baseBranch &&
    pullRequest.head?.repo?.full_name === repository &&
    typeof pullRequest.head?.sha === 'string'
  )
}

function hasSuccessfulPackedConsumerCheck(checkRuns) {
  return checkRuns.some(
    (checkRun) =>
      checkRun.name === packedConsumerCheckName &&
      checkRun.status === 'completed' &&
      checkRun.conclusion === 'success' &&
      checkRun.app?.slug === 'github-actions' &&
      typeof checkRun.details_url === 'string' &&
      checkRun.details_url.includes('/actions/runs/'),
  )
}

export async function findReusablePackedConsumerProof({
  repository,
  sha,
  baseBranch = 'main',
  requestJson,
}) {
  const pullRequests = await requestJson(`/repos/${repository}/commits/${sha}/pulls`)
  const candidates = pullRequests.filter((pullRequest) =>
    isSameRepositoryMergedPullRequest(pullRequest, { repository, sha, baseBranch }),
  )

  if (candidates.length === 0) {
    return {
      reused: false,
      reason: 'no same-repository merged pull request was associated with this push',
    }
  }

  const currentCommit = await requestJson(`/repos/${repository}/git/commits/${sha}`)
  if (typeof currentCommit.tree?.sha !== 'string') {
    throw new Error(`GitHub did not return the tree for ${sha}.`)
  }

  for (const pullRequest of candidates) {
    const sourceSha = pullRequest.head.sha
    const sourceCommit = await requestJson(`/repos/${repository}/git/commits/${sourceSha}`)
    if (sourceCommit.tree?.sha !== currentCommit.tree.sha) continue

    const checks = await requestJson(
      `/repos/${repository}/commits/${sourceSha}/check-runs?check_name=${encodeURIComponent(packedConsumerCheckName)}&per_page=100`,
    )
    if (!hasSuccessfulPackedConsumerCheck(checks.check_runs || [])) continue

    return {
      reused: true,
      pullRequest: pullRequest.number,
      sourceSha,
      treeSha: currentCommit.tree.sha,
      reason:
        'the merged pull-request head has the identical Git tree and a successful packed consumer check',
    }
  }

  return {
    reused: false,
    reason:
      'no associated pull-request head had both an identical Git tree and a successful packed consumer check',
  }
}

function createRequestJson({ token, apiUrl, fetchImplementation = fetch }) {
  return async (path) => {
    const response = await fetchImplementation(`${apiUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': apiVersion,
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status} for ${path}.`)
    }
    return response.json()
  }
}

function appendOutputs(path, result) {
  appendFileSync(
    path,
    [
      `reused=${result.reused}`,
      `pull-request=${result.pullRequest || ''}`,
      `source-sha=${result.sourceSha || ''}`,
      '',
    ].join('\n'),
  )
}

function appendSummary(path, result) {
  const source = result.reused
    ? `PR #${result.pullRequest} at \`${result.sourceSha}\``
    : 'No prior proof was reused'
  appendFileSync(
    path,
    [
      '',
      '## Packed consumer proof reuse',
      '',
      `**Result:** ${result.reused ? 'reused' : 'run on this SHA'}`,
      '',
      `**Source:** ${source}`,
      '',
      `**Reason:** ${result.reason}`,
      '',
    ].join('\n'),
  )
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = argv[index + 1]
    if (
      ['--repository', '--sha', '--base-branch', '--github-output', '--summary'].includes(argument)
    ) {
      if (!next) throw new Error(`${argument} requires a value.`)
      const key = {
        '--repository': 'repository',
        '--sha': 'sha',
        '--base-branch': 'baseBranch',
        '--github-output': 'githubOutput',
        '--summary': 'summary',
      }[argument]
      options[key] = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const repository = parseRepository(options.repository || '')
  if (!/^[0-9a-f]{40}$/u.test(options.sha || '')) throw new Error('--sha must be a full Git SHA.')
  if (!options.githubOutput) throw new Error('--github-output is required.')
  if (!options.summary) throw new Error('--summary is required.')

  const token = process.env.GITHUB_TOKEN
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
  let result
  if (!token) {
    result = {
      reused: false,
      reason:
        'GITHUB_TOKEN was unavailable, so the exact-SHA packed consumer gate remains required',
    }
  } else {
    try {
      result = await findReusablePackedConsumerProof({
        repository,
        sha: options.sha,
        baseBranch: options.baseBranch || 'main',
        requestJson: createRequestJson({ token, apiUrl }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = {
        reused: false,
        reason: `prior proof could not be verified (${message}); the exact-SHA packed consumer gate remains required`,
      }
    }
  }

  appendOutputs(options.githubOutput, result)
  appendSummary(options.summary, result)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
