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
      expect(steps[0].run).toContain('--dry-run')
      expect(steps[0].env.CLOUDFLARE_API_TOKEN).not.toBe(steps[1].env.CLOUDFLARE_API_TOKEN)
      expect(steps[1].run).toContain('migrate-deployment --target production --sha "$VERIFIED_SHA"')
      expect(steps[1].run).toContain('migrate-deployment --target production --check')
      expect(steps[2].if).toBe('always()')
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
