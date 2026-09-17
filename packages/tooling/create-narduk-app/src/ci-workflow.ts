import { NODE_VERSION } from './manifest.js'

import type { AppVisibility } from './types.js'

// Kept in sync with the reference app (narduk-enterprises/buoys) rather than
// left to drift: buoys#107 moved to this exact SHA, the tip of
// narduk-enterprises/workflows main as of 2026-09-16 (generator-parity audit,
// narduk-libs#D2). Bump deliberately alongside a verified Buoys/CI adoption.
const workflowSha = '4e99dafc81e09eb10c6e404f67e3ca34a17b42a6'

// Resolved from fleet's organization routes. Creating files does not grant
// selected-repository membership; onboarding remains an explicit fleet action.
const linuxRoute =
  '{"group":"linux-ci","labels":["self-hosted","Linux","X64","proxmox","linux-ci"]}'
const browserRoute =
  '{"group":"playwright-isolated","labels":["self-hosted","Linux","X64","proxmox-playwright-x64"]}'

function setupSteps(): string[] {
  return [
    '      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
    '        with:',
    '          persist-credentials: false',
    '      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9',
    '        with:',
    '          version: 10.33.4',
    '          dest: ${{ runner.temp }}/setup-pnpm',
    '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    '        with:',
    `          node-version: ${NODE_VERSION}`,
    '          package-manager-cache: false',
    '      - name: Install workspace',
    '        env:',
    '          GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
    '        run: |',
    '          set -euo pipefail',
    '          test -n "$GH_PACKAGES_READ"',
    '          umask 077',
    '          auth_file="$(mktemp "${RUNNER_TEMP}/npmrc-auth.XXXXXX")"',
    '          trap \'rm -f "$auth_file"\' EXIT',
    '          printf \'//npm.pkg.github.com/:_authToken=%s\\n\' "$GH_PACKAGES_READ" > "$auth_file"',
    '          NPM_CONFIG_USERCONFIG="$auth_file" NPM_CONFIG_GLOBALCONFIG=/dev/null pnpm install --frozen-lockfile',
  ]
}

// The shared workflow invokes this before dependencies exist, then removes
// its exact ignored output on every install outcome. Exclusive creation also
// refuses stale files and symlinks instead of overwriting an unknown target.
export function createCiRegistryAuthScript(): string {
  return [
    "import { writeFileSync } from 'node:fs'",
    '',
    'const token = process.env.NARDUK_PLATFORM_GH_PACKAGES_READ?.trim()',
    'if (!token || /[\\r\\n]/u.test(token)) {',
    "  throw new Error('Missing or invalid NARDUK_PLATFORM_GH_PACKAGES_READ')",
    '}',
    '',
    "writeFileSync('.npmrc.auth', `//npm.pkg.github.com/:_authToken=${token}\\n`, {",
    '  mode: 0o600,',
    "  flag: 'wx',",
    '})',
    '',
  ].join('\n')
}

// GitHub Copilot's coding-agent environment runs this workflow once (on
// `workflow_dispatch`, dispatched by Copilot itself, never by a caller here)
// to prepare its own sandbox before it can see or run any other script.
// Reuses setupSteps() -- the same install sequence the public path's
// quality/browser jobs run on hosted GitHub runners -- because both need the
// same thing: a hosted `ubuntu-latest` sandbox with no self-hosted-runner
// access, installing from the standard NARDUK_PLATFORM_GH_PACKAGES_READ
// Actions secret. Emitted for BOTH visibilities: even a public app's Worker
// depends on private @narduk-enterprises/* packages, so Copilot needs
// registry auth to install regardless of the app's own CI runner policy
// (`runs-on: ubuntu-latest` here is a deliberate carve-out from "no
// GitHub-hosted CI for real work" -- Copilot's own sandbox prep is not the
// app's CI, the same reasoning that already applies to the reference app's
// copilot-setup-steps.yml on a private, self-hosted-CI repo). Its own
// `environment: copilot` job-level scope is unrelated to setupSteps()'s
// secret access.
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
    '    environment: copilot',
    '    timeout-minutes: 30',
    '    steps:',
    ...setupSteps(),
    '',
  ].join('\n')
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
      '  ci:',
      `    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@${workflowSha}`,
      '    permissions:',
      '      contents: read',
      '      packages: read',
      '    with:',
      `      runner: '${linuxRoute}'`,
      `      node-version: '${NODE_VERSION}'`,
      '      package-manager: pnpm',
      '      require-scripts: true',
      '      typecheck-worker-script: typecheck',
      "      typecheck-web-script: ''",
      // `build:ci` sets NARDUK_CLOUDFLARE_BUILD=1 (drops the local-only
      // nitro-cloudflare-dev module) and NITRO_PRESET=cloudflare_module, so
      // CI validates the actual deployable Worker shape instead of the dev
      // preset (matches the reference app's build-script input exactly).
      '      build-script: build:ci',
      // The public path runs `quality:static`, which already chains
      // `foundation:shared-ui-pinned` and `manifests:validate`. The private
      // path calls the shared workflow instead, so each check has to be
      // named here or CI never runs it. They read manifests only, so they
      // need no registry credential and are safe outside the token-scoped
      // install step (narduk-libs#282 review).
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
      '    secrets:',
      '      NARDUK_PLATFORM_GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
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
    '    timeout-minutes: 30',
    '    env:',
    '      NODE_OPTIONS: --max-old-space-size=3072',
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
    '    timeout-minutes: 30',
    '    env:',
    '      NODE_OPTIONS: --max-old-space-size=3072',
    '      PLAYWRIGHT_HTML_OPEN: never',
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
