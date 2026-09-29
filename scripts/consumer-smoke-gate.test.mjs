import assert from 'node:assert/strict'
import test from 'node:test'

import { loadWorkspace } from './compute-affected-packages.mjs'
import {
  assertUpgradeRestoredGate,
  expectedFoundationVerdicts,
  loadYamlParser,
  openSubChecks,
  passingVerdict,
  probeOutputMismatch,
  readRepositoryGate,
  requiredArtefactPath,
  scriptArtefactPath,
  splitJsonReport,
  toPreGatePrivateCaller,
  toPreGatePublicWorkflow,
  verdictMismatch,
  withoutParityGateScripts,
} from './consumer-smoke-gate.mjs'
import { scaffoldOnlyPhases } from './consumer-smoke-phases.mjs'

const parseYaml = loadYamlParser(
  loadWorkspace().byName.get('@narduk-enterprises/create-narduk-app').directory,
)

// The gate lines below are verbatim from create-narduk-app's emitted ci.yml
// (codex/buoys-nac-parity); the rest of each workflow is trimmed.
const privateCi = `jobs:
  ci:
    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@59825ef
    with:
      build-script: build:ci
      extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned foundation:check:coverage foundation:check:toolchain foundation:check:deployment'
      run-tests: true
      foundation-check: true
      quality-level: standard
      performance-budget-args: '--app-dir apps/web --font-total-budget-kb 140'
`

const publicCi = `jobs:
  quality:
    steps:
      - name: Install workspace
        run: pnpm install --frozen-lockfile
      - run: pnpm run quality:static
      # Web foundation items 1-7 are not run here: a public repository
      # cannot call the shared class callable, so foundation:check sub-check
      # 5.1 is UNKNOWN in this app's own CI by specification
      # (company-hq WEB-FOUNDATION-CHECK.md item 5). The company-hq rollup
      # decides items 1-7 for a public app.
      - name: Repository gate (web foundation items 8, 9, 11 and 12)
        run: |
          set -euo pipefail
          pnpm run foundation:shared-ui-pinned
          pnpm run foundation:check:coverage
          pnpm run foundation:check:toolchain
          pnpm run foundation:check:deployment
      - name: Security headers of this commit's built Worker (web foundation item 10)
        env:
          CANDIDATE_PORT: 8790
        run: |
          set -euo pipefail
          pnpm exec narduk-app foundation:check:security-headers --base-url "http://127.0.0.1:$CANDIDATE_PORT"

  browser:
    needs: quality
`

const packageJson = `${JSON.stringify(
  {
    name: 'fixture',
    scripts: {
      'foundation:check':
        'mkdir -p foundation-check && narduk-app foundation:check --checkout . --json foundation-check/foundation-check.json',
      'foundation:check:coverage':
        'mkdir -p foundation-check && narduk-app foundation:check:coverage --checkout . --json foundation-check/coverage.json',
      'foundation:check:deployment':
        'mkdir -p foundation-check && narduk-app foundation:check:deployment --checkout . --json foundation-check/deployment.json',
      'foundation:check:toolchain':
        'mkdir -p foundation-check && narduk-app foundation:check:toolchain --checkout . --json foundation-check/toolchain.json',
      'foundation:shared-ui-pinned': 'pnpm --filter web run foundation:shared-ui-pinned',
    },
  },
  null,
  2,
)}\n`

test('the pre-gate private caller loses the parity scripts and the quality level', () => {
  const legacy = toPreGatePrivateCaller(privateCi)
  assert.match(
    legacy,
    /^ {6}extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned'$/mu,
  )
  assert.doesNotMatch(legacy, /quality-level/u)
  // Everything else is untouched.
  assert.match(legacy, /foundation-check: true\n {6}performance-budget-args:/u)
  assert.throws(() => readRepositoryGate(legacy, 'private', parseYaml), /lacks foundation:check/u)
})

test('regressing a shape the generator no longer emits fails closed', () => {
  assert.throws(() => toPreGatePrivateCaller(toPreGatePrivateCaller(privateCi)), /none of/u)
  assert.throws(
    () => toPreGatePrivateCaller(privateCi.replace(/'(format:check[^']*)'/u, '$1')),
    /expected one single-quoted/u,
  )
  assert.throws(
    () => toPreGatePrivateCaller(privateCi.replace('quality-level: standard', 'quality-level: x')),
    /quality-level/u,
  )
  assert.throws(() => toPreGatePublicWorkflow(toPreGatePublicWorkflow(publicCi)), /no gate steps/u)
})

test('the pre-gate public workflow ends its quality job at quality:static', () => {
  const legacy = toPreGatePublicWorkflow(publicCi)
  assert.equal(
    legacy,
    `jobs:
  quality:
    steps:
      - name: Install workspace
        run: pnpm install --frozen-lockfile
      - run: pnpm run quality:static

  browser:
    needs: quality
`,
  )
  assert.throws(() => readRepositoryGate(legacy, 'public', parseYaml), /found 0/u)
})

test('only the parity scripts leave package.json', () => {
  const scripts = JSON.parse(withoutParityGateScripts(packageJson)).scripts
  assert.deepEqual(Object.keys(scripts), ['foundation:check', 'foundation:shared-ui-pinned'])
  assert.throws(() => withoutParityGateScripts(withoutParityGateScripts(packageJson)), /no /u)
})

test('the private gate is every extra-scripts name but style checks, plus foundation:check', () => {
  const gate = readRepositoryGate(privateCi, 'private', parseYaml, scaffoldOnlyPhases)
  assert.deepEqual(gate.scripts, [
    'manifests:validate',
    'foundation:shared-ui-pinned',
    'foundation:check:coverage',
    'foundation:check:toolchain',
    'foundation:check:deployment',
  ])
  assert.equal(gate.runsFoundationCheck, true)
  assert.throws(
    () =>
      readRepositoryGate(
        privateCi.replace('foundation-check: true', 'foundation-check: false'),
        'private',
        parseYaml,
      ),
    /foundation-check: true/u,
  )
  assert.throws(
    () =>
      readRepositoryGate(
        privateCi.replace('quality-level: standard', 'quality-level: legacy'),
        'private',
        parseYaml,
      ),
    /quality-level: standard/u,
  )
})

test('the public gate is the two emitted steps, verbatim', () => {
  const gate = readRepositoryGate(publicCi, 'public', parseYaml)
  assert.equal(gate.runsFoundationCheck, false)
  assert.deepEqual(
    gate.steps.map((step) => step.name),
    [
      'Repository gate (web foundation items 8, 9, 11 and 12)',
      "Security headers of this commit's built Worker (web foundation item 10)",
    ],
  )
  assert.equal(
    gate.steps[0].run,
    'set -euo pipefail\npnpm run foundation:shared-ui-pinned\npnpm run foundation:check:coverage\npnpm run foundation:check:toolchain\npnpm run foundation:check:deployment\n',
  )
  assert.deepEqual(gate.steps[1].env, { CANDIDATE_PORT: 8790 })
  assert.throws(
    () =>
      readRepositoryGate(
        publicCi.replace('          pnpm run foundation:check:toolchain\n', ''),
        'public',
        parseYaml,
      ),
    /runs foundation:shared-ui-pinned, foundation:check:coverage, foundation:check:deployment/u,
  )
  assert.throws(
    () =>
      readRepositoryGate(
        publicCi.replace('foundation:check:security-headers', 'foundation:check:nothing'),
        'public',
        parseYaml,
      ),
    /item-10 step/u,
  )
  assert.throws(
    () =>
      readRepositoryGate(
        publicCi.replace('          CANDIDATE_PORT: 8790\n', ''),
        'public',
        parseYaml,
      ),
    /no CANDIDATE_PORT/u,
  )
})

// Verbatim shape of `foundation:check:security-headers` output (narduk-app-tools
// 0.27.2) from the item-10 step in the first full local round trip.
const probeOutput = (port, status = '200', result = 'PASS') =>
  [
    'foundation:check:security-headers -- unknown/unknown',
    '  contract   narduk-core `security.headers` preset (narduk-enterprises/company-hq#745)',
    `  probed     http://127.0.0.1:${port}/ -> ${status}`,
    `  [${result}] item 10 security-headers`,
    '',
    `RESULT: ${result}`,
  ].join('\n')

test('item 10 counts only as a PASS read from the candidate port', () => {
  assert.equal(probeOutputMismatch(probeOutput(51527), '51527'), '')
  assert.match(
    probeOutputMismatch(probeOutput(8790), '51527'),
    /not the candidate on 127\.0\.0\.1:51527/u,
  )
  assert.match(probeOutputMismatch(probeOutput(51527, '503'), '51527'), /answered 503/u)
  assert.match(
    probeOutputMismatch(probeOutput(51527, '200', 'UNKN'), '51527'),
    /item 10 is not PASS; RESULT is not PASS/u,
  )
  assert.match(probeOutputMismatch('RESULT: PASS', '51527'), /no probed route/u)
  assert.match(
    probeOutputMismatch(
      probeOutput(51527).replace('http://127.0.0.1:51527/', 'https://app.example/'),
      '51527',
    ),
    /probed https:\/\/app\.example\//u,
  )
})

const report = (status, applied = true) => ({
  changes: [
    { path: '.github/workflows/ci.yml', status, applied },
    { path: 'package.json', status: 'drift', applied: true },
  ],
})

test('the upgrade must rewrite both units and give back the generated gate', () => {
  const generated = { ci: privateCi, packageJson }
  assert.deepEqual(
    assertUpgradeRestoredGate({
      report: report('drift'),
      generated,
      upgraded: generated,
      parseYaml,
    }),
    { byteIdentical: true },
  )
  // The same YAML with a different layout is the same gate.
  assert.deepEqual(
    assertUpgradeRestoredGate({
      report: report('drift'),
      generated,
      upgraded: {
        ci: privateCi
          .replace("'format:check", '"format:check')
          .replace("deployment'", 'deployment"'),
        packageJson,
      },
      parseYaml,
    }),
    { byteIdentical: false },
  )
  // Where upgrade puts quality-level (top of `with:`, observed from the packed
  // generator in the first local round trip) does not change the gate.
  const reordered = privateCi
    .replace('      quality-level: standard\n', '')
    .replace('    with:\n', '    with:\n      quality-level: standard\n')
  assert.notEqual(reordered, privateCi)
  assert.deepEqual(
    assertUpgradeRestoredGate({
      report: report('drift'),
      generated,
      upgraded: { ci: reordered, packageJson },
      parseYaml,
    }),
    { byteIdentical: false },
  )
  for (const [changes, pattern] of [
    [report('clean', false), /did not rewrite \.github\/workflows\/ci\.yml/u],
    [report('unresolved'), /status unresolved/u],
    [report('drift', false), /applied false/u],
  ]) {
    assert.throws(
      () =>
        assertUpgradeRestoredGate({ report: changes, generated, upgraded: generated, parseYaml }),
      pattern,
    )
  }
  assert.throws(
    () =>
      assertUpgradeRestoredGate({
        report: report('drift'),
        generated,
        upgraded: { ci: toPreGatePrivateCaller(privateCi), packageJson },
        parseYaml,
      }),
    /does not mean what a fresh scaffold's does/u,
  )
  assert.throws(
    () =>
      assertUpgradeRestoredGate({
        report: report('drift'),
        generated,
        upgraded: { ci: privateCi, packageJson: withoutParityGateScripts(packageJson) },
        parseYaml,
      }),
    /scripts differ/u,
  )
})

test('the upgrade report is read structurally; only what surrounds it is scanned', () => {
  const printed = `{\n  "driftCount": 0,\n  "diff": "+ echo \\"::error::never answered\\""\n}\n`
  assert.deepEqual(splitJsonReport(printed), {
    report: { driftCount: 0, diff: '+ echo "::error::never answered"' },
    rest: '\n',
  })
  assert.equal(splitJsonReport(`WARN something\n${printed}`).rest, 'WARN something\n\n')
  assert.throws(() => splitJsonReport('no report'), /no JSON report/u)
})

test('artefact paths come from the script body', () => {
  const scripts = JSON.parse(packageJson).scripts
  assert.equal(
    scriptArtefactPath(scripts['foundation:check:coverage']),
    'foundation-check/coverage.json',
  )
  assert.equal(scriptArtefactPath(scripts['foundation:shared-ui-pinned']), null)
})

test('a verdict script must exist and write an artefact', () => {
  const scripts = JSON.parse(packageJson).scripts
  assert.equal(requiredArtefactPath(scripts, 'foundation:shared-ui-pinned'), null)
  assert.equal(
    requiredArtefactPath(scripts, 'foundation:check:toolchain'),
    'foundation-check/toolchain.json',
  )
  assert.throws(() => requiredArtefactPath(scripts, 'foundation:nothing'), /no foundation:nothing/u)
  assert.throws(
    () =>
      requiredArtefactPath(
        { ...scripts, 'foundation:check:coverage': 'narduk-app foundation:check:coverage' },
        'foundation:check:coverage',
      ),
    /writes no --json artefact/u,
  )
})

// Shaped like narduk-app-tools' artefacts: foundation:check has items[], the
// item checks (coverage, toolchain, deployment) have one item.
const foundationArtefact = (overrides = {}) => ({
  result: 'UNKNOWN',
  exitCode: 2,
  items: [
    {
      id: 1,
      checks: [
        { id: '1.1', status: 'pass', detail: '' },
        { id: '1.5', status: 'not-applicable', detail: 'no D1 binding' },
      ],
    },
    {
      id: 5,
      checks: [
        {
          id: '5.1',
          status: 'unknown',
          detail:
            "no callable found in .github/workflows, and an app's own CI cannot read company-hq's APP_REGISTRY.yaml foundation_exception, so the rollup decides (spec §3 item 5)",
          ...overrides,
        },
      ],
    },
  ],
})

test('the public foundation verdict is exactly 5.1 UNKNOWN', () => {
  const expected = expectedFoundationVerdicts.public
  assert.deepEqual(openSubChecks(foundationArtefact()), { 5.1: 'unknown' })
  assert.equal(
    verdictMismatch({ label: 'x', artefact: foundationArtefact(), exitCode: 2, expected }),
    '',
  )
  // 5.1 closing (policy change) must be a deliberate edit, not a silent pass.
  const closed = { ...foundationArtefact({ status: 'pass' }), result: 'PASS', exitCode: 0 }
  assert.match(
    verdictMismatch({ label: 'x', artefact: closed, exitCode: 0, expected }),
    /result PASS, expected UNKNOWN; exit 0, expected 2; sub-check 5\.1 is pass\/not-applicable, expected unknown/u,
  )
  // A second open sub-check, or 5.1 failing, is a mismatch too.
  const wider = foundationArtefact()
  wider.items[0].checks[1] = { id: '1.5', status: 'fail', detail: 'placeholder database_id' }
  assert.match(
    verdictMismatch({ label: 'x', artefact: wider, exitCode: 2, expected }),
    /sub-check 1\.5 is fail, expected pass\/not-applicable \(placeholder database_id\)/u,
  )
  // Still UNKNOWN on 5.1, but for a reason other than the cross-repo matrix.
  assert.match(
    verdictMismatch({
      label: 'x',
      artefact: foundationArtefact({ detail: 'could not read .github/workflows' }),
      exitCode: 2,
      expected,
    }),
    /sub-check 5\.1 is unknown for another reason: could not read/u,
  )
})

test('the private verdict pins the D1 placeholder and nothing else', () => {
  const artefact = foundationArtefact({ status: 'pass' })
  artefact.result = 'FAIL'
  const placeholder =
    '1 D1 binding(s) in apps/web/wrangler.jsonc still carry the scaffold placeholder database_id 00000000-0000-0000-0000-000000000000: d1_databases[0] (DB). The Worker builds and deploys with it, and every request that touches the database fails. Run narduk-app db create.'
  artefact.items[0].checks[1] = { id: '1.5', status: 'fail', detail: placeholder }
  const expected = expectedFoundationVerdicts.private
  assert.equal(verdictMismatch({ label: 'x', artefact, exitCode: 1, expected }), '')
  // A 1.5 FAIL for anything but the fixture's one placeholder binding is not
  // the known result: a second binding, another id, or another file.
  for (const detail of [
    placeholder.replace('1 D1 binding(s)', '2 D1 binding(s)'),
    placeholder.replace('00000000-0000-0000-0000-000000000000', 'deadbeef'),
    placeholder.replace('d1_databases[0] (DB)', 'd1_databases[0] (DB), d1_databases[1] (CACHE)'),
    'apps/web/wrangler.jsonc could not be parsed',
  ]) {
    artefact.items[0].checks[1] = { id: '1.5', status: 'fail', detail }
    assert.match(
      verdictMismatch({ label: 'x', artefact, exitCode: 1, expected }),
      /sub-check 1\.5 is fail for another reason/u,
      detail,
    )
  }
  // Right detail, wrong exit: still a mismatch.
  artefact.items[0].checks[1] = { id: '1.5', status: 'fail', detail: placeholder }
  assert.match(
    verdictMismatch({ label: 'x', artefact, exitCode: 2, expected }),
    /exit 2, expected 1/u,
  )
})

test('an item check passes only on PASS with nothing open', () => {
  const coverage = {
    result: 'PASS',
    item: {
      checks: [
        { id: '9.6', status: 'not-applicable', detail: '' },
        { id: '9.7', status: 'not-applicable', detail: '' },
      ],
    },
  }
  assert.equal(
    verdictMismatch({ label: 'x', artefact: coverage, exitCode: 0, expected: passingVerdict }),
    '',
  )
  coverage.item.checks.push({ id: '9.2', status: 'unknown', detail: 'heuristic' })
  coverage.result = 'UNKNOWN'
  assert.match(
    verdictMismatch({ label: 'x', artefact: coverage, exitCode: 2, expected: passingVerdict }),
    /result UNKNOWN, expected PASS; exit 2, expected 0; sub-check 9\.2 is unknown/u,
  )
  assert.throws(
    () => openSubChecks({ item: { checks: [coverage.item.checks[2], coverage.item.checks[2]] } }),
    /appears twice/u,
  )
})
