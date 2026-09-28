import {
  CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
  CI_TEST_ONLY_NUXT_SESSION_PASSWORD,
} from './ci-test-env.js'
import { PERFORMANCE_BUDGET_ARGS } from './manifest.js'
import { NODE_SOURCE_FILE, REPOSITORY_GATE_SCRIPTS } from './ownership.js'
import { NUXT_CLOUDFLARE_WORKFLOW_SHA } from './workflow-pin.js'

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
// `upgrade` will not write this over a caller pin that is not an older value
// from workflow-pin.ts, so an app that has already moved past it stays there.
const workflowSha = NUXT_CLOUDFLARE_WORKFLOW_SHA

// workflows#141 (merged as 67968e3): the first commit whose callable accepts an
// explicit exact-candidate request pushed to `narduk-validation/<sha>/<id>`. Only
// the development-mode validation caller uses it; ordinary CI keeps the pin above
// so this generator does not also adopt every change between the two commits.
const validationWorkflowSha = '67968e304ba64e7733dc36d23d80eefda8d72e33'

/**
 * The job-level permissions every shared-workflow caller grants. A called
 * workflow can only narrow what its caller grants, and GitHub validates every
 * job's request before any job runs, skipped or not: the preview job asks for
 * `pull-requests: write` and, from the ordinary CI pin on, the reuse-plan and
 * e2e-plan jobs ask for `actions: read`. A caller that grants less gets a
 * `startup_failure` with no jobs at all, which is how every private app
 * generated with only `contents` and `packages` first ran.
 */
export const SHARED_WORKFLOW_CALLER_PERMISSIONS = [
  'contents: read',
  'packages: read',
  'actions: read',
  'pull-requests: write',
] as const

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
 * The private caller's `extra-scripts`: the static checks the public path
 * gets from `quality:static`, then every repository-stage check CI runs by
 * script name ({@link REPOSITORY_GATE_SCRIPTS}).
 */
export const PRIVATE_EXTRA_SCRIPTS: readonly string[] = [
  'format:check',
  'lint',
  'knip',
  'manifests:validate',
  ...REPOSITORY_GATE_SCRIPTS,
]

/** Public CI step running web-foundation items 8, 9, 11 and 12. */
export const REPOSITORY_GATE_STEP_NAME = 'Repository gate (web foundation items 8, 9, 11 and 12)'

/** Public CI step probing item 10 on this commit's locally built Worker. */
export const CANDIDATE_SECURITY_HEADERS_STEP_NAME =
  "Security headers of this commit's built Worker (web foundation item 10)"

/**
 * The public workflow's steps after `quality:static` (which built the Worker
 * with `build:ci`): the repository-stage checks of company-hq NAC §3.0 that a
 * public repository's own CI can decide (NAC-GATE-PARITY, §3.11).
 *
 * Items 8, 9, 11 and 12 read the checkout, so they run as package scripts.
 *
 * Items 1-7 (`foundation:check`) are NOT here, and cannot be yet. Sub-check
 * 5.1 passes on a call to the shared class callable, which a public
 * repository cannot make, and otherwise resolves against company-hq's
 * workflow adoption matrix -- which the spec requires an app's own check to
 * report `unknown` (WEB-FOUNDATION-CHECK.md §3 item 5: "The app-side check
 * cannot see the matrix and must report that half `unknown`"). So
 * `foundation:check` exits 2 in every public app's CI whatever the app does,
 * and gating on it would hold every public app red. Tolerating that one
 * UNKNOWN here would be this template re-judging the checker's verdict. Until
 * the spec gives public apps an app-side way to pass 5.1, items 1-7 of a
 * public app are decided by the weekly company-hq rollup, which can read the
 * matrix; `pnpm run foundation:check` still runs locally.
 *
 * Item 10 is a live probe, and a public repository cannot call the private
 * shared workflow whose Preview job probes the pull request's Cloudflare
 * preview. So the probe reads the candidate itself: the Worker `build:ci`
 * just built from this commit, served on 127.0.0.1 by `narduk-app e2e-serve`
 * (the launcher Playwright uses for a prebuilt artefact) and judged by the
 * published `narduk-app foundation:check:security-headers`, the same checker
 * and exit contract the shared workflow uses. It never reads production,
 * which would be the previous release rather than this commit. What it
 * cannot see is a header a Cloudflare zone adds or strips; the promote
 * workflow's post-promotion proof covers production. A server that never
 * answers fails the step, because "we did not look" is not a pass.
 */
export function publicRepositoryGateSteps(): string[] {
  return [
    '      # Web foundation items 1-7 are not run here: a public repository',
    '      # cannot call the shared class callable, so foundation:check sub-check',
    "      # 5.1 is UNKNOWN in this app's own CI by specification",
    '      # (company-hq WEB-FOUNDATION-CHECK.md item 5). The company-hq rollup',
    '      # decides items 1-7 for a public app.',
    `      - name: ${REPOSITORY_GATE_STEP_NAME}`,
    '        run: |',
    '          set -euo pipefail',
    ...REPOSITORY_GATE_SCRIPTS.map((script) => `          pnpm run ${script}`),
    `      - name: ${CANDIDATE_SECURITY_HEADERS_STEP_NAME}`,
    '        env:',
    '          CANDIDATE_PORT: 8790',
    '        run: |',
    '          set -euo pipefail',
    '          log="$RUNNER_TEMP/e2e-serve.log"',
    '          pnpm exec narduk-app e2e-serve "$CANDIDATE_PORT" >"$log" 2>&1 &',
    '          server=$!',
    '          trap \'kill "$server" 2>/dev/null || true\' EXIT',
    '          ready=',
    '          for _ in $(seq 1 90); do',
    '            if curl -fs -o /dev/null "http://127.0.0.1:$CANDIDATE_PORT/api/health"; then ready=1; break; fi',
    '            kill -0 "$server" 2>/dev/null || break',
    '            sleep 1',
    '          done',
    '          if [ -z "$ready" ]; then',
    '            cat "$log"',
    '            echo "::error::The built Worker never answered /api/health on 127.0.0.1:$CANDIDATE_PORT, so its security headers were not read."',
    '            exit 1',
    '          fi',
    '          pnpm exec narduk-app foundation:check:security-headers --base-url "http://127.0.0.1:$CANDIDATE_PORT"',
  ]
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
    // The public path runs `quality:static` and its own repository-gate
    // step. The private path calls the shared workflow instead, so each
    // check has to be named here or CI never runs it: the static checks,
    // then web-foundation items 8, 9, 11 and 12 (NAC-GATE-PARITY). They
    // read the checkout only, so they need no extra credential
    // (narduk-libs#282 review).
    `      extra-scripts: '${PRIVATE_EXTRA_SCRIPTS.join(' ')}'`,
    '      run-tests: true',
    '      test-script: test:unit',
    // Fails the build job on a FAIL/UNKNOWN web-foundation conformance
    // result and uploads the JSON artefact either way (parity with the
    // reference app's ci.yml).
    '      foundation-check: true',
    // The estate web quality gates (narduk-enterprises/workflows#158):
    // foundation-check and performance-budget in Build, and the
    // security-headers probe against the pull request's own Cloudflare
    // preview. The probe needs a preview check, which `preview-checks`
    // (default `og`) provides; the workflow fails Build if it were `none`.
    // Turning one gate off takes `quality-opt-out: <check>=<reason>`, and
    // the workflow warns with that reason on every run.
    '      quality-level: standard',
    // The budget runs from the repository root, but the build output is
    // the workspace app's. The rest are the app's own `performance-budget`
    // script arguments, so CI and a local run agree.
    `      performance-budget-args: '--app-dir apps/web ${PERFORMANCE_BUDGET_ARGS}'`,
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

/**
 * Starts the app's `promote.yml` for a bot-dispatched main CI run.
 *
 * dependabot-merge.yml merges with GITHUB_TOKEN and starts main CI by
 * `workflow_dispatch`. A run started with GITHUB_TOKEN fires no
 * `workflow_run`, so promote.yml never saw it: Dependabot bumps reached main
 * but not production until the next human merge (narduk-libs#787, jev and
 * gonogo). This job runs only for that case, after every CI job passed, and
 * dispatches promote.yml with `verified-sha` set to this run's commit.
 * promote.yml re-checks `ci / Required` on that SHA before it deploys.
 *
 * It never waits on anything, so it holds no runner while CI runs. It
 * promotes only main's head, so an older commit cannot replace a newer one.
 * An app whose promote.yml is absent (a 404) or has no `verified-sha` input
 * gets a notice instead of a failure; any other API error fails the job.
 */
export const PROMOTE_DISPATCH_JOB_NAME = 'Start Promote for a bot-dispatched main run'

function createPromoteDispatchJob(visibility: AppVisibility, needs: string): string[] {
  const runsOn =
    visibility === 'public'
      ? ['    runs-on: ubuntu-24.04']
      : [
          '    runs-on:',
          '      group: linux-ci',
          `      labels: [${LINUX_CI_RUNNER_LABELS.join(', ')}]`,
        ]
  return [
    '  # A main CI run started with GITHUB_TOKEN (dependabot-merge.yml) fires no',
    '  # workflow_run, so promote.yml never sees it (narduk-libs#787). Start it',
    '  # here instead, naming this commit; promote.yml re-checks the gate.',
    '  promote-dispatch:',
    `    name: ${PROMOTE_DISPATCH_JOB_NAME}`,
    `    needs: ${needs}`,
    '    if: >-',
    "      github.event_name == 'workflow_dispatch' &&",
    "      github.ref == 'refs/heads/main' &&",
    "      github.actor == 'github-actions[bot]'",
    ...runsOn,
    '    timeout-minutes: 5',
    '    permissions:',
    '      actions: write',
    '      contents: read',
    '    steps:',
    '      - name: Dispatch promote.yml for this commit',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          REPO: ${{ github.repository }}',
    '          VERIFIED_SHA: ${{ github.sha }}',
    '        run: |',
    '          set -euo pipefail',
    '          # Only a 404 means "no promote.yml"; any other API failure fails the',
    '          # job rather than quietly skipping the promotion.',
    '          if ! encoded=$(gh api "repos/$REPO/contents/.github/workflows/promote.yml?ref=$VERIFIED_SHA" \\',
    '            --jq .content 2>"$RUNNER_TEMP/promote-lookup.err"); then',
    '            grep -q "HTTP 404" "$RUNNER_TEMP/promote-lookup.err" || { cat "$RUNNER_TEMP/promote-lookup.err" >&2; exit 1; }',
    '            encoded=""',
    '          fi',
    '          promote_workflow=$(base64 -d <<<"$encoded")',
    '          if ! grep -Eq \'^[[:space:]]+verified-sha:[[:space:]]*$\' <<<"$promote_workflow"; then',
    '            echo "::notice::promote.yml takes no workflow_dispatch verified-sha input, so $VERIFIED_SHA reaches production only if a later commit is promoted (narduk-libs#787)."',
    '            exit 0',
    '          fi',
    '          head=$(gh api "repos/$REPO/commits/main" --jq .sha)',
    '          if [ "$head" != "$VERIFIED_SHA" ]; then',
    '            echo "::notice::main moved to $head during this run, so $VERIFIED_SHA is not promoted on its own; it reaches production if a later commit is promoted."',
    '            exit 0',
    '          fi',
    '          gh workflow run promote.yml --repo "$REPO" --ref main -f "verified-sha=$VERIFIED_SHA"',
    '          echo "Started Promote for $VERIFIED_SHA."',
    '',
  ]
}

/**
 * The promote workflow's gate step (docs/workers-builds.md excerpt), company-hq
 * NAC-DEPLOY-CONFORM point 2: promote exactly a commit whose `ci / Required`
 * concluded green on the default branch of the app's own repository, never on
 * a pull-request run or a fork's.
 *
 * Whatever started Promote, the candidate is main's current head, so an older
 * commit whose CI finished late never replaces a newer one, and a queued
 * Promote replaced in the concurrency group loses nothing. The proof is read,
 * not trusted from the trigger: the head's check runs are filtered to the
 * check suites of THIS repository's own `ci.yml` runs on main (a push, or a
 * dispatch such as dependabot-merge.yml's), so a pull request's or a fork's
 * `ci / Required` on the same commit never counts. The newest attempt wins by
 * check-run id, because a re-run that is still queued or in progress has no
 * `completed_at` and would otherwise sort behind an older success. Anything
 * but `success` skips with a notice: that run's own completion starts Promote
 * again.
 *
 * A recovery dispatch from a duplicate upload (narduk-libs#1233) sets
 * VERSION_ID. Only the version choice is manual: the gate fails the run unless
 * VERSION_ID is a Worker version id, STARTED_FOR is main's head and that proof
 * above passed, and then passes the id through as `version_id`.
 *
 * Needs GH_TOKEN (actions: read, checks: read, contents: read), REPO,
 * STARTED_FOR and optionally VERSION_ID; writes `sha=<head>` to GITHUB_OUTPUT
 * only on a proven head.
 */
export function createPromoteGateScript(): string {
  return `set -euo pipefail
head=$(gh api "repos/$REPO/commits/main" --jq .sha)
if [[ ! "$head" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::main's head is not a 40-character commit SHA; refusing to promote"
  exit 1
fi
suites=$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$head&branch=main&per_page=100" \\
  --jq "[.workflow_runs[] | select((.event == \\"push\\" or .event == \\"workflow_dispatch\\") and .head_branch == \\"main\\" and .head_repository.full_name == \\"$REPO\\") | .check_suite_id] | tojson")
if [[ ! "$suites" =~ ^\\[[0-9,]*\\]$ ]]; then
  echo "::error::could not read main's own CI runs for $head; refusing to promote"
  exit 1
fi
required=$(gh api "repos/$REPO/commits/$head/check-runs?check_name=ci%20%2F%20Required&filter=all&per_page=100" \\
  --jq "[.check_runs[] | select(.app.slug == \\"github-actions\\" and (.check_suite.id as \\$id | any(\${suites}[]; . == \\$id)))] | sort_by(.id) | last | if . == null then \\"missing\\" else (.conclusion // \\"not completed (\\\\(.status // \\"unknown\\"))\\") end")
if [ -n "\${VERSION_ID:-}" ]; then
  # Recovery dispatch: only the version choice is manual. The commit must
  # still be main's head with ci / Required passed in main's own CI, and
  # versions-promote refuses a version that does not carry that commit's tag.
  if [[ ! "$VERSION_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "::error::version-id $VERSION_ID is not a Worker version id"
    exit 1
  fi
  if [ "$STARTED_FOR" != "$head" ]; then
    echo "::error::verified-sha $STARTED_FOR is not main's head $head; a version is chosen only for the head, and a newer head's own CI run promotes it."
    exit 1
  fi
  if [ "$required" != success ]; then
    echo "::error::the latest ci / Required in main's own CI for $head is '$required'; nothing to recover."
    exit 1
  fi
  echo "version_id=$VERSION_ID" >> "$GITHUB_OUTPUT"
elif [ "$required" != success ]; then
  echo "::notice::main is at $head (this run started for $STARTED_FOR); ci / Required in main's own CI for it is '$required', so nothing is promoted. That run's completion starts Promote again."
  exit 0
fi
echo "ci / Required passed for $head in main's own CI run"
echo "sha=$head" >> "$GITHUB_OUTPUT"
`
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
      ...SHARED_WORKFLOW_CALLER_PERMISSIONS.map((entry) => '      ' + entry),
      '    with:',
      ...privateCallerInputs(),
      '',
      ...createPromoteDispatchJob('private', 'ci'),
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
    ...publicRepositoryGateSteps(),
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
    ...createPromoteDispatchJob('public', 'Required'),
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
    ...SHARED_WORKFLOW_CALLER_PERMISSIONS.map((entry) => '      ' + entry),
    '    with:',
    '      expected-candidate-sha: ${{ github.sha }}',
    ...privateCallerInputs(),
    '',
  ].join('\n')
}
