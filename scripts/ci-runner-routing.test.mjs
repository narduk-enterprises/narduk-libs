import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.equal((ci.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 5)
  assert.equal((logging.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 2)
  assert.match(ci, /runner: '"ubuntu-latest"'/u)
  assert.match(ci, /required-runner: '"ubuntu-latest"'/u)
  assert.match(ci, /package-registry-auth: disabled/u)
  assert.equal((ci.match(/playwright install --with-deps chromium/gu) || []).length, 2)
})

test('only the verified main release receives a job-scoped package write token', () => {
  assert.equal((release.match(/^    runs-on: ubuntu-latest$/gmu) || []).length, 2)
  assert.match(release, /github\.ref == 'refs\/heads\/main'/u)
  assert.match(release, /environment: npm-release/u)
  assert.match(release, /packages: write/u)
  assert.match(release, /PACKAGE_WRITE_TOKEN: \$\{\{ github\.token \}\}/u)
  assert.doesNotMatch(
    release,
    /NARDUK_PLATFORM_GH_PACKAGES_(?:RW|WRITE)|GH_PACKAGES_READ|self-hosted|secrets\./u,
  )
  assert.match(release, /verify-release-ci\.mjs/u)
  assert.match(release, /git merge-base --is-ancestor "\$\{VERIFIED_SHA\}" origin\/main/u)
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
  for (const file of ['ci.yml', 'release.yml']) {
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
