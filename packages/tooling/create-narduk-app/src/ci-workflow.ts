import type { AppVisibility } from './types.js'

const workflowSha = '9070db7244649bf192d392a5b96eb1656997c84c'

// Resolved from fleet's organization routes. Creating files does not grant
// selected-repository membership; onboarding remains an explicit fleet action.
const linuxRoute =
  '{"group":"linux-ci","labels":["self-hosted","Linux","X64","proxmox","linux-ci"]}'
const browserRoute =
  '{"group":"playwright-isolated","labels":["self-hosted","Linux","X64","proxmox-playwright-x64"]}'

export function createCiWorkflow(visibility: AppVisibility): string {
  const header = [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '',
    'concurrency:',
    '  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    '  cancel-in-progress: true',
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
      "      node-version: '22.22.3'",
      '      package-manager: pnpm',
      '      require-scripts: true',
      '      typecheck-worker-script: typecheck',
      "      typecheck-web-script: ''",
      '      build-script: build',
      "      extra-scripts: 'format:check lint knip'",
      '      run-tests: true',
      '      test-script: test:unit',
      '      run-e2e: true',
      '      e2e-script: test:e2e',
      `      e2e-runner: '${browserRoute}'`,
      '      e2e-shards: 1',
      "      e2e-args: '--project=chromium --workers=1'",
      '      e2e-install-browsers: false',
      '      # The guest exports its immutable browser path; no caller override.',
      '    secrets:',
      '      NARDUK_PLATFORM_GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
      '',
    ].join('\n')
  }
  // Public callers cannot call the private organization workflow repository.
  // All their checks, including browser installation, stay GitHub-hosted.
  return [
    ...header,
    '  quality:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 30',
    '    steps:',
    '      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
    '        with:',
    '          persist-credentials: false',
    '      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9',
    '        with:',
    '          version: 10.33.4',
    '          dest: ${{ runner.temp }}/setup-pnpm',
    '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    '        with:',
    '          node-version: 22.22.3',
    '          cache: pnpm',
    '      - name: Install workspace',
    '        env:',
    '          GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
    '        run: |',
    '          set -euo pipefail',
    '          umask 077',
    '          test -n "$GH_PACKAGES_READ"',
    '          auth_file="$(mktemp "${RUNNER_TEMP}/npmrc-auth.XXXXXX")"',
    '          trap \'rm -f "$auth_file"\' EXIT',
    '          printf "//npm.pkg.github.com/:_authToken=%s\\n" "$GH_PACKAGES_READ" > "$auth_file"',
    '          NPM_CONFIG_USERCONFIG="$auth_file" NPM_CONFIG_GLOBALCONFIG=/dev/null pnpm install --frozen-lockfile',
    '      - run: pnpm exec playwright install --with-deps chromium',
    '      - run: pnpm run quality',
    '',
  ].join('\n')
}
