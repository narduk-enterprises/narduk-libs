import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = workflow.match(/^  cancel-after-contracts-failure:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1]
assert.ok(job, 'contracts failures must have a cancellation handler')
const condition = job.match(/if: >-\s*\$\{\{([\s\S]*?)\}\}/)?.[1]
assert.ok(condition, 'cancellation must have an explicit job condition')

// This expression uses only operators shared by JavaScript and Actions, on
// strings and booleans. The hosted failure canary verifies GitHub scheduling.
const selected = ({
  result = 'failure',
  cancelled = false,
  event = 'pull_request',
  actor = 'maintainer',
  headRepo = 'example/libs',
} = {}) =>
  runInNewContext(condition, {
    cancelled: () => cancelled,
    needs: { contracts: { result } },
    github: {
      actor,
      repository: 'example/libs',
      event_name: event,
      event:
        event === 'pull_request'
          ? {
              pull_request: { head: { repo: { full_name: headRepo } } },
            }
          : {},
    },
  })

test('only a failed contracts gate on a writable run selects cancellation', () => {
  assert.equal(selected(), true)
  // A cancelled run concludes "cancelled", which hides a red main: main runs to a failure.
  for (const event of ['push', 'workflow_dispatch']) assert.equal(selected({ event }), false)
  for (const result of ['success', 'cancelled', 'skipped', '']) {
    assert.equal(selected({ result }), false, result)
  }
  assert.equal(selected({ cancelled: true }), false)
  assert.equal(selected({ headRepo: 'contributor/libs' }), false)
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    assert.equal(selected({ actor: 'dependabot[bot]', event }), false)
  }
})

test('only the checkout-free cancellation job receives Actions write', () => {
  assert.match(job, /^    needs: \[contracts\]$/m)
  assert.match(job, /^    permissions:\n      actions: write\n    steps:/m)
  assert.doesNotMatch(job, /uses:|checkout@|secrets\.|continue-on-error/)
  assert.match(job, /GH_TOKEN: \$\{\{ github.token \}\}/)
  assert.equal((workflow.match(/actions: write/g) ?? []).length, 1)
})

test('the shipped cancellation command targets only its own run and propagates API failure', () => {
  const shell = job
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
  const directory = mkdtempSync(join(tmpdir(), 'contracts-cancel-'))
  try {
    writeFileSync(
      join(directory, 'gh'),
      '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "${CANARY_EXIT:-0}"\n',
      { mode: 0o755 },
    )
    const run = (code = '0') =>
      spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GH_TOKEN: 'offline-test',
          GITHUB_REPOSITORY: 'example/libs',
          GITHUB_RUN_ID: '123456',
          CANARY_EXIT: code,
        },
        encoding: 'utf8',
      })
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /\napi\n--method\nPOST\nrepos\/example\/libs\/actions\/runs\/123456\/cancel\n$/,
    )
    assert.equal(run('47').status, 47)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
