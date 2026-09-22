import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DevelopmentConfig } from './development-config.js'
import { developmentSystemEnv } from './development-process.js'

const ACTIVE_RUN_STATUSES = [
  'queued',
  'in_progress',
  'waiting',
  'requested',
  'pending',
  'action_required',
] as const
const workflowSchema = z.object({ id: z.number().int(), path: z.string(), state: z.string() })
export interface SavedDevelopmentWorkflow {
  id: number
  path: string
  previousState: string
  desiredState: string
  writes: boolean
  held: boolean
  restored: boolean
}
export type DevelopmentGitHubRequest = (path: string, method?: string) => unknown

/** Management-only route. Ordinary deploy:dev never constructs or calls this client. */
export function developmentGitHubRequest(path: string, method = 'GET'): unknown {
  let output: string
  try {
    output = execFileSync('gh', ['api', '--method', method, path], {
      env: developmentSystemEnv(),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`GitHub ${method} request failed; inspect state before retrying a mutation`)
  }
  if (!output.trim()) return null
  try {
    return JSON.parse(output) as unknown
  } catch {
    throw new Error('GitHub returned an unreadable response')
  }
}

export class DevelopmentGitHub {
  constructor(
    readonly repository: string,
    private readonly request: DevelopmentGitHubRequest = developmentGitHubRequest,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('Invalid GitHub repository')
  }

  private path(suffix: string): string {
    return `repos/${this.repository}/${suffix}`
  }

  private pages(suffix: string, key: string): unknown[] {
    const items: unknown[] = []
    for (let page = 1; page <= 10; page++) {
      const separator = suffix.includes('?') ? '&' : '?'
      const response = z
        .record(z.string(), z.unknown())
        .parse(this.request(this.path(`${suffix}${separator}per_page=100&page=${page}`)))
      const batch = z.array(z.unknown()).parse(response[key])
      items.push(...batch)
      if (batch.length < 100) return items
    }
    throw new Error('GitHub inventory exceeded its bound; enrollment cannot prove completeness')
  }

  workflows(): Array<z.infer<typeof workflowSchema>> {
    return this.pages('actions/workflows', 'workflows').map((item) => workflowSchema.parse(item))
  }

  /** Inventory everything before changing anything; unclassified active paths block enrollment. */
  saveWorkflows(automation: DevelopmentConfig['automation']): SavedDevelopmentWorkflow[] {
    const workflows = this.workflows()
    const preserved = new Set([
      automation.manualValidationWorkflow,
      ...automation.independentWorkflows,
      ...automation.continuingWriters.flatMap((writer) =>
        writer.workflow ? [writer.workflow] : [],
      ),
    ])
    for (const workflow of workflows) {
      if (
        workflow.state === 'active' &&
        !automation.workflows.includes(workflow.path) &&
        !preserved.has(workflow.path)
      )
        throw new Error(`Unclassified active workflow: ${workflow.path}`)
    }
    const manual = workflows.filter((item) => item.path === automation.manualValidationWorkflow)
    if (manual.length !== 1 || manual[0].state !== 'active')
      throw new Error('The explicit validation workflow must be registered and active')
    return automation.workflows.map((path) => {
      const matches = workflows.filter((item) => item.path === path)
      if (matches.length !== 1) throw new Error(`Cannot uniquely resolve held workflow ${path}`)
      const workflow = matches[0]
      if (!['active', 'disabled_manually', 'disabled_inactivity'].includes(workflow.state))
        throw new Error(`Workflow state cannot be held and restored exactly: ${path}`)
      return {
        id: workflow.id,
        path,
        previousState: workflow.state,
        desiredState: automation.retiredWorkflows.includes(path)
          ? 'disabled_manually'
          : workflow.state,
        writes: automation.writeWorkflows.includes(path),
        held: false,
        restored: false,
      }
    })
  }

  inspectWorkflow(saved: SavedDevelopmentWorkflow): z.infer<typeof workflowSchema> {
    const actual = workflowSchema.parse(this.request(this.path(`actions/workflows/${saved.id}`)))
    if (actual.id !== saved.id || actual.path !== saved.path)
      throw new Error('Workflow identity changed during the transition')
    return actual
  }

  holdWorkflow(saved: SavedDevelopmentWorkflow): void {
    if (this.inspectWorkflow(saved).state === 'active')
      this.request(this.path(`actions/workflows/${saved.id}/disable`), 'PUT')
    if (!this.inspectWorkflow(saved).state.startsWith('disabled_'))
      throw new Error(`Workflow hold was not confirmed: ${saved.path}`)
  }

  /** Never cancel a credentialed writer. Caller journals remaining runs and resumes later. */
  settleWorkflows(saved: SavedDevelopmentWorkflow[]): Array<{ id: number; path: string }> {
    const pending: Array<{ id: number; path: string }> = []
    for (const workflow of saved) {
      // Bounded by live work, not history: query only the unfinished statuses.
      const runs = new Map<number, string>()
      for (const status of ACTIVE_RUN_STATUSES) {
        for (const item of this.pages(
          `actions/workflows/${workflow.id}/runs?status=${status}`,
          'workflow_runs',
        )) {
          const run = z.object({ id: z.number().int(), status: z.string() }).parse(item)
          runs.set(run.id, run.status)
        }
      }
      for (const [id, status] of runs) {
        const run = { id, status }
        if (run.status === 'completed') continue
        if (!workflow.writes) this.request(this.path(`actions/runs/${run.id}/cancel`), 'POST')
        pending.push({ id: run.id, path: workflow.path })
      }
    }
    return pending
  }

  restoreWorkflow(saved: SavedDevelopmentWorkflow): void {
    const current = this.inspectWorkflow(saved).state
    if (current !== saved.desiredState) {
      if (saved.desiredState === 'active')
        this.request(this.path(`actions/workflows/${saved.id}/enable`), 'PUT')
      else if (saved.desiredState === 'disabled_manually')
        this.request(this.path(`actions/workflows/${saved.id}/disable`), 'PUT')
      else throw new Error(`Cannot restore changed disabled state exactly: ${saved.path}`)
    }
    if (this.inspectWorkflow(saved).state !== saved.desiredState)
      throw new Error(`Workflow restoration was not confirmed: ${saved.path}`)
  }

  branchHead(branch: string): string {
    return z
      .object({ commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) }) })
      .parse(this.request(this.path(`branches/${encodeURIComponent(branch)}`))).commit.sha
  }

  assertCandidateBranch(branch: string, sha: string): void {
    if (!/^[a-f0-9]{40}$/u.test(sha) || !branch || branch.startsWith('-'))
      throw new Error('Validation requires a branch and full lowercase commit SHA')
    const actual = z
      .object({ commit: z.object({ sha: z.string() }) })
      .parse(this.request(this.path(`branches/${encodeURIComponent(branch)}`)))
    if (actual.commit.sha !== sha) throw new Error('Candidate branch moved; select it again')
  }

  /** This deliberate push is the validation request, not an ordinary backup push. */
  requestValidation(
    cwd: string,
    branch: string,
    sha: string,
    reason: string,
    beforePush: (request: {
      branch: string
      sha: string
      reason: string
      validationRef: string
    }) => void,
  ): string {
    if (!reason.trim()) throw new Error('An explicit validation reason is required')
    const env = developmentSystemEnv()
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim()
    if (
      ![
        `git@github.com:${this.repository}.git`,
        `git@github.com:${this.repository}`,
        `https://github.com/${this.repository}.git`,
        `https://github.com/${this.repository}`,
        `ssh://git@github.com/${this.repository}.git`,
      ].includes(origin)
    )
      throw new Error('The origin remote does not match the approved repository')
    this.assertCandidateBranch(branch, sha)
    const validationRef = `narduk-validation/${sha}/${randomUUID()}`
    beforePush({ branch, sha, reason, validationRef })
    try {
      execFileSync('git', ['push', 'origin', `${sha}:refs/heads/${validationRef}`], {
        cwd,
        env,
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(
        'Validation-ref push was not confirmed; inspect the recorded ref and run before retrying',
      )
    }
    return validationRef
  }

  verifyValidation(
    runId: string,
    sha: string,
    automation: DevelopmentConfig['automation'],
  ): {
    id: number
    sha: string
    url: string
    attempt: number
  } {
    if (!/^\d+$/u.test(runId) || !/^[a-f0-9]{40}$/u.test(sha))
      throw new Error('Release validation requires a run ID and exact commit SHA')
    const run = z
      .object({
        id: z.number().int(),
        head_sha: z.string(),
        head_branch: z.string(),
        event: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
        path: z.string(),
        html_url: z.url(),
        run_attempt: z.number().int(),
        repository: z.object({ full_name: z.string() }),
        head_repository: z.object({ full_name: z.string() }),
      })
      .parse(this.request(this.path(`actions/runs/${runId}`)))
    if (
      run.id !== Number(runId) ||
      run.head_sha !== sha ||
      run.event !== 'push' ||
      !run.head_branch.startsWith(`narduk-validation/${sha}/`) ||
      run.status !== 'completed' ||
      run.conclusion !== 'success' ||
      run.path !== automation.manualValidationWorkflow ||
      run.repository.full_name !== this.repository ||
      run.head_repository.full_name !== this.repository
    )
      throw new Error('Run is not successful explicit validation of this exact release candidate')
    const jobs = this.pages(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs').map(
      (item) =>
        z
          .object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })
          .parse(item),
    )
    for (const name of automation.validationRequiredJobs) {
      const matches = jobs.filter((job) => job.name === name)
      if (
        matches.length !== 1 ||
        matches[0].status !== 'completed' ||
        matches[0].conclusion !== 'success'
      )
        throw new Error(`Release validation is missing a successful required stage: ${name}`)
    }
    return { id: run.id, sha, url: run.html_url, attempt: run.run_attempt }
  }
}
