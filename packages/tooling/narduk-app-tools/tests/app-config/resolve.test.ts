import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AppConfigError,
  clearPrimedAppConfig,
  fetchPortalAppConfig,
  isAcceptedContractOwnership,
  locateAppConfigRoot,
  primeAppConfig,
  readAppConfigSync,
  readSourceMode,
  resolveAppConfig,
  resolveAppRepoSlug,
  scrubAppConfigSecrets,
} from '../../src/app-config/resolve.js'
import { fakePortal, noBackoff, TOKEN } from './fake-portal.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  clearPrimedAppConfig()
})

function checkout(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-app-config-'))
  dirs.push(root)
  mkdirSync(join(root, '.git'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

const CF = { 'Config/cloudflare-app.json': '{"local":true}\n' }
const REPO = 'example/app'
const baseEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GITHUB_REPOSITORY: REPO,
  OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN,
  ...extra,
})
const portalDoc = { contractOwnership: 'portal-owned', worker: { name: 'app' } }
const served = { [`${REPO}/cloudflare-app.json`]: portalDoc }

beforeEach(() => clearPrimedAppConfig())

describe('readSourceMode', () => {
  it('defaults to auto and accepts the three names', () => {
    expect(readSourceMode({})).toBe('auto')
    expect(readSourceMode({ NARDUK_APP_CONFIG_SOURCE: ' ' })).toBe('auto')
    expect(readSourceMode({ NARDUK_APP_CONFIG_SOURCE: 'FILE' })).toBe('file')
    expect(readSourceMode({ NARDUK_APP_CONFIG_SOURCE: 'portal' })).toBe('portal')
  })

  it('refuses any other value', () => {
    expect(() => readSourceMode({ NARDUK_APP_CONFIG_SOURCE: 'cache' })).toThrow(AppConfigError)
  })
})

describe('contractOwnership', () => {
  it('accepts portal-owned and the transitional app-owned, nothing else', () => {
    expect(isAcceptedContractOwnership('portal-owned')).toBe(true)
    expect(isAcceptedContractOwnership('app-owned')).toBe(true)
    expect(isAcceptedContractOwnership('hq-owned')).toBe(false)
    expect(isAcceptedContractOwnership(undefined)).toBe(false)
  })

  it('rejects a portal document with another value, and takes either spelling', async () => {
    const env = baseEnv()
    const bad = fakePortal({ [`${REPO}/cloudflare-app.json`]: { contractOwnership: 'hq-owned' } })
    await expect(
      fetchPortalAppConfig(REPO, 'cloudflare-app.json', { env, fetch: bad.fetch }),
    ).rejects.toMatchObject({ code: 'bad-response' })
    for (const value of ['portal-owned', 'app-owned']) {
      const ok = fakePortal({ [`${REPO}/cloudflare-app.json`]: { contractOwnership: value } })
      await expect(
        fetchPortalAppConfig(REPO, 'cloudflare-app.json', { env, fetch: ok.fetch }),
      ).resolves.toMatchObject({ source: 'portal' })
    }
  })

  it('does not validate the ownership value of a local file (unchanged behaviour)', async () => {
    const root = checkout({ 'Config/cloudflare-app.json': '{"contractOwnership":"whatever"}' })
    await expect(
      resolveAppConfig({ root, file: 'cloudflare-app.json', env: baseEnv() }),
    ).resolves.toMatchObject({ source: 'file' })
  })
})

describe('resolveAppConfig modes', () => {
  it('auto reads the local file and never touches the network', async () => {
    const root = checkout(CF)
    const portal = fakePortal(served)
    const result = await resolveAppConfig({
      root,
      file: 'cloudflare-app.json',
      env: baseEnv(),
      fetch: portal.fetch,
    })
    expect(result).toMatchObject({ source: 'file', text: '{"local":true}\n' })
    expect(portal.calls).toHaveLength(0)
  })

  it('auto falls through to the portal when the file is absent', async () => {
    const root = checkout()
    const portal = fakePortal(served)
    const result = await resolveAppConfig({
      root,
      file: 'cloudflare-app.json',
      env: baseEnv(),
      fetch: portal.fetch,
    })
    expect(result).toMatchObject({ source: 'portal', revision: 7 })
    expect(JSON.parse(result!.text)).toEqual(portalDoc)
    expect(portal.calls).toHaveLength(1)
    const call = portal.calls[0]!
    expect(call.url.origin).toBe('https://ops.nardukenterprises.com')
    expect(call.url.pathname).toBe('/api/estate/app-config')
    expect(call.url.searchParams.get('repo')).toBe(REPO)
    expect(call.url.searchParams.get('file')).toBe('cloudflare-app.json')
    expect(call.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('file mode reads only the file: null when absent, an error when required', async () => {
    const env = baseEnv({ NARDUK_APP_CONFIG_SOURCE: 'file' })
    const portal = fakePortal(served)
    const empty = checkout()
    await expect(
      resolveAppConfig({ root: empty, file: 'cloudflare-app.json', env, fetch: portal.fetch }),
    ).resolves.toBeNull()
    await expect(
      resolveAppConfig({
        root: empty,
        file: 'cloudflare-app.json',
        env,
        fetch: portal.fetch,
        required: true,
      }),
    ).rejects.toMatchObject({ code: 'file-missing' })
    expect(portal.calls).toHaveLength(0)
  })

  it('portal mode ignores a local file', async () => {
    const root = checkout(CF)
    const portal = fakePortal(served)
    const result = await resolveAppConfig({
      root,
      file: 'cloudflare-app.json',
      env: baseEnv({ NARDUK_APP_CONFIG_SOURCE: 'portal' }),
      fetch: portal.fetch,
    })
    expect(result?.source).toBe('portal')
    expect(portal.calls).toHaveLength(1)
  })

  it('honours OPERATOR_PORTAL_URL and refuses a non-https origin for the token', async () => {
    const root = checkout()
    const portal = fakePortal(served)
    await resolveAppConfig({
      root,
      file: 'cloudflare-app.json',
      env: baseEnv({ OPERATOR_PORTAL_URL: 'https://portal.example.test/' }),
      fetch: portal.fetch,
    })
    expect(portal.calls[0]!.url.origin).toBe('https://portal.example.test')
    await expect(
      resolveAppConfig({
        root,
        file: 'cloudflare-app.json',
        env: baseEnv({ OPERATOR_PORTAL_URL: 'http://portal.example.test' }),
        fetch: portal.fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid-origin' })
  })

  it('names the repository it could not determine', async () => {
    const root = checkout()
    await expect(
      resolveAppConfig({
        root,
        file: 'cloudflare-app.json',
        env: { OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN },
        fetch: fakePortal().fetch,
      }),
    ).rejects.toMatchObject({ code: 'no-repo' })
  })
})

describe('portal failures are loud', () => {
  const run = (portal: ReturnType<typeof fakePortal>, extra: NodeJS.ProcessEnv = {}) =>
    resolveAppConfig({
      root: checkout(),
      file: 'cloudflare-app.json',
      env: baseEnv(extra),
      fetch: portal.fetch,
      timeoutMs: 50,
      ...noBackoff,
    })

  it('a missing token names the variable and file mode', async () => {
    const portal = fakePortal(served)
    const error = await resolveAppConfig({
      root: checkout(),
      file: 'cloudflare-app.json',
      env: { GITHUB_REPOSITORY: REPO },
      fetch: portal.fetch,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppConfigError)
    expect((error as AppConfigError).code).toBe('no-token')
    expect((error as Error).message).toContain('OPERATOR_PORTAL_APP_CONFIG_TOKEN')
    expect((error as Error).message).toContain('NARDUK_APP_CONFIG_SOURCE=file')
    expect(portal.calls).toHaveLength(0)
  })

  it('401 is unauthorized and never read as an absent file', async () => {
    await expect(run(fakePortal({}, { status: 401 }))).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('503 is unavailable', async () => {
    await expect(run(fakePortal({}, { status: 503 }))).rejects.toMatchObject({
      code: 'unavailable',
      status: 503,
    })
  })

  it('any other status is a bad response', async () => {
    await expect(run(fakePortal({}, { status: 500 }))).rejects.toMatchObject({
      code: 'bad-response',
    })
  })

  it('404 is an authoritative absence: null, or not-found when required', async () => {
    await expect(run(fakePortal({}))).resolves.toBeNull()
    await expect(
      resolveAppConfig({
        root: checkout(),
        file: 'project-lifecycle.json',
        env: baseEnv(),
        fetch: fakePortal({}).fetch,
        required: true,
      }),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('a malformed body is a bad response', async () => {
    await expect(
      run(fakePortal({ [`${REPO}/cloudflare-app.json`]: '{not json' })),
    ).rejects.toMatchObject({ code: 'bad-response' })
    await expect(run(fakePortal({ [`${REPO}/cloudflare-app.json`]: '[1]' }))).rejects.toMatchObject(
      { code: 'bad-response' },
    )
  })

  it('a network failure never echoes the token', async () => {
    const portal = fakePortal({}, { error: new Error(`connect refused with Bearer ${TOKEN}`) })
    const error = (await run(portal).catch((e: unknown) => e)) as AppConfigError
    expect(error.code).toBe('network')
    expect(error.message).not.toContain(TOKEN)
  })

  it('a stalled portal times out', async () => {
    const stalled = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    await expect(
      resolveAppConfig({
        root: checkout(),
        file: 'cloudflare-app.json',
        env: baseEnv(),
        fetch: stalled,
        timeoutMs: 20,
        ...noBackoff,
      }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('scrubs the token and anything key-shaped', () => {
    const env = baseEnv()
    expect(scrubAppConfigSecrets(`x ${TOKEN} y nk_other_secret_value z`, env)).toBe(
      'x [redacted] y [redacted] z',
    )
  })
})

describe('prime and sync read', () => {
  it('serves what was primed from the portal', async () => {
    const root = checkout()
    const portal = fakePortal(served)
    const env = baseEnv()
    await primeAppConfig({
      dir: root,
      exact: true,
      files: ['cloudflare-app.json'],
      env,
      fetch: portal.fetch,
    })
    const read = readAppConfigSync({ root, file: 'cloudflare-app.json', env })
    expect(read?.source).toBe('portal')
    expect(JSON.parse(read!.text)).toEqual(portalDoc)
  })

  it('an unprimed portal read throws instead of reporting absence', () => {
    const root = checkout()
    expect(() => readAppConfigSync({ root, file: 'cloudflare-app.json', env: baseEnv() })).toThrow(
      /not resolved/,
    )
  })

  it('a primed 404 reads as null, and required turns it into an error', async () => {
    const root = checkout()
    const env = baseEnv()
    await primeAppConfig({
      dir: root,
      exact: true,
      files: ['project-lifecycle.json'],
      env,
      fetch: fakePortal({}).fetch,
    })
    expect(readAppConfigSync({ root, file: 'project-lifecycle.json', env })).toBeNull()
    expect(() =>
      readAppConfigSync({ root, file: 'project-lifecycle.json', env, required: true }),
    ).toThrow(/portal has no project-lifecycle.json/)
  })

  it('priming a failed portal throws; nothing is stored', async () => {
    const root = checkout()
    const env = baseEnv()
    await expect(
      primeAppConfig({
        dir: root,
        exact: true,
        files: ['cloudflare-app.json'],
        env,
        fetch: fakePortal({}, { status: 503 }).fetch,
        ...noBackoff,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(() => readAppConfigSync({ root, file: 'cloudflare-app.json', env })).toThrow(
      /not resolved/,
    )
  })

  it('does not fetch when the checkout has the file', async () => {
    const root = checkout(CF)
    const portal = fakePortal(served)
    await primeAppConfig({
      dir: root,
      exact: true,
      files: ['cloudflare-app.json'],
      env: baseEnv(),
      fetch: portal.fetch,
    })
    expect(portal.calls).toHaveLength(0)
  })
})

describe('locating the checkout', () => {
  it('finds the file above the start, else the git root', () => {
    const withFile = checkout(CF)
    mkdirSync(join(withFile, 'apps/web'), { recursive: true })
    expect(
      locateAppConfigRoot(join(withFile, 'apps/web'), 'cloudflare-app.json', { env: {} }),
    ).toBe(withFile)
    const bare = checkout()
    mkdirSync(join(bare, 'apps/web'), { recursive: true })
    expect(locateAppConfigRoot(join(bare, 'apps/web'), 'cloudflare-app.json', { env: {} })).toBe(
      bare,
    )
    expect(
      locateAppConfigRoot(join(bare, 'apps/web'), 'cloudflare-app.json', {
        env: { NARDUK_APP_CONFIG_SOURCE: 'file' },
      }),
    ).toBeNull()
  })

  it('derives owner/repo from GITHUB_REPOSITORY, an explicit value, or package.json', () => {
    const root = checkout({
      'package.json': JSON.stringify({ repository: 'git+ssh://git@github.com/o/r.git' }),
    })
    expect(resolveAppRepoSlug(root, { env: { GITHUB_REPOSITORY: 'a/b' } })).toBe('a/b')
    expect(resolveAppRepoSlug(root, { repo: 'c/d', env: {} })).toBe('c/d')
    expect(resolveAppRepoSlug(root, { env: {} })).toBe('o/r')
  })
})
