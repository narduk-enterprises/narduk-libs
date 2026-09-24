import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  compareVersions,
  githubDecision,
  mirrorRegistry,
  packumentUrl,
  partition,
  proveGithubPackages,
  readStates,
  releaseTargets,
  versionState,
  waitForRegistry,
} from './prove-release-publication.mjs'

const minute = 60_000
const registry = 'https://npm.pkg.github.com'
const manifest = (name, version, extra = {}) => ({
  name,
  version,
  publishConfig: { registry },
  ...extra,
})
const core = { name: '@narduk-enterprises/narduk-core', version: '2.2.5' }
const tools = { name: '@narduk-enterprises/narduk-app-tools', version: '0.9.2' }
const packument = (versions, latest = versions.at(-1)) => ({
  versions: Object.fromEntries(versions.map((version) => [version, {}])),
  'dist-tags': { latest },
})

test('release targets are exactly the publishable versions the commit changed', () => {
  const before = new Map([
    ['@narduk-enterprises/narduk-core', manifest('@narduk-enterprises/narduk-core', '2.2.4')],
    ['@narduk-enterprises/narduk-seo', manifest('@narduk-enterprises/narduk-seo', '1.0.0')],
    ['@narduk-enterprises/fixture', manifest('@narduk-enterprises/fixture', '0.0.1')],
  ])
  const after = new Map([
    ['@narduk-enterprises/narduk-core', manifest('@narduk-enterprises/narduk-core', '2.2.5')],
    ['@narduk-enterprises/narduk-seo', manifest('@narduk-enterprises/narduk-seo', '1.0.0')],
    [
      '@narduk-enterprises/fixture',
      manifest('@narduk-enterprises/fixture', '0.0.2', { private: true }),
    ],
    ['@narduk-enterprises/narduk-new', manifest('@narduk-enterprises/narduk-new', '0.1.0')],
    ['@narduk-enterprises/elsewhere', { name: '@narduk-enterprises/elsewhere', version: '3.0.0' }],
    ['other-scope', manifest('other-scope', '9.0.0')],
  ])
  assert.deepEqual(releaseTargets(before, after), [
    { name: '@narduk-enterprises/narduk-core', version: '2.2.5', previous: '2.2.4' },
    { name: '@narduk-enterprises/narduk-new', version: '0.1.0', previous: null },
  ])
  assert.deepEqual(releaseTargets(after, after), [])
})

test('version ordering covers numeric parts and prereleases', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.throws(() => compareVersions('latest', '1.0.0'), /Unparseable/u)
})

test('a missing version is superseded only when latest is already newer', () => {
  assert.equal(versionState(packument(['2.2.4', '2.2.5']), '2.2.5'), 'present')
  assert.equal(versionState(packument(['2.2.4']), '2.2.5'), 'missing')
  assert.equal(versionState(packument(['2.2.4', '2.2.6']), '2.2.5'), 'superseded')
  assert.equal(versionState(undefined, '1.0.0'), 'missing')
})

test('packument URLs encode the scope separator and reject foreign names', () => {
  assert.equal(
    packumentUrl(mirrorRegistry, core.name),
    'https://npm.nard.uk/@narduk-enterprises%2fnarduk-core',
  )
  assert.throws(() => packumentUrl(registry, '@evil/pkg'), /Unexpected package name/u)
  assert.throws(() => packumentUrl(registry, '@narduk-enterprises/../x'), /Unexpected/u)
})

test('registry reads treat 404 as missing and fail closed on any other error', async () => {
  const seen = []
  const request = async (url, init) => {
    seen.push([url, init.headers.Authorization])
    if (url.endsWith('narduk-core')) return Response.json(packument(['2.2.4', '2.2.5']))
    return new Response('not found', { status: 404 })
  }
  const states = await readStates({ registry, targets: [core, tools], token: 't0k', request })
  assert.deepEqual(
    [...states],
    [
      ['@narduk-enterprises/narduk-core@2.2.5', 'present'],
      ['@narduk-enterprises/narduk-app-tools@0.9.2', 'missing'],
    ],
  )
  assert.equal(seen[0][1], 'Bearer t0k')

  const anonymous = await readStates({ registry: mirrorRegistry, targets: [core], request })
  assert.equal(anonymous.size, 1)
  assert.equal(seen.at(-1)[1], undefined)

  await assert.rejects(
    readStates({
      registry,
      targets: [core],
      token: 't0k',
      request: async () => new Response('denied', { status: 403 }),
    }),
    /answered 403 for @narduk-enterprises\/narduk-core; cannot prove it/u,
  )
})

const decide = (overrides) =>
  githubDecision({
    byState: { present: [], superseded: [], missing: [core] },
    elapsed: 30 * minute,
    graceMs: 20 * minute,
    deadlineMs: 75 * minute,
    dispatchedAt: undefined,
    settleAfterDispatchMs: 5 * minute,
    ci: { id: 1, status: 'completed', conclusion: 'success' },
    releaseBusy: false,
    ...overrides,
  })

test('the GitHub Packages decision only re-dispatches an idle, green, unsuperseded release', () => {
  assert.equal(decide({ byState: { present: [core], superseded: [], missing: [] } }).kind, 'done')
  assert.equal(decide({ elapsed: 5 * minute }).kind, 'wait')
  assert.equal(decide({ ci: undefined }).kind, 'wait')
  assert.equal(decide({ ci: { id: 1, status: 'in_progress' } }).kind, 'wait')
  assert.equal(decide({ releaseBusy: true }).kind, 'wait')
  assert.equal(decide({}).kind, 'dispatch')

  const red = decide({ ci: { id: 7, status: 'completed', conclusion: 'failure' } })
  assert.equal(red.kind, 'fail')
  assert.match(red.reason, /push CI run 7 for this commit concluded failure/u)

  const overtaken = decide({ byState: { present: [], superseded: [tools], missing: [core] } })
  assert.equal(overtaken.kind, 'fail')
  assert.match(overtaken.reason, /narduk-app-tools@0\.9\.2.*latest backwards/u)

  assert.equal(decide({ dispatchedAt: 28 * minute, releaseBusy: true }).kind, 'wait')
  assert.equal(decide({ dispatchedAt: 28 * minute }).kind, 'wait')
  assert.match(decide({ dispatchedAt: 20 * minute }).reason, /re-dispatched Release run finished/u)
  assert.match(decide({ elapsed: 75 * minute }).reason, /after 75 min/u)
})

test('only-superseded targets pass with the superseded list reported', () => {
  const result = decide({ byState: { present: [core], superseded: [tools], missing: [] } })
  assert.equal(result.kind, 'done')
  assert.deepEqual(
    partition([core, tools], new Map([[`${core.name}@${core.version}`, 'present']])),
    {
      present: [core],
      superseded: [],
      missing: [tools],
    },
  )
})

function fakeClock() {
  let now = 0
  return { now: () => now, sleep: async (ms) => void (now += ms) }
}

const statesFrom = (entries) =>
  new Map(entries.map(([target, state]) => [`${target.name}@${target.version}`, state]))

test('a lost publish is re-dispatched exactly once and then proven', async () => {
  const clock = fakeClock()
  let dispatches = 0
  const result = await proveGithubPackages({
    targets: [core],
    ...clock,
    readRegistry: async () =>
      statesFrom([[core, dispatches > 0 && clock.now() >= 25 * minute ? 'present' : 'missing']]),
    readCi: async () => ({ id: 3, status: 'completed', conclusion: 'success' }),
    readReleaseBusy: async () => dispatches > 0 && clock.now() < 25 * minute,
    dispatch: async () => void (dispatches += 1),
  })
  assert.equal(dispatches, 1)
  assert.equal(result.failure, undefined)
  assert.equal(result.dispatched, true)
  assert.deepEqual(result.present, [core])
})

test('a publish that never lands fails with the exact missing versions after one dispatch', async () => {
  const clock = fakeClock()
  let dispatches = 0
  const result = await proveGithubPackages({
    targets: [core, tools],
    ...clock,
    readRegistry: async () =>
      statesFrom([
        [core, 'present'],
        [tools, 'missing'],
      ]),
    readCi: async () => ({ id: 3, status: 'completed', conclusion: 'success' }),
    readReleaseBusy: async () => false,
    dispatch: async () => void (dispatches += 1),
  })
  assert.equal(dispatches, 1)
  assert.deepEqual(result.missing, [tools])
  assert.match(result.failure, /finished without publishing/u)
  assert.ok(clock.now() < 30 * minute, 'fails soon after the dispatched run goes idle')
})

test('a normal release that publishes during the grace period never dispatches or reads Actions', async () => {
  const clock = fakeClock()
  const result = await proveGithubPackages({
    targets: [core],
    ...clock,
    readRegistry: async () =>
      statesFrom([[core, clock.now() >= 12 * minute ? 'present' : 'missing']]),
    readCi: async () => assert.fail('no Actions read inside the grace period'),
    readReleaseBusy: async () => assert.fail('no Actions read inside the grace period'),
    dispatch: async () => assert.fail('no dispatch'),
  })
  assert.equal(result.dispatched, false)
  assert.deepEqual(result.present, [core])
})

test('a busy release group is waited out to the deadline rather than replaced', async () => {
  const clock = fakeClock()
  const result = await proveGithubPackages({
    targets: [core],
    ...clock,
    readRegistry: async () => statesFrom([[core, 'missing']]),
    readCi: async () => ({ id: 3, status: 'completed', conclusion: 'success' }),
    readReleaseBusy: async () => true,
    dispatch: async () => assert.fail('never dispatch into a busy release group'),
  })
  assert.match(result.failure, /after 75 min/u)
})

test('mirror waits return what is still missing at the deadline', async () => {
  const clock = fakeClock()
  const missing = await waitForRegistry({
    targets: [core, tools],
    ...clock,
    deadlineMs: 15 * minute,
    readRegistry: async () =>
      statesFrom([
        [core, clock.now() >= 3 * minute ? 'present' : 'missing'],
        [tools, 'missing'],
      ]),
  })
  assert.deepEqual(missing, [tools])
  assert.equal(clock.now(), 15 * minute)

  const none = await waitForRegistry({
    targets: [core],
    ...fakeClock(),
    deadlineMs: 0,
    readRegistry: async () => statesFrom([[core, 'present']]),
  })
  assert.deepEqual(none, [])
})

const proof = readFileSync(
  new URL('../.github/workflows/release-proof.yml', import.meta.url),
  'utf8',
)

test('the proof workflow triggers on main manifests and keeps its secret in one job', () => {
  assert.match(
    proof,
    /^on:\n {2}push:\n {4}branches:\n {6}- main\n {4}paths:\n {6}- packages\/\*\*\/package\.json\n {2}workflow_dispatch:\n/mu,
  )
  assert.match(proof, /^permissions: \{\}$/mu)
  assert.doesNotMatch(proof, /self-hosted/u)
  assert.deepEqual(
    [...proof.matchAll(/^\s+(\w+): write$/gmu)].map((match) => match[1]),
    ['actions'],
  )
  const [unprivileged, rest] = proof.split(/^ {2}mirror-redispatch:$/mu)
  const [redispatch, confirm] = rest.split(/^ {2}mirror-confirm:$/mu)
  for (const job of [unprivileged, confirm]) assert.doesNotMatch(job, /secrets\.|environment:/u)
  assert.deepEqual(
    [...new Set([...redispatch.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]))],
    ['LANE_AUTOMATION_APP_KEY'],
  )
  assert.match(redispatch, /environment: npm-release/u)
  assert.match(redispatch, /permissions: \{\}/u)
  assert.doesNotMatch(redispatch, /actions\/checkout|pnpm|node /u)
  assert.match(redispatch, /client-id: \$\{\{ vars\.LANE_AUTOMATION_CLIENT_ID \}\}/u)
  assert.doesNotMatch(redispatch, /^\s+app-id:/mu)
  assert.match(
    redispatch,
    /LANE_AUTOMATION_CLIENT_ID: \$\{\{ vars\.LANE_AUTOMATION_CLIENT_ID \}\}/u,
  )
  assert.match(redispatch, /repositories: package-delivery\n\s+permission-contents: write\n/u)
  assert.match(redispatch, /"narduk-enterprises\/package-delivery "/u)
  assert.match(unprivileged, /actions: write\n\s+contents: read\n\s+packages: read\n/u)
  assert.match(unprivileged, /--grace-minutes 20 --timeout-minutes 75/u)
  for (const uses of proof.matchAll(/uses: (\S+)/gu))
    assert.match(uses[1], /@[0-9a-f]{40}$/u, `${uses[1]} must be SHA-pinned`)
})
