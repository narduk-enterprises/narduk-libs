import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildGeneratedFiles } from '../src/index.js'

/**
 * Runs the `gate` job and the promote invocation the generated
 * `docs/workers-builds.md` hands every app for its `promote.yml`, against a
 * `gh` stand-in, so the one-click recovery from a duplicate upload
 * (narduk-libs#1233) is proven to keep every gate rather than only read as if
 * it does.
 */

interface RunbookWorkflow {
  on: { workflow_dispatch: { inputs: Record<string, { required: boolean }> } }
  jobs: {
    gate: {
      outputs: Record<string, string>
      steps: Array<{ id: string; env: Record<string, string>; run: string }>
    }
    promote: { env: Record<string, string>; steps: Array<{ id?: string; run: string }> }
  }
}

function runbookWorkflow(): RunbookWorkflow {
  const files = buildGeneratedFiles({
    appName: 'promote-runbook',
    localPort: 4390,
    targetDir: '/tmp/promote-runbook',
  })
  const runbook = files.find((file) => file.path === 'docs/workers-builds.md')?.contents ?? ''
  const block = /```yaml\n(# \.github\/workflows\/promote\.yml \(excerpt\)\n[\s\S]*?)```/u.exec(
    runbook,
  )
  expect(block, 'the runbook shows the promote.yml excerpt').not.toBeNull()
  return parse(block?.[1] ?? '') as RunbookWorkflow
}

const HEAD = 'f736b07d7f49a1b2c3d4e5f60718293a4b5c6d7e'
const OLDER = '0123456789abcdef0123456789abcdef01234567'
const VERSION = '60472572-1b2c-4d3e-8f90-a1b2c3d4e5f6'
const REPO = 'narduk-enterprises/promote-runbook'
const SUITE = 1

/**
 * Answers `commits/main`, main's own CI runs for the head and the head's
 * check-runs; applies `--jq` with jq.
 */
const FAKE_GH = `#!/bin/bash
path=''
jq_expr=''
while [ $# -gt 0 ]; do
  case "$1" in
    api) shift ;;
    --jq) jq_expr="$2"; shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
dir="$(dirname "$0")"
case "$path" in
  repos/*/commits/main) key=head ;;
  repos/*/actions/workflows/ci.yml/runs\\?head_sha=*) key=runs ;;
  repos/*/commits/*/check-runs\\?check_name=ci%20%2F%20Required*) key=checks ;;
  *) echo "unexpected gh api $path" >&2; exit 2 ;;
esac
jq -r "$jq_expr" "$dir/$key.json"
`

function checkRuns(conclusion: string | null) {
  return {
    check_runs: [
      {
        app: { slug: 'github-actions' },
        check_suite: { id: SUITE },
        completed_at: conclusion ? '2026-09-28T07:20:00Z' : null,
        conclusion,
        id: 10,
        status: conclusion ? 'completed' : 'queued',
      },
    ],
  }
}

async function runGate(options: {
  startedFor: string
  versionId: string
  conclusion: string | null
}): Promise<{ status: number | null; stdout: string; outputs: Record<string, string> }> {
  const gate = runbookWorkflow().jobs.gate.steps[0]
  const directory = await mkdtemp(join(tmpdir(), 'promote-gate-'))
  try {
    await writeFile(join(directory, 'gh'), FAKE_GH)
    await chmod(join(directory, 'gh'), 0o755)
    await writeFile(join(directory, 'head.json'), JSON.stringify({ sha: HEAD }))
    await writeFile(join(directory, 'checks.json'), JSON.stringify(checkRuns(options.conclusion)))
    // The head's own push run on main, whose check suite the gate reads.
    await writeFile(
      join(directory, 'runs.json'),
      JSON.stringify({
        workflow_runs: [
          {
            check_suite_id: SUITE,
            event: 'push',
            head_branch: 'main',
            head_repository: { full_name: REPO },
          },
        ],
      }),
    )
    const output = join(directory, 'github-output')
    await writeFile(output, '')
    await writeFile(join(directory, 'gate.sh'), gate.run)
    const result = spawnSync('bash', [join(directory, 'gate.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: output,
        REPO,
        STARTED_FOR: options.startedFor,
        VERSION_ID: options.versionId,
      },
    })
    const outputs = Object.fromEntries(
      (await readFile(output, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('=', 2) as [string, string]),
    )
    return { status: result.status, stdout: result.stdout + result.stderr, outputs }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('promote.yml runbook: one-click duplicate-upload recovery (narduk-libs#1233)', () => {
  it('has the real jq the fake gh applies --jq with', () => {
    expect(spawnSync('jq', ['--version']).status, 'install jq to run these tests').toBe(0)
  })

  it('takes an optional version-id beside the required verified-sha', () => {
    const workflow = runbookWorkflow()
    const inputs = workflow.on.workflow_dispatch.inputs
    expect(inputs['verified-sha'].required).toBe(true)
    // ci.yml's promote-dispatch sends only verified-sha; a required
    // version-id would make GitHub reject that dispatch.
    expect(inputs['version-id'].required).toBe(false)
    expect(workflow.jobs.gate.steps[0].env.VERSION_ID).toBe('${{ inputs.version-id }}')
    expect(workflow.jobs.gate.outputs.version_id).toBe('${{ steps.gate.outputs.version_id }}')
    expect(workflow.jobs.promote.env.VERSION_ID).toBe('${{ needs.gate.outputs.version_id }}')
  })

  it('admits a recovery for main head with a passing ci / Required', async () => {
    const result = await runGate({ startedFor: HEAD, versionId: VERSION, conclusion: 'success' })
    expect(result.status, result.stdout).toBe(0)
    expect(result.outputs).toEqual({ sha: HEAD, version_id: VERSION })
  })

  it('fails a recovery for a commit that is no longer main head', async () => {
    const result = await runGate({ startedFor: OLDER, versionId: VERSION, conclusion: 'success' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`::error::verified-sha ${OLDER} is not main's head ${HEAD}`)
    expect(result.outputs).toEqual({})
  })

  it.each([['failure'], [null]])(
    'fails a recovery when ci / Required on the head concluded %s',
    async (conclusion) => {
      const result = await runGate({ startedFor: HEAD, versionId: VERSION, conclusion })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('::error::the latest ci / Required')
      expect(result.outputs).toEqual({})
    },
  )

  it('fails a version-id that is not a Worker version id', async () => {
    const result = await runGate({
      startedFor: HEAD,
      versionId: 'v1; echo pwned',
      conclusion: 'success',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('is not a Worker version id')
    expect(result.stdout).not.toContain('pwned\n')
    expect(result.outputs).toEqual({})
  })

  it('leaves the ordinary paths as they were', async () => {
    const passed = await runGate({ startedFor: OLDER, versionId: '', conclusion: 'success' })
    expect(passed.status, passed.stdout).toBe(0)
    expect(passed.outputs).toEqual({ sha: HEAD })

    const pending = await runGate({ startedFor: HEAD, versionId: '', conclusion: null })
    expect(pending.status).toBe(0)
    expect(pending.stdout).toContain('::notice::main is at')
    expect(pending.outputs).toEqual({})
  })

  it('passes --version-id to versions-promote beside --sha, and only when chosen', () => {
    const promote = runbookWorkflow().jobs.promote.steps.find((step) => step.id === 'promote')
    const argv = (versionId: string): string[] => {
      const result = spawnSync(
        'bash',
        ['-c', `narduk-app() { printf '%s\\n' "$@"; }\n${promote?.run ?? ''}`],
        {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, VERIFIED_SHA: HEAD, VERSION_ID: versionId },
        },
      )
      return result.stdout.split('\n').filter(Boolean)
    }
    expect(argv(VERSION)).toEqual([
      'deploy',
      'versions-promote',
      '--sha',
      HEAD,
      '--version-id',
      VERSION,
      '--gate-verified',
      `ci / Required@${HEAD}`,
      '--production-branch',
      'main',
      '--json',
    ])
    expect(argv('')).not.toContain('--version-id')
    expect(argv('')).toContain(HEAD)
  })
})
