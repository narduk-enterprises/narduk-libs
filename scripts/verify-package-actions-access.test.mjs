import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishedPackageNames,
  splitByRelease,
  verifyPackageActionsAccess,
} from './verify-package-actions-access.mjs'

const names = ['@narduk-enterprises/one', '@narduk-enterprises/two']
const repository = 'narduk-enterprises/narduk-libs'
const token = 'synthetic-test-value'

test('enumerates only publishable GitHub Packages and rejects an empty target set', () => {
  assert.deepEqual(
    publishedPackageNames({
      packages: [
        { name: names[0], manifest: { publishConfig: { registry: 'https://npm.pkg.github.com' } } },
        {
          name: names[1],
          manifest: { private: true, publishConfig: { registry: 'https://npm.pkg.github.com' } },
        },
        { name: 'other', manifest: { publishConfig: { registry: 'https://registry.npmjs.org' } } },
      ],
    }),
    [names[0]],
  )
  assert.throws(() => publishedPackageNames({ packages: [] }), /No GitHub Packages/)
})

test('requires the job token to see every exact package before publishing', async () => {
  const seen = []
  const request = async (url, options) => {
    const name = decodeURIComponent(url.split('/').at(-1))
    seen.push(name)
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    return { ok: true, json: async () => ({ name, package_type: 'npm' }) }
  }
  assert.equal(await verifyPackageActionsAccess({ names, repository, token, request }), 2)
  assert.deepEqual(seen, ['one', 'two'])
  await assert.rejects(
    verifyPackageActionsAccess({
      names,
      repository,
      token,
      request: async () => ({ ok: false, status: 403 }),
    }),
    /cannot read .*one \(403\)/,
  )
  await assert.rejects(
    verifyPackageActionsAccess({
      names,
      repository,
      token,
      request: async () => ({
        ok: true,
        json: async () => ({ name: 'two', package_type: 'npm' }),
      }),
    }),
    /Unexpected GitHub Packages metadata/,
  )
  await assert.rejects(
    verifyPackageActionsAccess({
      names,
      repository,
      token,
      request: async () => ({
        ok: true,
        json: async () => ({ name: 'one', package_type: 'maven' }),
      }),
    }),
    /Unexpected GitHub Packages metadata/,
  )
  await assert.rejects(
    verifyPackageActionsAccess({ names: ['@outside/one'], repository, token, request }),
    /Unexpected package publication target/,
  )
  await assert.rejects(
    verifyPackageActionsAccess({ names, repository, token: '', request }),
    /job token/,
  )
  await assert.rejects(
    verifyPackageActionsAccess({ names, repository: 'someone/fork', token, request }),
    /job token/,
  )
})

test('checks only released packages; a never-tagged package is left to its first publish', () => {
  const tags = [
    '@narduk-enterprises/one@1.0.0',
    '@narduk-enterprises/one@1.1.0',
    '@narduk-enterprises/two-extra@0.1.0',
  ]
  assert.deepEqual(splitByRelease(['@narduk-enterprises/one', '@narduk-enterprises/two'], tags), {
    existing: ['@narduk-enterprises/one'],
    firstPublish: ['@narduk-enterprises/two'],
  })
  // A tag for one package never counts for another whose name it merely prefixes.
  assert.deepEqual(splitByRelease(['@narduk-enterprises/two-extra'], tags).existing, [
    '@narduk-enterprises/two-extra',
  ])
  assert.deepEqual(splitByRelease(names, []), { existing: [], firstPublish: names })
})
