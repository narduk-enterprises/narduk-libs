import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { annotate, recheckDecision } from './recheck-release-main.mjs'

const verifiedSha = 'a'.repeat(40)
const tip = 'b'.repeat(40)
const repository = 'narduk-enterprises/narduk-libs'
const own = { id: 900, status: 'in_progress' }
const decide = (overrides) =>
  recheckDecision({
    verifiedSha,
    tip,
    ci: undefined,
    releaseRuns: [own],
    ownRunId: '900',
    ...overrides,
  })

test('main still at the verified commit: nothing to hand on, nothing to say', () => {
  const decision = decide({ tip: verifiedSha })
  assert.deepEqual(decision, { kind: 'current' })
  assert.equal(annotate(decision, { verifiedSha, tip: verifiedSha, repository }), '')
})

test('a green tip with no queued Release run is dispatched, not skipped in silence', () => {
  const decision = decide({ ci: { id: 1, status: 'completed', conclusion: 'success' } })
  assert.deepEqual(decision, { kind: 'dispatch' })
  assert.match(
    annotate(decision, { verifiedSha, tip, repository }),
    /^::notice .*verified-sha=b{40}/u,
  )
})

test('never dispatches into a busy group: a queued Release run takes main forward', () => {
  const decision = decide({
    ci: { id: 1, status: 'completed', conclusion: 'success' },
    releaseRuns: [own, { id: 901, status: 'queued' }, { id: 899, status: 'completed' }],
  })
  assert.deepEqual(decision, { kind: 'queued', runIds: [901] })
})

test('its own in-progress run does not count as busy', () => {
  assert.equal(
    decide({ ci: { id: 1, status: 'completed', conclusion: 'success' } }).kind,
    'dispatch',
  )
})

test('a tip whose CI is still running, or not started, is left to that CI', () => {
  assert.equal(decide({ ci: { id: 1, status: 'in_progress', conclusion: null } }).kind, 'wait-ci')
  const decision = decide({})
  assert.equal(decision.kind, 'wait-ci')
  assert.match(annotate(decision, { verifiedSha, tip, repository }), /push CI is not started/u)
})

test('a red tip warns loudly with the CI run and the dispatch command', () => {
  const decision = decide({ ci: { id: 77, status: 'completed', conclusion: 'failure' } })
  assert.equal(decision.kind, 'warn')
  const line = annotate(decision, { verifiedSha, tip, repository })
  assert.match(line, /^::warning title=Release not prepared for main::/u)
  assert.match(line, /CI run 77 concluded failure/u)
  assert.match(
    line,
    /gh workflow run release\.yml --repo narduk-enterprises\/narduk-libs -f verified-sha=b{40}/u,
  )
})

test('release.yml runs the re-check whenever the verified commit was not current main', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /current: \$\{\{ steps\.main-state\.outputs\.current \}\}/u)
  const job = workflow.split('\n  recheck-main:\n')[1]?.split('\n\n')[0]
  assert.ok(job, 'release.yml is missing the recheck-main job')
  assert.match(job, /needs: \[verify-ci, release\]/u)
  assert.match(job, /if: needs\.release\.outputs\.current != 'true'/u)
  assert.match(job, /actions: write/u)
  assert.match(job, /run: node scripts\/recheck-release-main\.mjs/u)
  assert.doesNotMatch(job, /pnpm install|npm-release/u)
})
