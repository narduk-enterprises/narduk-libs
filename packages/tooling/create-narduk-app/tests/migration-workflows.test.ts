import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildGeneratedFiles } from '../src/index.js'
import { createMigrationWorkflowFiles } from '../src/migration-workflows.js'

describe('D1 workflow trust and failure boundaries', () => {
  it.each(['public', 'private'] as const)(
    'emits valid, inert onboarding YAML for %s apps',
    (visibility) => {
      const files = createMigrationWorkflowFiles(visibility)
      for (const file of files) {
        expect(file.path.startsWith('docs/deployment/')).toBe(true)
        expect(() => parse(file.contents)).not.toThrow()
      }
      const byPath = new Map(files.map((file) => [file.path, parse(file.contents)]))
      const steps = byPath.get('docs/deployment/promote-d1.steps.yml').steps
      // 12.9 runs first and holds no credential (#399).
      expect(steps[0].run).toContain('foundation:check:deployment --checkout ../.. --json')
      expect(steps[0].env).toBeUndefined()
      expect(steps[1].run).toContain('"12.9"')
      expect(steps[1].env).toBeUndefined()
      expect(steps[2].run).toContain('--dry-run')
      // The dry run carries the same gate attestation as the real promote
      // (narduk-libs#400), bound to the verified workflow_run head SHA.
      expect(steps[2].run).toContain('--gate-verified "ci / Required@$VERIFIED_SHA"')
      expect(steps[2].env.VERIFIED_SHA).toBe('${{ github.event.workflow_run.head_sha }}')
      expect(steps[2].env.CLOUDFLARE_API_TOKEN).not.toBe(steps[3].env.CLOUDFLARE_API_TOKEN)
      expect(steps[3].run).toContain('migrate-deployment --target production --sha "$VERIFIED_SHA"')
      expect(steps[3].run).toContain('migrate-deployment --target production --check')
      expect(steps[4].if).toBe('always()')
      const bundle = byPath.get('docs/deployment/ci-d1-bundle.job.yml').jobs['d1-bundle']
      expect(JSON.stringify(bundle)).not.toMatch(/D1_MIGRATE_API_TOKEN|CLOUDFLARE_API_TOKEN/u)
      expect(bundle.steps[0].with.ref).toBe('${{ github.event.pull_request.head.sha }}')
      expect(bundle['runs-on']).toBe('ubuntu-24.04')
      const preview = byPath.get('docs/deployment/preview-d1.yml')
      expect(preview.concurrency['cancel-in-progress']).toBe(false)
      expect(preview.jobs.migrate.steps[0].with.ref).toBe(
        '${{ github.event.repository.default_branch }}',
      )
      const download = preview.jobs.migrate.steps.find((s: { uses?: string }) =>
        s.uses?.startsWith('actions/download-artifact@'),
      )
      expect(download.with['run-id']).toBe('${{ github.event.workflow_run.id }}')
      expect(download.with.name).toContain('workflow_run.run_attempt')
      const migrate = preview.jobs.migrate.steps.find(
        (s: { env?: Record<string, string> }) =>
          s.env?.D1_MIGRATE_API_TOKEN || s.env?.CLOUDFLARE_API_TOKEN,
      )
      expect(migrate.run).toContain('--bundle "$SQL_BUNDLE"')
      expect(migrate.run).toContain('--check')
      expect(preview.jobs.migrate.if).toContain('head_repository.full_name == github.repository')
      expect(preview.jobs.migrate.if).toContain("conclusion == 'success'")
    },
  )
  it('refuses to migrate unless 12.9 passes, whatever the other sub-checks say', () => {
    const steps = parse(
      createMigrationWorkflowFiles('private').find(
        (file) => file.path === 'docs/deployment/promote-d1.steps.yml',
      )!.contents,
    ).steps
    const judge = steps[1].run as string
    const dir = mkdtempSync(join(tmpdir(), 'promote-12-9-'))
    const judgeWith = (report: unknown) => {
      if (report !== undefined)
        writeFileSync(join(dir, 'foundation-deployment.json'), JSON.stringify(report))
      else rmSync(join(dir, 'foundation-deployment.json'), { force: true })
      return spawnSync('bash', ['-euo', 'pipefail', '-c', judge], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: dir },
      })
    }
    const reportWith = (status: string) => ({
      item: {
        checks: [
          { id: '12.4', status: 'unknown', detail: 'preview isolation needs a live read' },
          { id: '12.9', status, detail: '0007_drop.sql drops users.legacy' },
        ],
      },
    })
    try {
      const pass = judgeWith(reportWith('pass'))
      expect(pass.status, pass.stderr).toBe(0)
      for (const status of ['fail', 'unknown', 'not-applicable']) {
        const refused = judgeWith(reportWith(status))
        expect(refused.status).toBe(1)
        expect(refused.stderr).toContain(`12.9 ${status}: 0007_drop.sql drops users.legacy`)
      }
      const missing = judgeWith({ item: { checks: [] } })
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain('12.9 is missing from the report')
      // The producer step tolerates a nonzero exit; a report it never wrote fails here.
      expect(judgeWith(undefined).status).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('adds the templates only for D1 apps', () => {
    const d1 = buildGeneratedFiles({
      name: 'example',
      targetDir: '/tmp/example',
      databaseBackend: 'd1',
    })
    const none = buildGeneratedFiles({
      name: 'example',
      targetDir: '/tmp/example',
      databaseBackend: 'none',
      capabilities: ['seo'],
    })
    expect(d1.some((f) => f.path === 'docs/deployment/preview-d1.yml')).toBe(true)
    expect(none.some((f) => f.path === 'docs/deployment/preview-d1.yml')).toBe(false)
  })
})
