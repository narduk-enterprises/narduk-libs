import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertConsumerDependencyScope,
  consumerDependencyNames,
  consumerSmokeGenerator,
  consumerSmokeManifests,
} from './consumer-smoke-fixture.mjs'
import { computeAffectedSet, loadWorkspace } from './compute-affected-packages.mjs'

const scope = '@narduk-enterprises/'
const workspace = loadWorkspace()

test('unrelated published packages keep artifact checks without a generated app', () => {
  for (const name of ['geogrid-web', 'narduk-charts', 'narduk-postgres', 'narduk-ui']) {
    const entry = workspace.byName.get(`${scope}${name}`)
    const plan = computeAffectedSet({ changedFiles: [`${entry.relativeDirectory}/src/index.ts`] })
    assert.equal(plan.packedConsumer, true, name)
    assert.equal(plan.generatedConsumer, false, name)
    assert.ok(plan.affectedNames.includes(entry.name))
  }
})

test('every generated dependency and generator selects the full app', () => {
  for (const name of consumerDependencyNames(workspace)) {
    const entry = workspace.byName.get(name)
    const plan = computeAffectedSet({ changedFiles: [`${entry.relativeDirectory}/src/index.ts`] })
    assert.equal(plan.packedConsumer, true, name)
    assert.equal(plan.generatedConsumer, true, name)
  }
  const plan = computeAffectedSet({
    changedFiles: [
      'packages/design/narduk-charts/src/index.ts',
      'packages/modules/narduk-core/src/index.ts',
    ],
  })
  assert.equal(plan.generatedConsumer, true)
})

test('shared, unknown and manual inputs keep full proof; docs and tests remain cheap', () => {
  for (const path of [
    'pnpm-lock.yaml',
    'package.json',
    'scripts/release-packages.mjs',
    '.github/workflows/ci.yml',
    'new-config/unknown.yaml',
  ]) {
    const plan = computeAffectedSet({ changedFiles: [path] })
    assert.equal(plan.generatedConsumer, true, path)
  }
  assert.equal(computeAffectedSet({ changedFiles: [], forceAll: true }).generatedConsumer, true)
  for (const path of [
    'docs/releases.md',
    '.changeset/update.md',
    'packages/modules/narduk-core/tests/module.test.ts',
    'packages/design/design-system-build/app.vue',
  ]) {
    const plan = computeAffectedSet({ changedFiles: [path] })
    assert.equal(plan.packedConsumer, false, path)
    assert.equal(plan.generatedConsumer, false, path)
  }
})

test('dependency scope includes peers, optional deps, private build inputs and cycles', () => {
  const byName = new Map([
    [consumerSmokeGenerator, { manifest: {} }],
    [
      `${scope}runtime`,
      {
        manifest: {
          devDependencies: { [`${scope}compiler`]: 'workspace:*' },
          optionalDependencies: { [`${scope}optional`]: 'workspace:*' },
          peerDependencies: { [`${scope}peer`]: '*' },
        },
      },
    ],
    [
      `${scope}compiler`,
      { manifest: { private: true, dependencies: { [`${scope}runtime`]: '*' } } },
    ],
    [`${scope}optional`, { manifest: {} }],
    [`${scope}peer`, { manifest: {} }],
    [`${scope}unused`, { manifest: {} }],
  ])
  const manifests = [
    {
      dependencies: { [`${scope}runtime`]: '1.0.0' },
      pnpm: { overrides: { [`${scope}unused`]: '1.0.0' } },
    },
  ]
  assert.deepEqual(
    consumerDependencyNames({ byName }, manifests),
    [
      consumerSmokeGenerator,
      ...['compiler', 'optional', 'peer', 'runtime'].map((n) => `${scope}${n}`),
    ].sort(),
  )
  assert.throws(
    () => consumerDependencyNames({ byName }, [{ dependencies: { [`${scope}missing`]: '1.0.0' } }]),
    /missing from the workspace/,
  )
})

test('a packed generator introducing an unplanned dependency cannot silently skip integration', () => {
  const manifests = consumerSmokeManifests(workspace)
  assert.doesNotThrow(() => assertConsumerDependencyScope(workspace, manifests))
  manifests[1].dependencies[`${scope}narduk-charts`] = workspace.byName.get(
    `${scope}narduk-charts`,
  ).manifest.version
  assert.throws(
    () => assertConsumerDependencyScope(workspace, manifests),
    /differ from the planned fixture/,
  )
})

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const step = workflow.split(
  '      - name: Prove packed artifacts and applicable generated app integration\n',
)[1]
const shell = step
  .split('        run: |\n')[1]
  .split('\n\n')[0]
  .split('\n')
  .map((line) => line.slice(10))
  .join('\n')

test('the shipped consumer step runs the selected proof and propagates failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'consumer-selection-'))
  try {
    writeFileSync(
      join(directory, 'pnpm'),
      '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "${CANARY_EXIT:-0}"\n',
      { mode: 0o755 },
    )
    const run = (selection, code = '0') =>
      spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GENERATED_CONSUMER: selection,
          CANARY_EXIT: code,
        },
        encoding: 'utf8',
      })
    assert.match(run('true').stdout, /--install-browser/)
    assert.match(run('false').stdout, /--artifacts-only/)
    assert.doesNotMatch(run('false').stdout, /--install-browser/)
    assert.equal(run('true', '47').status, 47)
    assert.equal(run('false', '47').status, 47)
    assert.notEqual(run('').status, 0)
    assert.notEqual(run('unknown').status, 0)
    assert.match(
      workflow,
      /name: Retain the exact installed consumer proof\n        if: needs\.affected\.outputs\.generated-consumer == 'true'/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the shipped planner keeps release PRs, release commits and manual runs full', () => {
  const planner = workflow.split(
    '      - name: Compute changed packages and transitive dependents\n',
  )[1]
  const body = planner
    .split('        run: |\n')[1]
    .split('\n\n')[0]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
  const directory = mkdtempSync(join(tmpdir(), 'consumer-release-selection-'))
  try {
    writeFileSync(join(directory, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
    const run = (env) =>
      spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          EVENT_NAME: 'pull_request',
          PR_HEAD_REF: 'feature',
          PUSH_MESSAGE: '',
          PR_BASE_SHA: 'base',
          PR_HEAD_SHA: 'head',
          PUSH_BASE_SHA: 'before',
          PUSH_HEAD_SHA: 'after',
          GITHUB_OUTPUT: '/dev/null',
          GITHUB_STEP_SUMMARY: '/dev/null',
          ...env,
        },
        encoding: 'utf8',
      })
    assert.match(run({}).stdout, /--base\nbase\n--head\nhead/)
    for (const env of [
      { PR_HEAD_REF: 'changeset-release/main' },
      { EVENT_NAME: 'push', PUSH_MESSAGE: 'chore: release packages\n\nVersion updates' },
      { EVENT_NAME: 'workflow_dispatch' },
      { EVENT_NAME: 'push', PUSH_BASE_SHA: '0000000000000000000000000000000000000000' },
    ]) {
      const result = run(env)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /--all/)
      assert.doesNotMatch(result.stdout, /--base/)
    }
    assert.match(run({ EVENT_NAME: 'push' }).stdout, /--base\nbefore\n--head\nafter/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
