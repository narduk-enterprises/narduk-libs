import { describe, expect, it } from 'vitest'

import {
  AppConfigError,
  fetchPortalAppConfig,
  scrubAppConfigSecrets,
  type AppConfigFetch,
  type AppConfigFetchResponse,
} from '../../src/app-config/resolve.js'
import { noBackoff, TOKEN } from './fake-portal.js'

const REPO = 'example/app'
const ORIGIN = 'https://ops.nardukenterprises.com'
const REQUEST_TOKEN = 'actions-request-token-0123456789'
// Shaped like a GitHub OIDC JWT; not a real one.
const MINTED = 'eyJhbGciOiJSUzI1NiJ9.eyJyZXBvc2l0b3J5IjoiZXhhbXBsZS9hcHAifQ.c2lnbmF0dXJl'
const DOC = { contractOwnership: 'portal-owned', worker: { name: 'app' } }

function response(status: number, body = ''): AppConfigFetchResponse {
  return { status, headers: { get: () => null }, text: async () => body }
}

interface Call {
  url: URL
  authorization: string | undefined
}

/** GitHub's token endpoint and the portal in one injectable fetch. */
function actions(options: { oidcStatus?: number; oidcBody?: string; portalStatus?: number } = {}) {
  const oidc: Call[] = []
  const portal: Call[] = []
  const fetch: AppConfigFetch = async (url, init) => {
    const parsed = new URL(url)
    const call = { url: parsed, authorization: init.headers.authorization }
    if (parsed.pathname === '/api/estate/app-config') {
      portal.push(call)
      return options.portalStatus === undefined
        ? response(200, JSON.stringify(DOC))
        : response(options.portalStatus)
    }
    oidc.push(call)
    return options.oidcStatus === undefined || options.oidcStatus === 200
      ? response(200, options.oidcBody ?? JSON.stringify({ value: MINTED }))
      : response(options.oidcStatus)
  }
  return { fetch, oidc, portal }
}

const requestUrl = (query = '?api-version=2.0') =>
  `https://pipelines.actions.githubusercontent.com/abc/_apis/distributedtask/hubs/Actions/plans/1/jobs/2/idtoken${query}`

const actionsEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GITHUB_ACTIONS: 'true',
  ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl(),
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN,
  ...extra,
})

const get = (env: NodeJS.ProcessEnv, fetch: AppConfigFetch) =>
  fetchPortalAppConfig(REPO, 'cloudflare-app.json', { env, fetch, ...noBackoff })

describe('GitHub OIDC credential', () => {
  it('is used when only the Actions variables exist: the minted token is the Bearer', async () => {
    const fake = actions()
    const resolved = await get(actionsEnv(), fake.fetch)
    expect(resolved?.source).toBe('portal')
    expect(fake.oidc).toHaveLength(1)
    expect(fake.oidc[0]?.authorization).toBe(`Bearer ${REQUEST_TOKEN}`)
    expect(fake.portal).toHaveLength(1)
    expect(fake.portal[0]?.authorization).toBe(`Bearer ${MINTED}`)
    expect(fake.portal[0]?.url.searchParams.get('repo')).toBe(REPO)
  })

  it('sets the audience to the portal origin, appended with & after an existing query', async () => {
    const fake = actions()
    await get(actionsEnv(), fake.fetch)
    const url = fake.oidc[0]!.url
    expect(url.searchParams.get('api-version')).toBe('2.0')
    expect(url.searchParams.get('audience')).toBe(ORIGIN)
    expect(url.search).toMatch(/^\?api-version=2\.0&audience=/u)
  })

  it('starts the query with ? when the request URL has none', async () => {
    const fake = actions()
    await get(actionsEnv({ ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl('') }), fake.fetch)
    const url = fake.oidc[0]!.url
    expect(url.search).toMatch(/^\?audience=/u)
    expect(url.searchParams.get('audience')).toBe(ORIGIN)
  })

  it('uses the origin exactly as the request does, with no trailing slash', async () => {
    const fake = actions()
    await get(actionsEnv({ OPERATOR_PORTAL_URL: 'https://ops.example.test/' }), fake.fetch)
    expect(fake.oidc[0]!.url.searchParams.get('audience')).toBe('https://ops.example.test')
    expect(fake.portal[0]!.url.origin).toBe('https://ops.example.test')
  })

  it('yields to an explicit OPERATOR_PORTAL_APP_CONFIG_TOKEN and never asks GitHub', async () => {
    const fake = actions()
    await get(actionsEnv({ OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN }), fake.fetch)
    expect(fake.oidc).toHaveLength(0)
    expect(fake.portal[0]?.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it.each([
    ['no variables in Actions', { GITHUB_ACTIONS: 'true' }],
    ['only the request URL', { ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl() }],
    ['only the request token', { ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN }],
  ] satisfies Array<[string, NodeJS.ProcessEnv]>)(
    'a job without id-token permission (%s) says what to set',
    async (_name, env) => {
      const fake = actions()
      const error = (await get(env, fake.fetch).catch((e: unknown) => e)) as AppConfigError
      expect(error).toBeInstanceOf(AppConfigError)
      expect(error.code).toBe('no-token')
      expect(error.message).toContain('permissions: id-token: write')
      expect(error.message).toContain('NARDUK_APP_CONFIG_SOURCE=file')
      expect(error.message).toContain('OPERATOR_PORTAL_APP_CONFIG_TOKEN')
      expect(error.message).not.toContain(REQUEST_TOKEN)
      expect(fake.oidc).toHaveLength(0)
      expect(fake.portal).toHaveLength(0)
    },
  )

  it('outside Actions the message stays about the key', async () => {
    const error = (await get({}, actions().fetch).catch((e: unknown) => e)) as AppConfigError
    expect(error.code).toBe('no-token')
    expect(error.message).not.toContain('id-token')
  })

  it('a refused OIDC request is loud, and names neither token', async () => {
    const error = (await get(actionsEnv(), actions({ oidcStatus: 403 }).fetch).catch(
      (e: unknown) => e,
    )) as AppConfigError
    expect(error.code).toBe('oidc')
    expect(error.message).toContain('permissions: id-token: write')
    expect(error.message).not.toContain(REQUEST_TOKEN)
  })

  it('an OIDC answer without a token is loud', async () => {
    await expect(
      get(actionsEnv(), actions({ oidcBody: JSON.stringify({}) }).fetch),
    ).rejects.toMatchObject({ code: 'oidc' })
    await expect(get(actionsEnv(), actions({ oidcBody: 'nope' }).fetch)).rejects.toMatchObject({
      code: 'oidc',
    })
  })

  it('a portal 403 for an OIDC token says whose claim it checks', async () => {
    const error = (await get(actionsEnv(), actions({ portalStatus: 403 }).fetch).catch(
      (e: unknown) => e,
    )) as AppConfigError
    expect(error.code).toBe('unauthorized')
    expect(error.status).toBe(403)
    expect(error.message).toContain('OIDC')
    expect(error.message).not.toContain(MINTED)
    expect(error.message).not.toContain(REQUEST_TOKEN)
  })

  it('neither token appears in a network error from either hop', async () => {
    const leaky =
      (message: string): AppConfigFetch =>
      async (url) => {
        if (new URL(url).pathname === '/api/estate/app-config') throw new Error(message)
        return response(200, JSON.stringify({ value: MINTED }))
      }
    const portalHop = (await get(actionsEnv(), leaky(`failed with Bearer ${MINTED}`)).catch(
      (e: unknown) => e,
    )) as AppConfigError
    expect(portalHop.code).toBe('network')
    expect(portalHop.message).not.toContain(MINTED)

    const oidcHop = (await get(actionsEnv(), async () => {
      throw new Error(`failed with Bearer ${REQUEST_TOKEN} and ${MINTED}`)
    }).catch((e: unknown) => e)) as AppConfigError
    expect(oidcHop.code).toBe('oidc')
    expect(oidcHop.message).not.toContain(REQUEST_TOKEN)
    expect(oidcHop.message).not.toContain(MINTED)
  })

  it('scrubs the Actions request token and a JWT', () => {
    const env = actionsEnv()
    const text = scrubAppConfigSecrets(`a ${REQUEST_TOKEN} b ${MINTED} c`, env)
    expect(text).toBe('a [redacted] b [redacted] c')
  })
})
