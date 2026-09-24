import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'

const source = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')
const ci = source('ci.yml')
const logging = source('logging-languages.yml')
const release = source('release.yml')

test('every public CI and language job uses a hosted runner without package credentials', () => {
  for (const workflow of [ci, logging]) {
    assert.doesNotMatch(workflow, /self-hosted|BLACKSMITH_|secrets\.|GH_PACKAGES_READ/u)
    assert.doesNotMatch(workflow, /packages: (?:read|write)/u)
  }
  assert.equal((ci.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 6)
  assert.equal((logging.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 2)
  assert.match(ci, /runner: '"ubuntu-latest"'/u)
  assert.match(ci, /required-runner: '"ubuntu-latest"'/u)
  assert.match(ci, /package-registry-auth: disabled/u)
  assert.match(ci, /pnpm run release:consumer-smoke --install-browser/u)
  assert.equal((ci.match(/playwright install --with-deps chromium/gu) || []).length, 1)
  assert.equal(
    (ci.match(/git rev-parse --verify "refs\/remotes\/origin\/main\^\{commit\}"/gu) || []).length,
    2,
  )
  assert.doesNotMatch(ci, /git fetch/u)
})

// notify-mirror and the release-PR mint may name LANE_AUTOMATION_APP_KEY;
// package writes still use the job-scoped GITHUB_TOKEN alone.
const [releasePublish, releaseNotify] = release.split(/^  notify-mirror:$/mu)

test('only the verified main release receives a job-scoped package write token', () => {
  assert.equal((release.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 3)
  assert.match(release, /github\.ref == 'refs\/heads\/main'/u)
  assert.match(release, /environment: npm-release/u)
  assert.match(release, /packages: write/u)
  assert.match(release, /PACKAGE_WRITE_TOKEN: \$\{\{ github\.token \}\}/u)
  assert.match(release, /persist-credentials: false/u)
  assert.match(release, /verify-package-actions-access\.mjs/u)
  assert.match(release, /HOME: \$\{\{ runner\.temp \}\}\/changesets-home/u)
  assert.doesNotMatch(release, /git fetch/u)
  assert.doesNotMatch(
    releasePublish,
    /NARDUK_PLATFORM_GH_PACKAGES_(?:RW|WRITE)|GH_PACKAGES_READ|self-hosted/u,
  )
  assert.deepEqual(
    [...new Set([...releasePublish.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]))],
    ['LANE_AUTOMATION_APP_KEY'],
  )
  assert.match(releasePublish, /id: release-app-token/u)
  assert.match(
    releasePublish,
    /GITHUB_TOKEN: \$\{\{ steps\.release-app-token\.outputs\.token \|\| github\.token \}\}/u,
  )
  assert.doesNotMatch(
    release,
    /NARDUK_PLATFORM_GH_PACKAGES_(?:RW|WRITE)|GH_PACKAGES_READ|self-hosted/u,
  )
  assert.match(release, /verify-release-ci\.mjs/u)
  assert.match(release, /git merge-base --is-ancestor "\$\{VERIFIED_SHA\}" origin\/main/u)
  // PR-branch CI completions must not queue Release runs at all.
  assert.match(
    release,
    /  workflow_run:\n(?:    #.*\n)*    workflows:\n      - CI\n    types:\n      - completed\n    branches:\n      - main\n/u,
  )
  assert.match(release, /github\.event\.workflow_run\.head_branch == 'main'/u)
})

test('the mirror notify is credential-isolated, downscoped and never fails the release', () => {
  assert.ok(releaseNotify, 'release.yml has a notify-mirror job')
  assert.match(releasePublish, /published: \$\{\{ steps\.changesets\.outputs\.published \}\}/u)
  assert.match(releaseNotify, /if: needs\.release\.outputs\.published == 'true'/u)
  assert.match(releaseNotify, /continue-on-error: true/u)
  assert.match(releaseNotify, /permissions: \{\}/u)
  assert.doesNotMatch(releaseNotify, /actions\/checkout|pnpm|npm install/u)
  assert.deepEqual(
    [...new Set([...releaseNotify.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]))],
    ['LANE_AUTOMATION_APP_KEY'],
  )
  assert.match(releaseNotify, /repositories: package-delivery\n\s+permission-contents: write\n/u)
  assert.match(releaseNotify, /"narduk-enterprises\/package-delivery "/u)
  assert.match(releaseNotify, /event_type=narduk-libs-release/u)
  assert.match(releaseNotify, /::notice title=Mirror dispatch skipped::/u)
  assert.match(releaseNotify, /if: failure\(\)\n\s+run: echo "::warning/u)
})

test('hosted package jobs fan out by library and only main seeds the consumer store', () => {
  assert.match(ci, /package-jobs: \$\{\{ steps\.plan\.outputs\.package-jobs \}\}/u)
  assert.match(ci, /package-matrix: \$\{\{ needs\.affected\.outputs\.package-jobs \}\}/u)
  assert.doesNotMatch(ci, /package-matrix: \$\{\{ needs\.affected\.outputs\.batches \}\}/u)
  assert.match(
    ci,
    /narduk-libs-packed-consumer-pnpm-store-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('pnpm-lock\.yaml'\) \}\}/u,
  )
  assert.match(
    ci,
    /restore-keys: \|\s+narduk-libs-journeys-e2e-pnpm-store-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('pnpm-lock\.yaml'\) \}\}/u,
  )
  assert.match(
    ci,
    /steps\.pnpm-store-cache\.outputs\.cache-hit != 'true'\s*&& github\.ref_name == github\.event\.repository\.default_branch/u,
  )
})

test('every CI and release executor matches the supported root Node runtime', () => {
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const eslint = JSON.parse(
    readFileSync(
      new URL('../packages/tooling/eslint-config/package.json', import.meta.url),
      'utf8',
    ),
  )
  assert.ok(Number(root.volta.node.split('.')[0]) >= Number(eslint.engines.node.match(/\d+/u)[0]))
  assert.equal(root.engines.node, root.volta.node)
  assert.equal(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(), root.volta.node)
  for (const file of ['ci.yml', 'release.yml', 'packed-consumer-reuse-canary.yml']) {
    const versions = [...source(file).matchAll(/node-version: ["']?([\d.]+)/gu)].map(
      (match) => match[1],
    )
    assert.ok(versions.length > 0)
    assert.ok(
      versions.every((version) => version === root.volta.node),
      `${file}: ${versions}`,
    )
  }
})

test('every workspace package that pins a Volta Node pins the root one', () => {
  // A package-local pin that disagrees with the root loads the root install's
  // native modules (better-sqlite3) into the wrong Node ABI: every test in
  // that package errors locally while CI, which never reads volta, stays
  // green (narduk-libs#647).
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const disagreeing = []
  let pinned = 0
  for (const group of readdirSync(new URL('../packages/', import.meta.url))) {
    const groupUrl = new URL(`../packages/${group}/`, import.meta.url)
    if (!statSync(groupUrl).isDirectory()) continue
    for (const name of readdirSync(groupUrl)) {
      const manifest = new URL(`../packages/${group}/${name}/package.json`, import.meta.url)
      if (!existsSync(manifest)) continue
      const node = JSON.parse(readFileSync(manifest, 'utf8')).volta?.node
      if (node === undefined) continue
      pinned += 1
      if (node !== root.volta.node) disagreeing.push(`packages/${group}/${name}: ${node}`)
    }
  }
  assert.ok(pinned > 0, 'no package pins volta.node; drop this test or the premise changed')
  assert.deepEqual(disagreeing, [], `root volta.node is ${root.volta.node}`)
})

test('the Cursor reviewer workflow stays on the public hosted route with exactly one named secret', () => {
  // The reviewer lives outside ci.yml so ci.yml stays credential-free for
  // fork CI. That split only holds if this file cannot drift onto a
  // self-hosted label, a moving tag, or a second secret.
  const review = source('cursor-review.yml')
  assert.doesNotMatch(review, /self-hosted|BLACKSMITH_|GH_PACKAGES_READ|linux-ci/u)
  assert.match(review, /runner: '"ubuntu-latest"'/u)
  assert.match(
    review,
    /uses: narduk-enterprises\/workflows\/\.github\/workflows\/cursor-review\.yml@[0-9a-f]{40}/u,
  )
  assert.doesNotMatch(review, /cursor-review\.yml@(?:main|v\d)|pull_request_target/u)
  assert.deepEqual(
    [...review.matchAll(/secrets\.([A-Z_]+)/gu)].map((m) => m[1]),
    ['CURSOR_CLOUD_AGENTS_API_KEY'],
  )
  assert.match(review, /pull-requests: write/u)
  assert.doesNotMatch(ci, /cursor-review/u)
})

test('the packed-consumer reuse canary is opt-in on main and never publishes', () => {
  // narduk-libs#202: accepted PR-to-main reuse stays cold unless a live
  // canary manufactures an unchanged receipt. The workflow is dispatch-only
  // so ordinary PRs do not pay for it, and it must not weaken production
  // lookup or publish anything.
  const canary = source('packed-consumer-reuse-canary.yml')
  assert.match(canary, /^name: Packed-consumer reuse canary$/mu)
  assert.match(canary, /^on:\n {2}workflow_dispatch:\n/mu)
  assert.doesNotMatch(canary, /pull_request:|push:|workflow_call:|workflow_run:/u)
  assert.match(canary, /^permissions: \{\}$/mu)
  assert.doesNotMatch(canary, /self-hosted|BLACKSMITH_|secrets\.|GH_PACKAGES_READ|environment:/u)
  assert.doesNotMatch(canary, /packages: (?:read|write)|download-artifact/u)
  assert.doesNotMatch(canary, /create-narduk-app|release:publish|changeset/u)
  assert.equal((canary.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 4)
  assert.equal((canary.match(/github\.ref == 'refs\/heads\/main'/gu) || []).length, 4)
  assert.match(canary, /node scripts\/packed-consumer-reuse-canary\.mjs produce/u)
  assert.match(canary, /node scripts\/packed-consumer-reuse-canary\.mjs consume-accepted/u)
  assert.match(canary, /node scripts\/packed-consumer-reuse-canary\.mjs fallback-missing/u)
  assert.match(canary, /node scripts\/packed-consumer-reuse-canary\.mjs fallback-changed/u)
  assert.match(canary, /name: packed-consumer-proof-\$\{\{ github\.run_attempt \}\}/u)
  assert.match(canary, /path: \.ci-evidence\/packed-consumer-proof\/proof\.json/u)
  assert.match(canary, /needs: produce/u)
  assert.match(canary, /actions: read/u)
  assert.match(canary, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u)
  for (const uses of canary.matchAll(/uses: (\S+)/gu))
    assert.match(uses[1], /@[0-9a-f]{40}$/u, `${uses[1]} must be SHA-pinned`)
})
