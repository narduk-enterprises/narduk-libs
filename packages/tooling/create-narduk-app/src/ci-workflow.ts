import {
  CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
  CI_TEST_ONLY_NUXT_SESSION_PASSWORD,
} from './ci-test-env.js'
import { NODE_SOURCE_FILE } from './ownership.js'

import type { AppVisibility } from './types.js'

// workflows#116, the first commit whose install AND foundation-check treat a
// committed `.npmrc` route to `https://npm.nard.uk` as anonymous (install
// skip: #108 / `eb7983fc`; foundation-check skip: this SHA). Tokenless
// private callers need both: #97's Configure package registry auth still
// classified every `@narduk-enterprises/*` app as private and exited 1
// without `NARDUK_PLATFORM_GH_PACKAGES_READ` (narduk-libs#568).
//
// Still carries #97's `node-version-file` input and the always-run required
// `caller-lint` job (workflow-level concurrency, top-level and per-job
// `permissions:`, per-job `timeout-minutes`, 40-character SHA pins). That
// gate is why this file emits a job-level `permissions:` block on every job
// it writes -- `tests/caller-lint-hygiene.test.ts` re-runs the audit's own
// rules over the generated output so the templates cannot drift back.
//
// #99 and #100 sit between #97 and #116; there is no pin that only adds the
// mirror skip. #99 is inert for generated apps (no `install-script`). #100
// fails the build on fixable high/critical advisories.
//
// Still not main's tip. The development-mode validation caller stays on #141
// below so ordinary CI does not also adopt every change between #116 and #141.
const workflowSha = '1513b2a2f4b147b2e625478e56eb9de0cc5d5399'

// workflows#141 (merged as 67968e3): the first commit whose callable accepts an
// explicit exact-candidate request pushed to `narduk-validation/<sha>/<id>`. Only
// the development-mode validation caller uses it; ordinary CI keeps the pin above
// so this generator does not also adopt every change between the two commits.
const validationWorkflowSha = '67968e304ba64e7733dc36d23d80eefda8d72e33'

// Resolved from fleet's organization routes. Creating files does not grant
// selected-repository membership; onboarding remains an explicit fleet action.
const linuxRoute =
  '{"group":"linux-ci","labels":["self-hosted","Linux","X64","proxmox","linux-ci"]}'
const browserRoute =
  '{"group":"playwright-isolated","labels":["self-hosted","Linux","X64","proxmox-playwright-x64"]}'

/**
 * The `linux-ci` route's labels as a literal `runs-on:` block names them
 * (dependabot-merge.yml). `.github/actionlint.yaml` declares the custom ones
 * from this same array, so the two cannot drift (narduk-libs#778).
 */
export const LINUX_CI_RUNNER_LABELS = [
  'self-hosted',
  'Linux',
  'X64',
  'proxmox',
  'linux-ci',
] as const

function setupSteps(): string[] {
  return [
    // Both pins verified tag-to-SHA against api.github.com on 2026-09-16 and
    // both were that action's latest release. The generator was a release
    // behind the reference app on each, which Dependabot had already bumped
    // there -- found by running `create-narduk-app upgrade` against Buoys
    // (narduk-libs#U1), which is exactly the direction this codemod is meant
    // to surface: the app was right, so the template moved.
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '        with:',
    '          persist-credentials: false',
    // No `version:` input: pnpm/action-setup v6 resolves the root manifest's
    // `packageManager`, which is this app's declared pnpm source. Restating the
    // version here would be a second declaration that has to be bumped in step
    // -- exactly what `foundation:check:toolchain` (item 11) fails on, and what
    // the shared nuxt-cloudflare workflow's own pnpm step already avoids.
    '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0',
    '        with:',
    '          dest: ${{ runner.temp }}/setup-pnpm',
    '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    '        with:',
    // Points at the declared Node source instead of restating its value, so a
    // Node bump is one edit to `.node-version` and nothing here.
    `          node-version-file: ${NODE_SOURCE_FILE}`,
    '          package-manager-cache: false',
    '      - name: Install workspace',
    '        run: pnpm install --frozen-lockfile',
  ]
}

// Opt-in break-glass helper. Default installs read `https://npm.nard.uk`
// anonymously. This committed copy of `narduk-app gh-packages-run` is for an
// operator who has repointed `.npmrc` at GitHub Packages during a mirror
// outage. It is not referenced by generated scripts or CI.
export function createGhPackagesRunScript(): string {
  return [
    "import { spawnSync } from 'node:child_process'",
    "import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'",
    "import { tmpdir } from 'node:os'",
    "import { join } from 'node:path'",
    '',
    '// Process-scoped GitHub Packages auth for pre-install callers.',
    '// Mirrors `narduk-app gh-packages-run`: temp userconfig (wx, mode 0600,',
    '// umask 077), never a tracked file. narduk-app is not on PATH until after',
    '// the frozen install this script is asked to run.',
    '',
    'const token = process.env.GH_PACKAGES_READ?.trim()',
    'if (!token || /[\\r\\n]/u.test(token)) {',
    "  throw new Error('Missing or invalid GH_PACKAGES_READ')",
    '}',
    '',
    'const argv = process.argv.slice(2)',
    "const command = argv[0] === '--' ? argv.slice(1) : argv",
    'if (command.length === 0) {',
    "  throw new Error('Usage: node scripts/gh-packages-run.mjs -- <command...>')",
    '}',
    '',
    'const existingUserconfig = process.env.NPM_CONFIG_USERCONFIG?.trim()',
    'if (existingUserconfig) {',
    "  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' })",
    '  if (result.error) throw result.error',
    '  process.exit(result.status ?? 1)',
    '}',
    '',
    'const previousUmask = process.umask(0o077)',
    'const tempRoot = process.env.RUNNER_TEMP?.trim() || tmpdir()',
    "const directory = mkdtempSync(join(tempRoot, 'npmrc-auth.'))",
    "const authFile = join(directory, 'userconfig')",
    'try {',
    "  writeFileSync(authFile, '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}\\n', {",
    '    mode: 0o600,',
    "    flag: 'wx',",
    '  })',
    '  const result = spawnSync(command[0], command.slice(1), {',
    "    stdio: 'inherit',",
    '    env: {',
    '      ...process.env,',
    '      NPM_CONFIG_USERCONFIG: authFile,',
    "      NPM_CONFIG_GLOBALCONFIG: '/dev/null',",
    '    },',
    '  })',
    '  if (result.error) throw result.error',
    '  process.exitCode = result.status ?? 1',
    '} finally {',
    '  process.umask(previousUmask)',
    '  rmSync(directory, { recursive: true, force: true })',
    '}',
    '',
  ].join('\n')
}

// GitHub Copilot's coding-agent environment runs this workflow once (on
// `workflow_dispatch`, dispatched by Copilot itself, never by a caller here)
// to prepare its own sandbox before it can see or run any other script.
// Reuses setupSteps() -- the same anonymous frozen install the public path's
// quality/browser jobs run. `@narduk-enterprises/*` is read from
// `https://npm.nard.uk` with no package secret. `runs-on: ubuntu-latest` is a
// deliberate carve-out from "no GitHub-hosted CI for real work": Copilot's
// sandbox prep is not the app's CI.
export function createCopilotSetupWorkflow(): string {
  return [
    'name: Copilot Setup Steps',
    '',
    'on:',
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: read',
    '  packages: read',
    '',
    // Missing on the reference app today (buoys#728) -- included here
    // because a superseded dispatch should not keep an old sandbox prep
    // running, and every other workflow this generator emits sets both.
    'concurrency:',
    '  group: copilot-setup-${{ github.repository }}-${{ github.ref }}',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    '  copilot-setup-steps:',
    '    runs-on: ubuntu-latest',
    // A job-level permissions block REPLACES the workflow level rather than
    // merging with it, so both are stated. Required by the shared workflow's
    // caller-lint gate, which audits every file in the caller's own
    // .github/workflows -- this one included.
    '    permissions:',
    '      contents: read',
    '      packages: read',
    '    environment: copilot',
    '    timeout-minutes: 30',
    '    steps:',
    ...setupSteps(),
    '',
  ].join('\n')
}

/**
 * The shared-workflow inputs of the private CI caller. The explicit
 * validation caller reuses them verbatim so a release is validated by exactly the
 * suite ordinary CI runs, plus the exact-candidate guard.
 */
function privateCallerInputs(): string[] {
  return [
    `      runner: '${linuxRoute}'`,
    // `node-version-file` (workflows#97) instead of a literal: the shared
    // workflow passes it straight through to actions/setup-node, so the
    // caller reads the app's declared Node source rather than carrying a
    // second copy of it. Generated apps build from the repository root, so
    // the path resolves the same whichever base setup-node joins it to.
    `      node-version-file: '${NODE_SOURCE_FILE}'`,
    '      package-manager: pnpm',
    '      require-scripts: true',
    '      typecheck-worker-script: typecheck',
    "      typecheck-web-script: ''",
    // `build:ci` sets NARDUK_CLOUDFLARE_BUILD=1 (drops the local-only
    // nitro-cloudflare-dev module) and NITRO_PRESET=cloudflare_module, so
    // CI validates the actual deployable Worker shape instead of the dev
    // preset (matches the reference app's build-script input exactly).
    '      build-script: build:ci',
    // Reusable workflows do not inherit caller `env:`. The test-only
    // NUXT_OG_IMAGE_SECRET / NUXT_SESSION_PASSWORD values live on the
    // generated `build:ci` script (ci-test-env.ts) so this Build lane
    // still has them without a repository secret.
    // The public path runs `quality:static`, which already chains
    // `foundation:shared-ui-pinned` and `manifests:validate`. The private
    // path calls the shared workflow instead, so each check has to be
    // named here or CI never runs it. They read manifests only, so they
    // need no extra credential (narduk-libs#282 review).
    "      extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned'",
    '      run-tests: true',
    '      test-script: test:unit',
    // Fails the build job on a FAIL/UNKNOWN web-foundation conformance
    // result and uploads the JSON artefact either way (parity with the
    // reference app's ci.yml).
    '      foundation-check: true',
    '      run-e2e: true',
    '      e2e-script: test:e2e',
    `      e2e-runner: '${browserRoute}'`,
    '      e2e-shards: 3',
    "      e2e-args: '--project=chromium --workers=1'",
    '      e2e-install-browsers: false',
    '      # The guest exports its immutable browser path; no caller override.',
  ]
}

/** Hosted job that can produce a log when self-hosted `ci` never leaves queued. */
export const RUNNER_ONBOARDING_JOB_NAME = 'Runner group onboarding'

export const RUNNER_ONBOARDING_MESSAGE =
  'This repository is not in the fleet runner groups its private CI names (linux-ci and playwright-isolated). The route names in .github/workflows/ci.yml do not grant selected-repository membership. Onboard this repository into both groups and grant it access to the shared workflows, then re-run. A job that stays queued with no runner is this gap, not a queue you can wait out.'

/**
 * Detects a missing selected-repository runner-group assignment.
 *
 * The org runner-groups API needs admin:org, which `github.token` usually
 * lacks. A refused call still prints its JSON error body on stdout, so only a
 * listing from a `gh` that exited 0 counts. When the listing works, absence is
 * a hard failure. When it does not -- the usual case -- this watches the
 * sibling jobs on this run that ask for a self-hosted runner: one that gets a
 * runner proves the groups are reachable. A skipped job is `completed` with no
 * runner and proves nothing, and a job on a hosted runner proves nothing about
 * the self-hosted groups, so neither counts. If none starts in time it
 * annotates the run. It does not fail on that heuristic -- a busy queue looks
 * the same from inside the repository (narduk-libs#625).
 */
export function createRunnerOnboardingScript(): string {
  return `set -euo pipefail
message='${RUNNER_ONBOARDING_MESSAGE}'
org="\${REPO%%/*}"
wait_seconds="\${RUNNER_ONBOARDING_WAIT_SECONDS:-90}"

groups=''
if listing=$(gh api --paginate "orgs/\${org}/actions/runner-groups" --jq '.runner_groups[] | select(.name=="linux-ci" or .name=="playwright-isolated") | [.id, .visibility, .name] | @tsv' 2>/dev/null); then
  groups="$listing"
fi

listed=0
missing=0
unknown=0
while IFS=$'\\t' read -r id visibility name; do
  [ -n "$id" ] || continue
  listed=1
  # 'all' admits every repository and 'private' every private one; this job
  # is only generated for private repositories.
  if [ "$visibility" = "all" ] || [ "$visibility" = "private" ]; then
    continue
  fi
  if ! members=$(gh api --paginate "orgs/\${org}/actions/runner-groups/\${id}/repositories" --jq '.repositories[].full_name' 2>/dev/null); then
    echo "Could not list the repositories in \${name} (id \${id})."
    unknown=1
    continue
  fi
  if ! grep -Fxq "$REPO" <<<"$members"; then
    echo "Not a member of \${name} (id \${id})."
    missing=1
  fi
done <<<"$groups"

if [ "$listed" -gt 0 ]; then
  if [ "$missing" -eq 1 ]; then
    echo "::error::$message"
    exit 1
  fi
  if [ "$unknown" -eq 0 ]; then
    echo "Repository is listed in the named runner groups."
    exit 0
  fi
fi

deadline=$((SECONDS + wait_seconds))
while :; do
  counts=''
  if job_counts=$(gh api "repos/\${REPO}/actions/runs/\${RUN_ID}/jobs?per_page=100" --jq '[.jobs[] | select(.name != "${RUNNER_ONBOARDING_JOB_NAME}")] | [length, (map(select((.labels // []) | index("self-hosted"))) | length), (map(select((.labels // []) | index("self-hosted")) | select(.runner_id != null and .runner_id != 0)) | length)] | @tsv' 2>/dev/null); then
    counts="$job_counts"
  fi
  IFS=$'\\t' read -r siblings self_hosted started <<<"$counts" || true
  if [[ "\${started:-}" =~ ^[0-9]+$ ]] && [ "$started" -gt 0 ]; then
    echo "A self-hosted sibling job got a runner; runner groups look reachable."
    exit 0
  fi
  if [[ "\${siblings:-}" =~ ^[0-9]+$ ]] && [ "$siblings" -gt 0 ] && [ "\${self_hosted:-}" = "0" ]; then
    echo "No sibling job in this run asks for a self-hosted runner."
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    break
  fi
  sleep "\${RUNNER_ONBOARDING_POLL_SECONDS:-5}"
done
echo "::warning::$message"
`
}

function createRunnerOnboardingJob(): string[] {
  const runBody = createRunnerOnboardingScript()
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `          ${line}`))
    .join('\n')
  return [
    '  # Hosted on purpose: a missing runner-group assignment leaves every',
    '  # self-hosted job in `queued` with no log. This job still starts and',
    '  # annotates the run (narduk-libs#625). It does not `needs:` `ci` and',
    '  # `ci` does not `needs:` it, so a healthy self-hosted job can start',
    '  # immediately and this job can observe that.',
    '  runner-onboarding:',
    `    name: ${RUNNER_ONBOARDING_JOB_NAME}`,
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 5',
    '    permissions:',
    '      contents: read',
    '      actions: read',
    '    steps:',
    '      - name: Detect a missing runner-group assignment',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          REPO: ${{ github.repository }}',
    '          RUN_ID: ${{ github.run_id }}',
    '        run: |',
    runBody,
  ]
}

export function createCiWorkflow(visibility: AppVisibility): string {
  const header = [
    'name: CI',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches: [main]',
    '  workflow_dispatch:',
    '',
    // Cancel superseded pull-request runs only. A push run (main) queues
    // instead of being cancelled, so the commit that actually merged keeps a
    // completed CI record rather than a cancelled one (buoys#107 fix,
    // matched here for parity).
    'concurrency:',
    '  group: ci-${{ github.repository }}-${{ github.event.pull_request.number || github.sha }}',
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
  ]
  if (visibility === 'private') {
    return [
      ...header,
      '  # Before the first run, onboard this repository into both fleet groups.',
      '  # These routes do not grant selected-repository membership themselves.',
      ...createRunnerOnboardingJob(),
      '  ci:',
      `    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@${workflowSha}`,
      '    permissions:',
      '      contents: read',
      '      packages: read',
      '    with:',
      ...privateCallerInputs(),
      '',
    ].join('\n')
  }
  // Public callers cannot call the private shared workflow. Keep all three
  // browser shards hosted and require their merged evidence before acceptance.
  return [
    ...header,
    '  quality:',
    '    name: Static, unit, and build',
    '    runs-on: ubuntu-24.04',
    // Job level replaces, never merges, the workflow level -- see the
    // caller-lint note beside workflowSha above.
    '    permissions:',
    '      contents: read',
    '      packages: read',
    '    timeout-minutes: 30',
    '    env:',
    '      NODE_OPTIONS: --max-old-space-size=3072',
    // Plain values, not secrets.*: narduk-seo fails a non-dev nuxt build
    // when NUXT_OG_IMAGE_SECRET is empty, and a fresh repo has no Actions
    // secret. These match Playwright's committed test-only placeholders.
    `      NUXT_OG_IMAGE_SECRET: ${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}`,
    `      NUXT_SESSION_PASSWORD: ${CI_TEST_ONLY_NUXT_SESSION_PASSWORD}`,
    '    steps:',
    ...setupSteps(),
    '      - run: pnpm run quality:static',
    '',
    '  browser:',
    '    name: Chromium shard ${{ matrix.shard }}/3',
    '    needs: quality',
    '    strategy:',
    '      fail-fast: false',
    '      max-parallel: 3',
    '      matrix:',
    '        shard: [1, 2, 3]',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: read',
    '      packages: read',
    '    timeout-minutes: 30',
    '    env:',
    '      NODE_OPTIONS: --max-old-space-size=3072',
    '      PLAYWRIGHT_HTML_OPEN: never',
    `      NUXT_OG_IMAGE_SECRET: ${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}`,
    `      NUXT_SESSION_PASSWORD: ${CI_TEST_ONLY_NUXT_SESSION_PASSWORD}`,
    '    steps:',
    ...setupSteps(),
    '      - name: Install Chromium on the hosted runner',
    '        run: pnpm exec playwright install --with-deps chromium',
    '      - name: Build application',
    '        run: pnpm run build:ci',
    '      - name: Run Chromium shard',
    '        run: pnpm run test:e2e --project=chromium --shard=${{ matrix.shard }}/3 --workers=1 --reporter=line,blob',
    '      - name: Upload shard blob report',
    '        if: always()',
    '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
    '        with:',
    '          name: blob-${{ github.run_id }}-${{ github.run_attempt }}-chromium-${{ matrix.shard }}',
    '          path: blob-report',
    '          retention-days: 1',
    '          if-no-files-found: error',
    '',
    '  browser-report:',
    '    name: Merge Playwright reports',
    "    if: always() && needs.quality.result == 'success'",
    '    needs: [quality, browser]',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: read',
    '      packages: read',
    '    timeout-minutes: 20',
    '    env:',
    '      PLAYWRIGHT_HTML_OPEN: never',
    '    steps:',
    ...setupSteps(),
    "      - name: Download this run's shard reports",
    '        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1',
    '        with:',
    '          pattern: blob-${{ github.run_id }}-${{ github.run_attempt }}-chromium-*',
    '          path: all-blob-reports',
    '          merge-multiple: true',
    '      - name: Require all three shard reports',
    '        run: |',
    '          set -euo pipefail',
    "          test \"$(find all-blob-reports -maxdepth 1 -name '*.zip' | wc -l | tr -d ' ')\" = 3",
    '      - name: Merge reports and traces',
    '        run: pnpm exec playwright merge-reports --reporter=html all-blob-reports',
    '      - name: Upload merged browser diagnostics',
    '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
    '        with:',
    '          name: playwright-report-${{ github.run_id }}-${{ github.run_attempt }}',
    '          path: playwright-report',
    '          retention-days: 14',
    '          if-no-files-found: error',
    '',
    '  Required:',
    '    name: ci / Required',
    '    if: always()',
    '    needs: [quality, browser, browser-report]',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: read',
    '    timeout-minutes: 5',
    '    steps:',
    '      - name: Require static and browser success',
    '        env:',
    '          QUALITY_RESULT: ${{ needs.quality.result }}',
    '          BROWSER_RESULT: ${{ needs.browser.result }}',
    '          REPORT_RESULT: ${{ needs.browser-report.result }}',
    '        run: |',
    '          set -euo pipefail',
    '          test "$QUALITY_RESULT" = success',
    '          test "$BROWSER_RESULT" = success',
    '          test "$REPORT_RESULT" = success',
    '',
  ].join('\n')
}

/**
 * Merges the `safe` Dependabot lane (.github/dependabot.yml, minor + patch)
 * once CI on its exact head is green, then starts CI on `main` for the
 * merged commit. Reference shape: gonogo#104 (merged as 0c464d8),
 * narduk-libs#U2.
 *
 * Why `workflow_run` and not GitHub's own auto-merge: a merge made with this
 * workflow's GITHUB_TOKEN fires no push workflows, so the merged commit would
 * never get its own `ci / Required` run on `main`. Merging here, after CI has
 * already passed on the PR head, lets the same job start main CI by
 * `workflow_dispatch`, which GitHub does allow from GITHUB_TOKEN. Nothing
 * from the pull request is checked out or executed -- the job only reads PR
 * metadata and calls the API -- so running with a write token on
 * `workflow_run` never hands that token to Dependabot's branch.
 *
 * The `majors` lane and the `github-actions` lane are never touched here: a
 * major bump usually needs a code change, and a workflow-file edit cannot be
 * merged by GITHUB_TOKEN at all, so both stay a deliberate person/agent PR.
 *
 * Runner: private apps route through the same self-hosted `linux-ci` group
 * ci.yml's reusable-workflow caller uses (`linuxRoute` above, expressed here
 * as a literal `runs-on:` block since this job calls no reusable workflow).
 * Public apps must use a GitHub-hosted runner -- no self-hosted runner ever
 * sees a fork PR's or a bot's code (D-VIS-1) -- so they get `ubuntu-24.04`,
 * matching the public path's own jobs above.
 */
export function createDependabotMergeWorkflow(visibility: AppVisibility): string {
  const runsOn =
    visibility === 'public'
      ? '    runs-on: ubuntu-24.04'
      : [
          '    runs-on:',
          '      group: linux-ci',
          `      labels: [${LINUX_CI_RUNNER_LABELS.join(', ')}]`,
        ].join('\n')
  return [
    'name: Dependabot merge',
    '',
    "# Merges Dependabot's `safe` lane (minor + patch, see .github/dependabot.yml)",
    '# once CI on its exact head is green, then starts CI on main.',
    '#',
    '# Why workflow_run and not GitHub auto-merge: a merge made with this',
    "# workflow's GITHUB_TOKEN fires no push workflows, so the merged commit",
    '# would never get its own `ci / Required` run on main. Merging here, after',
    '# CI has already passed, lets the same job start main CI by',
    '# workflow_dispatch, which GitHub does allow from GITHUB_TOKEN.',
    '#',
    '# Nothing from the pull request is checked out or executed: the job only',
    '# reads PR metadata and calls the API, so running with a write token on',
    "# workflow_run does not hand that token to Dependabot's branch.",
    'on:',
    '  workflow_run:',
    '    workflows: [CI]',
    '    types: [completed]',
    '',
    // Required by the shared workflow's caller-lint gate: every workflow
    // that is not workflow_call-only needs a workflow-level concurrency
    // block (see the workflowSha comment above). A completed CI run is a
    // one-shot event per head branch, so this never has anything in flight
    // to cancel -- it exists to satisfy the audited rule, not to serialize
    // real contention.
    'concurrency:',
    '  group: dependabot-merge-${{ github.event.workflow_run.head_branch }}',
    '  cancel-in-progress: false',
    '',
    'permissions: {}',
    '',
    'jobs:',
    '  merge:',
    '    if: >-',
    "      github.event.workflow_run.conclusion == 'success' &&",
    "      github.event.workflow_run.event == 'pull_request' &&",
    "      github.event.workflow_run.actor.login == 'dependabot[bot]' &&",
    "      startsWith(github.event.workflow_run.head_branch, 'dependabot/npm_and_yarn/safe-')",
    runsOn,
    '    timeout-minutes: 10',
    '    permissions:',
    '      actions: write',
    '      contents: write',
    '      pull-requests: write',
    '    steps:',
    '      - name: Merge the safe lane at the head CI proved',
    '        id: merge',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          REPO: ${{ github.repository }}',
    '          BRANCH: ${{ github.event.workflow_run.head_branch }}',
    '          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}',
    '        run: |',
    '          set -euo pipefail',
    '          pr=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open \\',
    '            --json number,headRefOid,author \\',
    '            --jq ".[] | select(.author.login == \\"app/dependabot\\" and .headRefOid == \\"$HEAD_SHA\\") | .number")',
    '          if [ -z "$pr" ]; then',
    '            echo "No open Dependabot PR on $BRANCH at $HEAD_SHA; the lane moved on or already merged."',
    '            exit 0',
    '          fi',
    '          # Only dependency manifests may change. Anything else means a person',
    '          # pushed to the branch, and a person merges it.',
    '          unexpected=$(gh pr view "$pr" --repo "$REPO" --json files \\',
    '            --jq \'[.files[].path | select(test("(^|/)(package\\\\.json|pnpm-lock\\\\.yaml|pnpm-workspace\\\\.yaml)$") | not)] | join(" ")\')',
    '          if [ -n "$unexpected" ]; then',
    '            echo "::warning::PR #$pr changes more than dependency manifests ($unexpected); leaving it for a person."',
    '            exit 0',
    '          fi',
    '          gh pr merge "$pr" --repo "$REPO" --squash --match-head-commit "$HEAD_SHA"',
    '          echo "Merged #$pr at $HEAD_SHA."',
    '          echo "merged=true" >> "$GITHUB_OUTPUT"',
    '',
    '      - name: Start CI on main for the merged commit',
    "        if: steps.merge.outputs.merged == 'true'",
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          REPO: ${{ github.repository }}',
    '        run: gh workflow run ci.yml --repo "$REPO" --ref main',
    '',
  ].join('\n')
}

/**
 * Explicit full validation for development mode (company-hq#781). Ordinary
 * pushes stay quiet while automation is held; `narduk-app development validate`
 * pushes the exact commit to a reserved `narduk-validation/<sha>/<id>` ref, which
 * is the only trigger here. A push event on the candidate commit is what lets
 * the result satisfy the existing required `ci / Required` check -- a
 * `workflow_dispatch` run never can. It validates only; it never deploys.
 *
 * Public repositories cannot call the private shared workflow, so they get no
 * validation caller and cannot enter development mode until one exists.
 */
export function createValidationWorkflow(visibility: AppVisibility): string | null {
  if (visibility !== 'private') return null
  return [
    'name: Explicit full validation',
    '',
    'on:',
    '  push:',
    "    branches: ['narduk-validation/**']",
    '',
    'concurrency:',
    '  group: explicit-validation-${{ github.ref }}',
    '  cancel-in-progress: false',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  ci:',
    `    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@${validationWorkflowSha}`,
    '    permissions:',
    '      contents: read',
    '      packages: read',
    '      actions: read',
    '      pull-requests: write',
    '    with:',
    '      expected-candidate-sha: ${{ github.sha }}',
    ...privateCallerInputs(),
    '',
  ].join('\n')
}
