import type { AppVisibility, GeneratedFile } from './types.js'

const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
const upload = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1'
const download = 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1'

function setup(): string {
  return `      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
        with:
          dest: \${{ runner.temp }}/setup-pnpm
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .node-version
          package-manager-cache: false
      - name: Install frozen trusted toolchain
        run: pnpm install --frozen-lockfile
`
}

/**
 * The `linux-deploy` route's labels (preview-d1.yml's `runs-on:`). Fleet route
 * resolved 2026-09-19; onboarding must grant group membership. The template is
 * meant to be copied into `.github/workflows`, so `.github/actionlint.yaml`
 * declares these labels too (narduk-libs#778).
 */
export const LINUX_DEPLOY_RUNNER_LABELS = [
  'self-hosted',
  'Linux',
  'X64',
  'proxmox',
  'proxmox-deploy',
] as const

/** Inert onboarding files, owned by the app after one-shot generation. */
export function createMigrationWorkflowFiles(visibility: AppVisibility): GeneratedFile[] {
  const deployRunner =
    visibility === 'public'
      ? 'ubuntu-24.04'
      : `{ group: linux-deploy, labels: [${LINUX_DEPLOY_RUNNER_LABELS.join(', ')}] }`
  return [
    {
      path: 'docs/deployment/promote-d1.steps.yml',
      contents: `# Insert these steps in the existing serialized promote job, AFTER successful CI,
# checkout of workflow_run.head_sha and frozen install, BEFORE versions-promote.
# The enclosing workflow must have cancel-in-progress: false and same-repository,
# production-branch, successful workflow_run guards. Never use pull_request_target.
# D1_MIGRATE_API_TOKEN is materialized from the declared D1-only migrate persona;
# CLOUDFLARE_API_TOKEN below remains the existing separate promote credential.
# The first two steps hold no credential. Worker rollback restores code, never a
# schema, so a drop or rename that is not a reviewed contract migration must stop
# here, before D1 changes (foundation sub-check 12.9, narduk-libs#399). Only 12.9
# is judged: another sub-check's UNKNOWN is not a reason to refuse a migration.
steps:
  - name: Check migrations are expand-only (foundation 12.9)
    run: pnpm exec narduk-app foundation:check:deployment --checkout ../.. --json "$RUNNER_TEMP/foundation-deployment.json" || true
    working-directory: apps/web
  - name: Refuse a drop or rename that is not a reviewed contract migration
    run: |
      node -e '
        const report = require(process.argv[1])
        const check = report.item.checks.find((c) => c.id === "12.9")
        if (!check || check.status !== "pass") {
          console.error("12.9 " + (check ? check.status + ": " + check.detail : "is missing from the report"))
          process.exit(1)
        }
        console.log("12.9 pass: " + check.detail)
      ' "$RUNNER_TEMP/foundation-deployment.json"
  - name: Require an eligible uploaded version before changing D1
    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      VERIFIED_SHA: \${{ github.event.workflow_run.head_sha }}
    run: pnpm exec narduk-app deploy versions-promote --sha "$VERIFIED_SHA" --gate-verified "ci / Required@$VERIFIED_SHA" --production-branch main --dry-run --json
    working-directory: apps/web
  - name: Apply compatible D1 migrations and require no drift
    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.D1_MIGRATE_API_TOKEN }}
      VERIFIED_SHA: \${{ github.event.workflow_run.head_sha }}
    run: |
      set -euo pipefail
      pnpm exec narduk-app db migrate-deployment --target production --sha "$VERIFIED_SHA"
      pnpm exec narduk-app db migrate-deployment --target production --check
    working-directory: apps/web
  - name: Preserve D1 recovery evidence, including on failure
    if: always()
    uses: ${upload}
    with:
      name: d1-production-recovery-\${{ github.run_id }}-\${{ github.run_attempt }}
      path: .narduk/recovery/d1
      include-hidden-files: true
      retention-days: 14
      if-no-files-found: ignore
# Keep the app's existing versions-promote, live proof and rollback steps next.
# All require preceding success. Only a completed promotion followed by failed
# live proof can trigger Worker rollback; migration failure must never do so.
# Rollback changes Worker traffic only. Never automate a database restore.
# Automating rollback beside the migrate step is safe only with the 12.9 steps
# above in place (narduk-libs#399); without them rollback stays a manual command.
`,
    },
    {
      path: 'docs/deployment/ci-d1-bundle.job.yml',
      contents: `# Merge this job into CI (the workflow that preview-d1.yml follows).
# It has NO D1 or deployment credential. Make it part of CI's required result.
# Hosted runner even for private repos: PR code must not share a persistent
# credentialed deployment host. The SQL bundle is data, not trusted tooling.
jobs:
  d1-bundle:
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: read
    timeout-minutes: 15
    steps:
      - uses: ${checkout}
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          persist-credentials: false
${setup()}      - name: Package migration SQL and checksums only
        working-directory: apps/web
        run: pnpm exec narduk-app db bundle --output ../../d1-migrations.json
      - uses: ${upload}
        with:
          name: d1-migrations-\${{ github.run_attempt }}
          path: d1-migrations.json
          retention-days: 7
          if-no-files-found: error
`,
    },
    {
      path: 'docs/deployment/preview-d1.yml',
      contents: `# Copy to .github/workflows only after D1 source and preview bindings exist.
# Preserve the trusted checkout. Never check out workflow_run.head_sha here.
name: Preview D1 readiness
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
concurrency:
  group: preview-d1-\${{ github.repository }}
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  migrate:
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.head_repository.full_name == github.repository
    runs-on: ${deployRunner}
    environment: preview-migrations
    permissions:
      contents: read
      actions: read
      packages: read
    timeout-minutes: 20
    steps:
      - uses: ${checkout}
        with:
          ref: \${{ github.event.repository.default_branch }}
          persist-credentials: false
${setup()}      - name: Download SQL from this exact successful CI run and attempt
        uses: ${download}
        with:
          github-token: \${{ github.token }}
          run-id: \${{ github.event.workflow_run.id }}
          name: d1-migrations-\${{ github.event.workflow_run.run_attempt }}
          path: \${{ runner.temp }}/d1-bundle
      - name: Migrate declared preview databases with trusted tooling
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.D1_MIGRATE_API_TOKEN }}
          VERIFIED_SHA: \${{ github.event.workflow_run.head_sha }}
          SQL_BUNDLE: \${{ runner.temp }}/d1-bundle/d1-migrations.json
        working-directory: apps/web
        run: |
          set -euo pipefail
          pnpm exec narduk-app db migrate-deployment --target preview --sha "$VERIFIED_SHA" --bundle "$SQL_BUNDLE"
          pnpm exec narduk-app db migrate-deployment --target preview --sha "$VERIFIED_SHA" --bundle "$SQL_BUNDLE" --check
      - name: Preserve D1 recovery evidence, including on failure
        if: always()
        uses: ${upload}
        with:
          name: d1-preview-recovery-\${{ github.run_id }}-\${{ github.run_attempt }}
          path: .narduk/recovery/d1
          include-hidden-files: true
          retention-days: 14
          if-no-files-found: ignore
# Run the app's preview health/smoke checks only AFTER this job succeeds.
# An uploaded preview URL alone is not evidence that its schema is ready.
`,
    },
  ]
}
