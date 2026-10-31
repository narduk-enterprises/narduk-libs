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
      // narduk-libs#1375: a superseded commit skips with exit 0, so the D1
      // migration for it must not run. The dry run's id is what the guard reads.
      expect(steps[2].id).toBe('eligible')
      expect(steps[3].if).toBe("steps.eligible.outputs.superseded != 'true'")
      // The dry run carries the same gate attestation as the real promote
      // (narduk-libs#400), bound to the SHA the gate job verified -- never
      // workflow_run.head_sha, which is empty on a dispatch and can be older
      // than the head the gate promotes.
      expect(steps[2].run).toContain('--gate-verified "ci / Required@$VERIFIED_SHA"')
      expect(steps[2].env.VERIFIED_SHA).toBe('${{ needs.gate.outputs.sha }}')
      // narduk-libs#1233: a recovery dispatch's chosen version reaches the dry
      // run too, or the duplicate upload would stop the recovery before D1.
      expect(steps[2].env.VERSION_ID).toBe('${{ needs.gate.outputs.version_id }}')
      expect(steps[2].run).toContain('${VERSION_ID:+--version-id "$VERSION_ID"}')
      expect(steps[3].env.VERIFIED_SHA).toBe('${{ needs.gate.outputs.sha }}')
      expect(JSON.stringify(steps)).not.toContain('workflow_run.head_sha')
      const promoteSteps = files.find((file) => file.path.endsWith('promote-d1.steps.yml'))!
      expect(promoteSteps.contents).not.toContain('workflow_run.head_sha }}')
      expect(promoteSteps.contents).toContain('rollback.mode is manual: nothing rolls')
      expect(steps[2].env.CLOUDFLARE_API_TOKEN).not.toBe(steps[3].env.CLOUDFLARE_API_TOKEN)
      expect(steps[3].run).toContain('migrate-deployment --target production --sha "$VERIFIED_SHA"')
      expect(steps[3].run).toContain('migrate-deployment --target production --check')
      expect(steps[3].id).toBe('migrate_d1')
      // Existing jobs have no generic approved R2 delivery. Keep working defaults.
      expect(steps[4].if).toBe('always()')
      expect(steps[4].uses).toContain('actions/upload-artifact@')
      expect(steps[4].with.path).toBe('.narduk/recovery/d1')
      expect(steps[4]['continue-on-error']).toBe(true)
      expect(steps[4].with['retention-days']).toBe(3)
      expect(steps[4].env).toBeUndefined()
      const productionOptIn = byPath.get('docs/deployment/promote-d1-r2.steps.yml').steps[0]
      expect(productionOptIn.if).toBe("always() && steps.migrate_d1.outcome != 'skipped'")
      expect(productionOptIn.run).toBe('pnpm exec narduk-app db preserve-recovery --checkout ../..')
      expect(productionOptIn.env).toEqual({
        VERIFIED_SHA: '${{ needs.gate.outputs.sha }}',
        D1_RECOVERY_REQUIRED: "${{ steps.migrate_d1.outputs.recovery_required || 'false' }}",
      })
      expect(productionOptIn.uses).toBeUndefined()
      expect(productionOptIn['continue-on-error']).toBeUndefined()
      expect(JSON.stringify(productionOptIn)).not.toContain('secrets.')
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
      expect(migrate.id).toBe('migrate_d1')
      const defaultPreserve = preview.jobs.migrate.steps.at(-1)
      expect(defaultPreserve.if).toBe('always()')
      expect(defaultPreserve.uses).toContain('actions/upload-artifact@')
      expect(defaultPreserve['continue-on-error']).toBe(true)
      expect(defaultPreserve.with['retention-days']).toBe(3)
      expect(defaultPreserve.env).toBeUndefined()
      const previewOptIn = byPath.get('docs/deployment/preview-d1-r2.steps.yml').steps[0]
      expect(previewOptIn.if).toBe("always() && steps.migrate_d1.outcome != 'skipped'")
      expect(previewOptIn.run).toBe('pnpm exec narduk-app db preserve-recovery --checkout ../..')
      expect(previewOptIn.env).toEqual({
        VERIFIED_SHA: '${{ github.event.workflow_run.head_sha }}',
        D1_RECOVERY_REQUIRED: "${{ steps.migrate_d1.outputs.recovery_required || 'false' }}",
      })
      expect(previewOptIn.uses).toBeUndefined()
      expect(previewOptIn['continue-on-error']).toBeUndefined()
      expect(JSON.stringify(previewOptIn)).not.toContain('secrets.')
      expect(preview.jobs.migrate.if).toContain('head_repository.full_name == github.repository')
      expect(preview.jobs.migrate.if).toContain("conclusion == 'success'")
      // Every job that runs narduk-app resolves the app's config from the
      // Operator Portal with the job's OIDC token, which needs this grant.
      expect(bundle.permissions['id-token']).toBe('write')
      expect(preview.jobs.migrate.permissions['id-token']).toBe('write')
      expect(promoteSteps.contents).toContain('needs `id-token: write`')
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
