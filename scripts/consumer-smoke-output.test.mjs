import assert from 'node:assert/strict'
import test from 'node:test'

import { collectWarningFindings, isNetworkLatencyOnlyWarning } from './consumer-smoke-output.mjs'

// pnpm renders a global warning as a WARN badge wrapped in U+2009 THIN SPACE
// inside an ANSI background colour. Building the badge from code points keeps
// these fixtures byte-identical to real pnpm output without putting an
// easily-mangled escape sequence in the source; the byte sequence was captured
// from pnpm 10.33.4 by forcing the warning with `fetch-warn-timeout-ms=1`.
const thinSpace = String.fromCodePoint(0x2009)
const escape = String.fromCodePoint(0x1b)
const warn = (message) => `${thinSpace}WARN${thinSpace} ${message}`
const styledWarn = (message) =>
  `${escape}[43m${escape}[30m${thinSpace}WARN${thinSpace}${escape}[39m${escape}[49m ${message}`

// The exact line that failed packed-consumer-smoke five consecutive times on
// 2026-08-27 (runs 33085892640, 33086539818, 33087897977) -- narduk-libs#98.
const observedSlowRequest = warn(
  'Request took 43138ms: https://registry.npmjs.org/@typescript-eslint%2Ftypes',
)

test('a pnpm slow-request warning from a successful fetch does not fail the gate', () => {
  assert.deepEqual(collectWarningFindings(observedSlowRequest), [])
  assert.equal(isNetworkLatencyOnlyWarning(observedSlowRequest.trim()), true)
})

test('the slow-request allowance survives ANSI styling and plain-space rendering', () => {
  assert.deepEqual(
    collectWarningFindings(styledWarn('Request took 45201ms: https://registry.npmjs.org/vue')),
    [],
  )
  assert.deepEqual(
    collectWarningFindings('WARN  Request took 7ms: https://registry.npmjs.org/nuxt'),
    [],
  )
})

test('a pnpm slow-tarball warning from a completed download does not fail the gate', () => {
  const line = warn(
    'Tarball download average speed 12 KiB/s (size 34500 KiB) is below 100 KiB/s: https://registry.npmjs.org/nuxt/-/nuxt-4.4.0.tgz (GET)',
  )
  assert.deepEqual(collectWarningFindings(line), [])
})

test('real pnpm warnings still fail the gate', () => {
  const peerDependency = collectWarningFindings(warn('Issues with peer dependencies found'))
  assert.equal(peerDependency.length, 1)
  assert.match(peerDependency[0], /Issues with peer dependencies found$/u)

  const deprecation = collectWarningFindings(
    warn('deprecated @esbuild-kit/core-utils@3.3.2: Merged into tsx'),
  )
  assert.equal(deprecation.length, 1)
  assert.match(deprecation[0], /deprecated @esbuild-kit\/core-utils/u)

  const buildFailure = collectWarningFindings('Error: command failed with ELIFECYCLE')
  assert.deepEqual(buildFailure, ['Error: command failed with ELIFECYCLE'])
})

test('a failure that merely quotes the slow-request phrase still fails the gate', () => {
  // Anchoring matters: only pnpm's exact success-path line is excused.
  const errored = 'ERROR  Request took 43138ms: https://registry.npmjs.org/vue'
  assert.equal(isNetworkLatencyOnlyWarning(errored), false)
  assert.equal(collectWarningFindings(errored).length, 1)

  const trailing = warn('Request took 43138ms: https://registry.npmjs.org/vue and then it exploded')
  assert.equal(collectWarningFindings(trailing).length, 1)
})

test('a mixed run reports only the genuine findings, trimmed and in order', () => {
  const output = [
    'Packages: +1204',
    observedSlowRequest,
    warn(
      'Tarball download average speed 9 KiB/s (size 120 KiB) is below 100 KiB/s: https://x/y.tgz (GET)',
    ),
    warn('Issues with peer dependencies found'),
    '.                                        | Progress: resolved 1204, reused 1200',
    'DeprecationWarning: fs.Stats constructor is deprecated.',
    '',
  ].join('\n')

  assert.deepEqual(collectWarningFindings(output), [
    `WARN${thinSpace} Issues with peer dependencies found`,
    'DeprecationWarning: fs.Stats constructor is deprecated.',
  ])
})

test('clean output produces no findings', () => {
  assert.deepEqual(collectWarningFindings('Done in 41.2s\nPackages: +1204\n'), [])
})

// The exact first lines that turned packed-consumer-smoke red on every run
// after zod@4.5.1 published (2026-08-28, run 33203587597) -- narduk-libs#101.
const observedZodPureNotice =
  '[warn] ../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/regexes.js (70:0): A comment'

test('a Rollup PURE-annotation notice about third-party source does not fail the gate', () => {
  assert.deepEqual(collectWarningFindings(observedZodPureNotice), [])
  assert.deepEqual(collectWarningFindings(observedZodPureNotice.replace('[warn]', 'WARN ')), [])
  assert.deepEqual(
    collectWarningFindings(
      '[warn] ../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/util.js (330:0): A comment',
    ),
    [],
  )
})

test('the same notice about first-party source still fails the gate', () => {
  const firstParty = '[warn] src/components/Chart.vue (12:0): A comment'
  assert.deepEqual(collectWarningFindings(firstParty), [firstParty])
  assert.deepEqual(collectWarningFindings(firstParty.replace('[warn]', 'WARN ')), [
    firstParty.replace('[warn]', 'WARN '),
  ])
})

test('an error about a third-party path still fails the gate', () => {
  const thirdPartyError =
    '[error] ../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/util.js (330:0): A comment'
  assert.deepEqual(collectWarningFindings(thirdPartyError), [thirdPartyError])
})

test("the annotation body lines of Rollup's multi-line notice were never findings", () => {
  const body =
    'in "../../node_modules/.pnpm/zod@4.5.1/node_modules/zod/v4/core/util.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.'
  assert.deepEqual(collectWarningFindings(body), [])
})

const nuxtH3BarrelNotice =
  'WARN  "H3Event" is imported from external module "file:///tmp/consumer/node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs" but never used in "../../node_modules/.pnpm/@nuxt+nitro-server@4.5.2_peerhash/node_modules/@nuxt/nitro-server/dist/h3.mjs".'

test('the unused H3Event re-export in the Nuxt 4.5.2 compatibility barrel is benign', () => {
  assert.deepEqual(collectWarningFindings(nuxtH3BarrelNotice), [])
  assert.deepEqual(collectWarningFindings(nuxtH3BarrelNotice.replace('WARN ', '[warn]')), [])
})

test('unused app imports, other symbols, other versions and actual errors still fail', () => {
  for (const line of [
    nuxtH3BarrelNotice.replace(
      '../../node_modules/.pnpm/@nuxt+nitro-server@4.5.2_peerhash/node_modules/@nuxt/nitro-server/dist/h3.mjs',
      'src/server/h3.mjs',
    ),
    nuxtH3BarrelNotice.replace('"H3Event"', '"createError"'),
    nuxtH3BarrelNotice.replace('@4.5.2_', '@4.5.3_'),
    nuxtH3BarrelNotice.replace('WARN ', 'ERROR '),
    `${nuxtH3BarrelNotice} A different failure follows.`,
  ]) {
    assert.deepEqual(collectWarningFindings(line), [line])
  }
})

test('a successful Rolldown plugin timing summary is informational', () => {
  const timing = 'WARN  [PLUGIN_TIMINGS] Plugin hooks ran for 4.5s of this 5.1s build (89%).'
  assert.deepEqual(collectWarningFindings(timing), [])
  for (const line of [
    timing.replace('WARN', 'ERROR'),
    timing.replace('PLUGIN_TIMINGS', 'PLUGIN_ERROR'),
    `${timing} Build failed.`,
  ]) {
    assert.deepEqual(collectWarningFindings(line), [line])
  }
})
