/**
 * company-hq NAC-GATE-PARITY (§3.11): "`create-narduk-app` and its `upgrade`
 * path emit the complete repository gate -- every repository-stage command in
 * §3.0 wired into the app's own CI". This file is the emitted-CI half: for
 * each visibility it resolves every repository-stage command of §3.0 to the
 * exact CI construct that runs it, and it executes the two emitted scripts
 * that judge something -- the public item-10 probe and the promote gate --
 * against stand-ins, so their verdicts are proven rather than read.
 *
 * The one repository-stage command a generated app's own CI does not run is
 * named here, with its reason, so it cannot disappear silently or be added
 * back without the spec change it needs: `foundation:check` (items 1-7) in a
 * PUBLIC app, whose sub-check 5.1 is UNKNOWN in the app's own CI by
 * specification.
 */

import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  CANDIDATE_SECURITY_HEADERS_STEP_NAME,
  createPromoteGateScript,
  PRIVATE_EXTRA_SCRIPTS,
  publicRepositoryGateSteps,
  REPOSITORY_GATE_STEP_NAME,
} from '../src/ci-workflow.js'
import { buildGeneratedFiles } from '../src/index.js'
import { REPOSITORY_GATE_SCRIPTS } from '../src/ownership.js'
import type { AppVisibility } from '../src/types.js'

interface Step {
  name?: string
  run?: string
  env?: Record<string, string | number>
}
interface Job {
  needs?: string | string[]
  with?: Record<string, string | number | boolean>
  steps?: Step[]
}
interface Workflow {
  jobs: Record<string, Job>
}

function generated(visibility: AppVisibility, databaseBackend: 'd1' | 'none' = 'd1') {
  const files = new Map(
    buildGeneratedFiles({ appName: 'gate-fixture', databaseBackend, visibility }).map((file) => [
      file.path,
      file.contents,
    ]),
  )
  const manifest = JSON.parse(files.get('package.json')!) as { scripts: Record<string, string> }
  const web = JSON.parse(files.get('apps/web/package.json')!) as {
    scripts: Record<string, string>
  }
  return {
    ci: parse(files.get('.github/workflows/ci.yml')!) as Workflow,
    ciText: files.get('.github/workflows/ci.yml')!,
    files,
    scripts: manifest.scripts,
    webScripts: web.scripts,
  }
}

/**
 * The `narduk-app` subcommand a root script finally runs, following the one
 * delegation shape the generator uses (`pnpm --filter web run <name>`).
 */
function checkerCommand(
  scripts: Record<string, string>,
  webScripts: Record<string, string>,
  name: string,
): string | null {
  const body = scripts[name]
  if (!body) return null
  const delegate = /^pnpm --filter web run ([\w:-]+)$/u.exec(body)
  const resolved = delegate ? webScripts[delegate[1]!] : body
  return /narduk-app (foundation:check(?::[\w-]+)?)\b/u.exec(resolved ?? '')?.[1] ?? null
}

/** company-hq NAC §3.0, repository stage: id, command, and the item's checker. */
const REPOSITORY_STAGE = [
  { id: 'NAC-FOUNDATION', script: 'foundation:check', checker: 'foundation:check' },
  {
    id: 'NAC-SHARED-UI',
    script: 'foundation:shared-ui-pinned',
    checker: 'foundation:check:shared-ui-pinned',
  },
  {
    id: 'NAC-CAPABILITY',
    script: 'foundation:check:coverage',
    checker: 'foundation:check:coverage',
  },
  {
    id: 'NAC-TOOLCHAIN',
    script: 'foundation:check:toolchain',
    checker: 'foundation:check:toolchain',
  },
  {
    id: 'NAC-DEPLOY-CONFORM',
    script: 'foundation:check:deployment',
    checker: 'foundation:check:deployment',
  },
] as const

describe('every repository-stage command of NAC §3.0 is wired into the emitted CI', () => {
  it('the gate script names are exactly the §3.0 commands CI runs by name', () => {
    expect([...REPOSITORY_GATE_SCRIPTS]).toEqual(
      REPOSITORY_STAGE.filter((row) => row.id !== 'NAC-FOUNDATION').map((row) => row.script),
    )
  })

  it.each(['private', 'public'] as const)(
    '%s: every gate script exists and runs its own checker',
    (visibility) => {
      const { scripts, webScripts } = generated(visibility)
      for (const row of REPOSITORY_STAGE) {
        expect(checkerCommand(scripts, webScripts, row.script), row.id).toBe(row.checker)
      }
    },
  )

  describe('private', () => {
    const { ci } = generated('private')
    const inputs = ci.jobs.ci!.with!

    it('items 1-7: the shared workflow runs foundation:check', () => {
      expect(inputs['foundation-check']).toBe(true)
    })

    it('items 8, 9, 11 and 12: named in extra-scripts, after the static checks', () => {
      const names = String(inputs['extra-scripts']).split(' ')
      expect(names).toEqual([...PRIVATE_EXTRA_SCRIPTS])
      for (const script of REPOSITORY_GATE_SCRIPTS) expect(names).toContain(script)
      expect(inputs['require-scripts']).toBe(true)
    })

    it("item 10: quality-level standard probes the pull request's preview, with no way out", () => {
      expect(inputs['quality-level']).toBe('standard')
      expect(inputs['preview-checks']).toBeUndefined()
      expect(inputs['quality-opt-out']).toBeUndefined()
    })
  })

  describe('public', () => {
    const { ci, ciText } = generated('public')
    const steps = ci.jobs.quality!.steps!
    const names = steps.map((step) => step.name ?? step.run)

    it('items 8, 9, 11 and 12: one step runs each script, after the build', () => {
      const gate = steps.find((step) => step.name === REPOSITORY_GATE_STEP_NAME)!
      expect(gate.run!.split('\n').filter((line) => line.startsWith('pnpm run '))).toEqual(
        REPOSITORY_GATE_SCRIPTS.map((script) => `pnpm run ${script}`),
      )
      expect(gate.run).toContain('set -euo pipefail')
      expect(names.indexOf(REPOSITORY_GATE_STEP_NAME)).toBeGreaterThan(
        names.indexOf('pnpm run quality:static'),
      )
    })

    it("item 10: probes this commit's built Worker on 127.0.0.1, never production", () => {
      const probe = steps.find((step) => step.name === CANDIDATE_SECURITY_HEADERS_STEP_NAME)!
      expect(names.indexOf(CANDIDATE_SECURITY_HEADERS_STEP_NAME)).toBeGreaterThan(
        names.indexOf('pnpm run quality:static'),
      )
      expect(probe.run).toContain('pnpm exec narduk-app e2e-serve "$CANDIDATE_PORT"')
      expect(probe.run).toContain(
        'pnpm exec narduk-app foundation:check:security-headers --base-url "http://127.0.0.1:$CANDIDATE_PORT"',
      )
      expect(probe.run).not.toMatch(/https:\/\//u)
    })

    it('both steps sit in the job ci / Required requires', () => {
      expect(ci.jobs.Required!.needs).toContain('quality')
    })

    it('items 1-7 are the one command it does not run, and the file says why', () => {
      expect(ciText).not.toContain('pnpm run foundation:check\n')
      expect(ciText).toContain('foundation:check sub-check')
      expect(ciText).toContain('WEB-FOUNDATION-CHECK.md item 5')
    })
  })
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function scratch(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = spawn(process.execPath, [
      '-e',
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})",
    ])
    let out = ''
    probe.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    probe.on('close', () => (out.trim() ? resolvePort(Number(out.trim())) : reject(new Error(out))))
  })
}

describe("the public item-10 step, executed against stand-ins for narduk-app's commands", () => {
  const probeRun = (): string => {
    const lines = publicRepositoryGateSteps()
    const start = lines.findIndex((line) => line.includes(CANDIDATE_SECURITY_HEADERS_STEP_NAME))
    const parsed = parse(lines.slice(start).join('\n')) as Step[]
    return parsed[0]!.run!
  }

  /**
   * `pnpm exec narduk-app e2e-serve <port>` starts a server answering
   * /api/health (or exits at once), and `... foundation:check:security-headers`
   * records its arguments and exits with CHECK_RC.
   */
  const FAKE_PNPM = `#!/bin/bash
[ "$1" = exec ] && [ "$2" = narduk-app ] || { echo "unexpected pnpm $*" >&2; exit 90; }
case "$3" in
  e2e-serve)
    [ "$SERVE_MODE" = dead ] && { echo "worker failed to start" >&2; exit 1; }
    exec node -e "require('http').createServer((q,r)=>{r.writeHead(q.url==='/api/health'?200:404);r.end('ok')}).listen(Number(process.argv[1]),'127.0.0.1')" "$4" ;;
  foundation:check:security-headers)
    shift 3
    printf '%s\\n' "$@" > "$CHECK_ARGS"
    exit "\${CHECK_RC:-0}" ;;
  *) echo "unexpected narduk-app $3" >&2; exit 91 ;;
esac
`

  async function runProbe(env: Record<string, string>) {
    const directory = await scratch('item10-')
    await writeFile(join(directory, 'pnpm'), FAKE_PNPM)
    await chmod(join(directory, 'pnpm'), 0o755)
    await writeFile(join(directory, 'step.sh'), probeRun())
    const port = await freePort()
    const checkArgs = join(directory, 'check-args')
    const result = spawnSync('bash', ['-e', join(directory, 'step.sh')], {
      encoding: 'utf8',
      env: {
        CANDIDATE_PORT: String(port),
        CHECK_ARGS: checkArgs,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        ...env,
      },
      timeout: 30_000,
    })
    const args = await readFile(checkArgs, 'utf8').catch(() => null)
    return { args, port, result }
  }

  it('has curl, which the step polls the Worker with', () => {
    expect(spawnSync('curl', ['--version']).status, 'install curl to run these tests').toBe(0)
  })

  it('passes when the Worker answers and the published checker passes', async () => {
    const { args, port, result } = await runProbe({ CHECK_RC: '0' })
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(args).toBe(`--base-url\nhttp://127.0.0.1:${port}\n`)
  })

  it.each([
    ['FAIL', '1'],
    ['UNKNOWN', '2'],
  ])('fails when the checker reports %s', async (_label, rc) => {
    const { args, result } = await runProbe({ CHECK_RC: rc })
    expect(result.status).not.toBe(0)
    expect(args).not.toBeNull()
  })

  it('fails without probing when the Worker never answers', async () => {
    const { args, result } = await runProbe({ SERVE_MODE: 'dead' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::The built Worker never answered /api/health')
    expect(result.stdout).toContain('worker failed to start')
    expect(args).toBeNull()
  })
})

describe('the promote gate, executed against a stand-in gh', () => {
  const REPO = 'narduk-enterprises/gate-fixture'
  const HEAD = 'a'.repeat(40)

  /** Answers the three reads the gate makes, applying --jq with the real jq. */
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
  repos/*/actions/workflows/ci.yml/runs*) key=runs ;;
  repos/*/commits/*/check-runs*) key=checks ;;
  *) echo "unexpected gh api $path" >&2; exit 2 ;;
esac
[ -f "$dir/$key.fail" ] && { echo "gh: HTTP 502" >&2; exit 1; }
jq -r "$jq_expr" "$dir/$key.json"
`

  interface Run {
    event: string
    suite: number
    repo?: string
    branch?: string
  }
  interface Check {
    id: number
    suite: number
    conclusion: string | null
    status?: string
    app?: string
  }

  async function runGate(options: {
    head?: string
    runs: Run[]
    checks: Check[]
    failRuns?: boolean
  }) {
    const directory = await scratch('promote-gate-')
    await writeFile(join(directory, 'gh'), FAKE_GH)
    await chmod(join(directory, 'gh'), 0o755)
    await writeFile(join(directory, 'head.json'), JSON.stringify({ sha: options.head ?? HEAD }))
    await writeFile(
      join(directory, 'runs.json'),
      JSON.stringify({
        workflow_runs: options.runs.map((run) => ({
          check_suite_id: run.suite,
          event: run.event,
          head_branch: run.branch ?? 'main',
          head_repository: { full_name: run.repo ?? REPO },
        })),
      }),
    )
    if (options.failRuns) await writeFile(join(directory, 'runs.fail'), '')
    await writeFile(
      join(directory, 'checks.json'),
      JSON.stringify({
        check_runs: options.checks.map((check) => ({
          app: { slug: check.app ?? 'github-actions' },
          check_suite: { id: check.suite },
          completed_at: check.conclusion === null ? null : '2026-09-28T10:00:00Z',
          conclusion: check.conclusion,
          id: check.id,
          status: check.status ?? (check.conclusion === null ? 'queued' : 'completed'),
        })),
      }),
    )
    await writeFile(join(directory, 'gate.sh'), createPromoteGateScript())
    const output = join(directory, 'output')
    await writeFile(output, '')
    const result = spawnSync('bash', [join(directory, 'gate.sh')], {
      encoding: 'utf8',
      env: {
        GITHUB_OUTPUT: output,
        PATH: `${directory}:${process.env.PATH}`,
        REPO,
        STARTED_FOR: HEAD,
      },
    })
    return { output: await readFile(output, 'utf8'), result }
  }

  it('has the real jq the stand-in applies --jq with', () => {
    expect(spawnSync('jq', ['--version']).status, 'install jq to run these tests').toBe(0)
  })

  it('promotes the head when ci / Required passed in a push run of main', async () => {
    const { output, result } = await runGate({
      checks: [{ conclusion: 'success', id: 10, suite: 1 }],
      runs: [{ event: 'push', suite: 1 }],
    })
    expect(result.status, result.stderr).toBe(0)
    expect(output).toBe(`sha=${HEAD}\n`)
  })

  it("promotes on a dispatched main run (dependabot-merge.yml's path)", async () => {
    const { output } = await runGate({
      checks: [{ conclusion: 'success', id: 10, suite: 2 }],
      runs: [{ event: 'workflow_dispatch', suite: 2 }],
    })
    expect(output).toBe(`sha=${HEAD}\n`)
  })

  it.each<[string, Run[], Check[]]>([
    [
      "a pull request's green Required on the same commit",
      [
        { event: 'pull_request', suite: 3 },
        { event: 'push', suite: 1 },
      ],
      [
        { conclusion: 'success', id: 30, suite: 3 },
        { conclusion: 'failure', id: 10, suite: 1 },
      ],
    ],
    [
      "a fork's run on a branch named main",
      [{ event: 'push', repo: 'someone/gate-fixture', suite: 4 }],
      [{ conclusion: 'success', id: 40, suite: 4 }],
    ],
    [
      'a run on another branch',
      [{ branch: 'feature', event: 'push', suite: 5 }],
      [{ conclusion: 'success', id: 50, suite: 5 }],
    ],
    [
      'a newer same-suite re-run still queued',
      [{ event: 'push', suite: 1 }],
      [
        { conclusion: 'success', id: 10, suite: 1 },
        { conclusion: null, id: 11, suite: 1 },
      ],
    ],
    [
      'a newer same-suite re-run in progress, listed first',
      [{ event: 'push', suite: 1 }],
      [
        { conclusion: null, id: 11, status: 'in_progress', suite: 1 },
        { conclusion: 'success', id: 10, suite: 1 },
      ],
    ],
    [
      'a newer same-suite attempt that failed',
      [{ event: 'push', suite: 1 }],
      [
        { conclusion: 'success', id: 10, suite: 1 },
        { conclusion: 'failure', id: 12, suite: 1 },
      ],
    ],
    [
      'a same-named check from another app',
      [{ event: 'push', suite: 1 }],
      [{ app: 'some-other-app', conclusion: 'success', id: 10, suite: 1 }],
    ],
    ['no main CI run for the head yet', [], []],
  ])('does not promote on %s', async (_label, runs, checks) => {
    const { output, result } = await runGate({ checks, runs })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('::notice::')
    expect(output).toBe('')
  })

  it('refuses a malformed head SHA', async () => {
    const { output, result } = await runGate({
      checks: [{ conclusion: 'success', id: 10, suite: 1 }],
      head: 'not-a-sha',
      runs: [{ event: 'push', suite: 1 }],
    })
    expect(result.status).toBe(1)
    expect(output).toBe('')
  })

  it('fails, rather than skipping, when the runs cannot be read', async () => {
    const { output, result } = await runGate({
      checks: [{ conclusion: 'success', id: 10, suite: 1 }],
      failRuns: true,
      runs: [{ event: 'push', suite: 1 }],
    })
    expect(result.status).not.toBe(0)
    expect(output).toBe('')
  })

  it('is the gate the generated runbook shows, verbatim', () => {
    const runbook = generated('private').files.get('docs/workers-builds.md')!
    for (const line of createPromoteGateScript().trimEnd().split('\n')) {
      expect(runbook).toContain('          ' + line)
    }
  })
})
