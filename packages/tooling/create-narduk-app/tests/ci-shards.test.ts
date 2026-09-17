import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { buildGeneratedFiles } from '../src/index.js'
import type { AppVisibility } from '../src/types.js'

type Step = {
  name?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
}
type Job = {
  name?: string
  'runs-on': string
  'timeout-minutes': number
  needs?: string | string[]
  if?: string
  env?: Record<string, string>
  strategy?: { matrix: { shard: number[] }; 'max-parallel': number; 'fail-fast': boolean }
  steps: Step[]
}
type Workflow = {
  permissions: Record<string, string>
  concurrency: Record<string, unknown>
  jobs: Record<string, Job>
}

function generated(visibility: AppVisibility) {
  const files = new Map(
    buildGeneratedFiles({ appName: 'ci-fixture', visibility }).map((file) => [
      file.path,
      file.contents,
    ]),
  )
  const source = files.get('.github/workflows/ci.yml')!
  return { files, source, workflow: parse(source) as Workflow }
}

describe('generated CI execution boundary', () => {
  it('public apps use hosted runners and never the private browser image', () => {
    const { source, workflow } = generated('public')
    expect(source).not.toContain('self-hosted')
    expect(source).not.toContain('/opt/playwright-ci')
    for (const job of Object.values(workflow.jobs)) expect(job['runs-on']).toBe('ubuntu-24.04')
  })

  for (const visibility of ['public'] as const) {
    it(`${visibility}: pins actions, bounds jobs, and preserves every test layer`, () => {
      const { workflow, files } = generated(visibility)
      expect(workflow.permissions).toEqual({ contents: 'read' })
      // Cancel superseded pull-request runs only; a push (main) run queues
      // instead, so the commit that merged keeps a completed CI record
      // (buoys#107 parity).
      expect(workflow.concurrency['cancel-in-progress']).toBe(
        "${{ github.event_name == 'pull_request' }}",
      )
      expect(workflow.concurrency.group).toContain('github.repository')
      expect(workflow.concurrency.group).toContain('github.event.pull_request.number')
      for (const job of Object.values(workflow.jobs)) {
        expect(job['timeout-minutes']).toBeGreaterThan(0)
        expect(job['timeout-minutes']).toBeLessThanOrEqual(30)
        for (const step of job.steps) {
          if (step.uses) expect(step.uses).toMatch(/^[\w/-]+@[a-f0-9]{40}$/u)
          if (step.uses?.startsWith('actions/checkout@'))
            expect(step.with?.['persist-credentials']).toBe(false)
        }
      }
      const manifest = JSON.parse(files.get('package.json')!) as { scripts: Record<string, string> }
      expect(manifest.scripts.quality).toBe('pnpm run quality:static && pnpm run test:e2e')
      for (const script of ['format:check', 'lint', 'knip', 'typecheck', 'build', 'test:unit']) {
        expect(manifest.scripts['quality:static']).toContain(`pnpm run ${script}`)
      }
      expect(manifest.scripts['test:unit']).toBe('pnpm --filter web run test:unit')
      expect(manifest.scripts['test:e2e']).toBe('playwright test')
      expect(workflow.jobs.quality.steps.at(-1)?.run).toBe('pnpm run quality:static')
    })

    it(`${visibility}: preserves three shards and diagnostics, including failed runs`, () => {
      const { workflow, files } = generated(visibility)
      const browser = workflow.jobs.browser
      expect(browser.needs).toBe('quality')
      expect(browser.strategy).toEqual({
        'fail-fast': false,
        'max-parallel': 3,
        matrix: { shard: [1, 2, 3] },
      })
      const run = browser.steps.find((step) => step.name === 'Run Chromium shard')!
      expect(run.run).toContain('--shard=${{ matrix.shard }}/3 --workers=1 --reporter=line,blob')
      const upload = browser.steps.find((step) => step.name === 'Upload shard blob report')!
      expect(upload.if).toBe('always()')
      expect(upload.with?.name).toBe(
        'blob-${{ github.run_id }}-${{ github.run_attempt }}-chromium-${{ matrix.shard }}',
      )
      expect(upload.with?.['retention-days']).toBe(1)
      expect(upload.with?.['if-no-files-found']).toBe('error')
      const report = workflow.jobs['browser-report']
      expect(report.needs).toEqual(['quality', 'browser'])
      expect(report.if).toBe("always() && needs.quality.result == 'success'")
      expect(
        report.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))?.with
          ?.pattern,
      ).toBe('blob-${{ github.run_id }}-${{ github.run_attempt }}-chromium-*')
      expect(report.steps.at(-1)?.with?.['retention-days']).toBe(14)
      const config = files.get('playwright.config.ts')!
      expect(config).toContain("screenshot: 'only-on-failure'")
      expect(config).toContain("video: 'retain-on-failure'")
    })

    it(`${visibility}: executes the aggregate against every success/failure/skip/cancellation combination`, () => {
      const required = generated(visibility).workflow.jobs.Required
      expect(required.needs).toEqual(['quality', 'browser', 'browser-report'])
      expect(required.if).toBe('always()')
      for (const quality of ['success', 'failure', 'skipped', 'cancelled']) {
        for (const browser of ['success', 'failure', 'skipped', 'cancelled']) {
          for (const report of ['success', 'failure', 'skipped', 'cancelled']) {
            const result = spawnSync('bash', ['-c', required.steps[0].run!], {
              env: {
                PATH: process.env.PATH,
                QUALITY_RESULT: quality,
                BROWSER_RESULT: browser,
                REPORT_RESULT: report,
              },
            })
            expect(result.status === 0, `${quality}/${browser}/${report}`).toBe(
              [quality, browser, report].every((state) => state === 'success'),
            )
          }
        }
      }
    })
  }
})
