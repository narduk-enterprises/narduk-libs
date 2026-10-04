import { GrantType, OAuthError } from '@cloudflare/workers-oauth-provider'

import type { ResolvedMcpOAuthConfig } from './config'
import type { createD1KvNamespace, McpOAuthKvNamespace } from './d1-kv'
import type {
  Grant,
  OAuthHelpers,
  TokenExchangeCallbackOptions,
  ValidatedAccessToken,
} from '@cloudflare/workers-oauth-provider'

export const RUNNER_ISSUER = 'https://ops.nardukenterprises.com'
export const RUNNER_RESOURCE = 'https://runner-hooks.nard.uk/mcp'
export const RUNNER_BRIDGE_PATH = '/api/auth/mcp/runner-bridge'
export const RUNNER_SCOPES = ['runner:transitions:read', 'runner:events:subscribe'] as const
const DAY = 86400
const text = (value: unknown, max = 160): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  /^[\x21-\x7e]+$/u.test(value) &&
  !value.includes('*')

export interface RunnerOAuthPolicy {
  clientId: string
  /** Fresh authoritative account/allowlist check; failure throws, false is verified refusal. */
  eligible(subject: string): Promise<boolean>
  subject: string
}

/** One fixed opt-in audience alongside the Portal; never an arbitrary resource registry. */
export function runnerCoexistenceConfig(config: ResolvedMcpOAuthConfig): ResolvedMcpOAuthConfig {
  if (
    config.issuer !== RUNNER_ISSUER ||
    config.resource !== `${RUNNER_ISSUER}/mcp` ||
    config.resourcePath !== '/mcp' ||
    config.scopes.some((scope) => RUNNER_SCOPES.includes(scope as (typeof RUNNER_SCOPES)[number]))
  )
    throw new Error('Runner coexistence requires the unchanged native Portal audience and scopes')
  return {
    ...config,
    resourceUri: RUNNER_RESOURCE,
    resource: RUNNER_RESOURCE,
    scopes: [...RUNNER_SCOPES],
    requiredScopes: [RUNNER_SCOPES[0]],
    accessTokenTtl: 3600,
    refreshTokenTtl: 7 * DAY,
    refreshTokenIdleTtl: DAY,
  }
}

function checkPolicy(config: ResolvedMcpOAuthConfig, policy: RunnerOAuthPolicy) {
  if (
    config.resource === `${config.issuer}${config.resourcePath}` ||
    !text(policy.subject, 96) ||
    policy.subject.includes(':') ||
    !text(policy.clientId) ||
    typeof policy.eligible !== 'function' ||
    config.accessTokenTtl > 3600 ||
    config.refreshTokenTtl > 7 * DAY ||
    config.refreshTokenIdleTtl > DAY ||
    config.scopes.some((scope) => !RUNNER_SCOPES.includes(scope as (typeof RUNNER_SCOPES)[number]))
  ) {
    throw new Error('Exact external runner OAuth policy and bounded lifetimes required')
  }
}

const activityKey = (subject: string, grantId: string) =>
  `narduk-runner-activity:${subject}:${grantId}`
const identity = (config: ResolvedMcpOAuthConfig, policy: RunnerOAuthPolicy, grantId: string) => ({
  issuer: config.issuer,
  resource: config.resource,
  subject: policy.subject,
  clientId: policy.clientId,
  grantId,
})

/** Validated code/refresh exchanges alone renew activity; bridge reads never do. */
export function runnerTokenExchange({
  kv,
  config,
  policy,
}: {
  config: ResolvedMcpOAuthConfig
  kv: McpOAuthKvNamespace
  policy: RunnerOAuthPolicy
}) {
  checkPolicy(config, policy)
  return async (input: TokenExchangeCallbackOptions) => {
    if (
      ![GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN].includes(input.grantType) ||
      input.userId !== policy.subject ||
      input.clientId !== policy.clientId ||
      input.subjectClientId !== policy.clientId ||
      input.resource !== config.resource ||
      !text(input.grantId, 96) ||
      input.grantId.includes(':') ||
      input.scope.some((scope) => !RUNNER_SCOPES.includes(scope as (typeof RUNNER_SCOPES)[number]))
    ) {
      throw new OAuthError('invalid_grant', { description: 'Runner connection refused' })
    }
    if (!(await policy.eligible(input.userId)))
      throw new OAuthError('invalid_grant', { description: 'Runner account refused' })
    const now = Math.floor(Date.now() / 1000)
    const grant = (await kv.get(`grant:${policy.subject}:${input.grantId}`, 'json')) as Grant | null
    if (
      !grant ||
      !Number.isSafeInteger(grant.createdAt) ||
      grant.createdAt > now ||
      grant.resource !== config.resource ||
      grant.clientId !== policy.clientId ||
      grant.userId !== policy.subject ||
      grant.createdAt + 7 * DAY - now < 60
    )
      throw new OAuthError('invalid_grant', { description: 'Runner grant expired' })
    const prior = (await kv.get(activityKey(policy.subject, input.grantId), 'json')) as {
      lastActiveAt: number
    } | null
    if (
      prior &&
      (!Number.isSafeInteger(prior.lastActiveAt) ||
        prior.lastActiveAt < grant.createdAt ||
        prior.lastActiveAt > now)
    ) {
      throw new OAuthError('temporarily_unavailable', {
        description: 'Runner activity unavailable',
        statusCode: 503,
      })
    }
    if (
      input.grantType === GrantType.REFRESH_TOKEN &&
      (!prior || prior.lastActiveAt + config.refreshTokenIdleTtl <= now)
    ) {
      throw new OAuthError('invalid_grant', { description: 'Runner grant idle expiry' })
    }
    await kv.put(
      activityKey(policy.subject, input.grantId),
      JSON.stringify({ lastActiveAt: now }),
      {
        expiration: grant.createdAt + 7 * DAY,
      },
    )
    const remaining = grant.createdAt + 7 * DAY - now
    return {
      accessTokenTTL: Math.min(config.accessTokenTtl, remaining),
      refreshTokenTTL: Math.min(config.refreshTokenTtl, remaining),
      refreshTokenIdleTTL: Math.min(config.refreshTokenIdleTtl, remaining),
    }
  }
}

/** Exact KV grant lookup is version-coupled to pinned workers-oauth-provider 1.2.1. */
async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  const collect = async (): Promise<string | null> => {
    const next = await reader.read()
    if (!next.done) {
      size += next.value.length
      if (size > 8192 || chunks.length >= 128) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(next.value)
      return collect()
    }
    const buffer = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      return null
    }
  }
  return collect()
}

export function createRunnerBridge(
  mcp: {
    api(): OAuthHelpers
    config: ResolvedMcpOAuthConfig
    kv: ReturnType<typeof createD1KvNamespace>
    validate(
      token: string,
    ): Promise<
      (ValidatedAccessToken<{ clientId: string; userId: string }> & { grantId: string }) | null
    >
  },
  policy: RunnerOAuthPolicy,
) {
  checkPolicy(mcp.config, policy)
  const same = (input: Record<string, unknown>) =>
    input.issuer === mcp.config.issuer &&
    input.resource === mcp.config.resource &&
    input.subject === policy.subject &&
    input.clientId === policy.clientId &&
    text(input.grantId, 96) &&
    !input.grantId.includes(':')
  async function readGrant(input: Record<string, unknown>) {
    if (!same(input)) return { active: false }
    const grantId = input.grantId as string
    const grant = (await mcp.kv.get(`grant:${policy.subject}:${grantId}`, 'json')) as Grant | null
    if (!grant) return { ...identity(mcp.config, policy, grantId), active: false }
    if (
      grant.id !== grantId ||
      grant.userId !== policy.subject ||
      grant.clientId !== policy.clientId ||
      grant.resource !== mcp.config.resource ||
      !Array.isArray(grant.scope) ||
      !Number.isSafeInteger(grant.createdAt) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.scope.some((scope) => !RUNNER_SCOPES.includes(scope as (typeof RUNNER_SCOPES)[number]))
    )
      throw new Error('Unknown grant')
    const eligible = await policy.eligible(policy.subject)
    const activity = (await mcp.kv.get(activityKey(policy.subject, grantId), 'json')) as {
      lastActiveAt: number
    } | null
    if (!activity || !Number.isSafeInteger(activity.lastActiveAt))
      throw new Error('Unknown grant activity')
    return {
      ...identity(mcp.config, policy, grantId),
      active: true,
      ownerEligible: eligible,
      scopes: grant.scope,
      createdAt: grant.createdAt * 1000,
      lastActiveAt: activity.lastActiveAt * 1000,
      expiresAt:
        Math.min(
          grant.expiresAt!,
          grant.createdAt + 7 * DAY,
          activity.lastActiveAt + mcp.config.refreshTokenIdleTtl,
        ) * 1000,
    }
  }
  async function verifyAccessToken(input: Record<string, unknown>) {
    if (
      input.issuer !== mcp.config.issuer ||
      input.resource !== mcp.config.resource ||
      typeof input.token !== 'string' ||
      input.token.length > 4096
    )
      return null
    const valid = await mcp.validate(input.token)
    if (
      !valid ||
      valid.userId !== policy.subject ||
      valid.clientId !== policy.clientId ||
      valid.props?.userId !== valid.userId ||
      valid.props?.clientId !== valid.clientId
    )
      return null
    const grant = await readGrant(identity(mcp.config, policy, valid.grantId))
    if (!grant.active || !('ownerEligible' in grant) || !grant.ownerEligible) return null
    const summary = await mcp.api().unwrapToken(input.token)
    if (!summary) return null
    return {
      ...identity(mcp.config, policy, valid.grantId),
      scopes: valid.scope,
      issuedAt: summary.createdAt * 1000,
      expiresAt: valid.expiresAt * 1000,
    }
  }
  return async (request: Request, secret: string): Promise<Response> => {
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    if (!secret) return reply(404, { error: 'disabled' })
    if (request.method !== 'POST' || request.url !== `${mcp.config.issuer}${RUNNER_BRIDGE_PATH}`)
      return reply(404, { error: 'not_found' })
    // Only a signed service request authenticates here. Cookies/user bearers have no role.
    const id = request.headers.get('webhook-id') ?? ''
    const stamp = request.headers.get('webhook-timestamp') ?? ''
    const signature = request.headers.get('webhook-signature') ?? ''
    if (
      !/^[\w-]{16,80}$/u.test(id) ||
      !/^\d{10}$/u.test(stamp) ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 30 ||
      !/^v1,[A-Za-z0-9+/]{43}=$/u.test(signature)
    )
      return reply(401, { error: 'unauthorized' })
    if (Number(request.headers.get('content-length')) > 8192)
      return reply(413, { error: 'too_large' })
    const body = await boundedBody(request)
    if (body === null) return reply(413, { error: 'invalid_or_large_body' })
    if (new TextEncoder().encode(body).length > 8192) return reply(413, { error: 'too_large' })
    try {
      if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/u.test(secret)) throw new Error('Key refused')
      const bytes = Uint8Array.from(atob(secret.slice(6)), (char) => char.charCodeAt(0))
      if (bytes.length < 24 || bytes.length > 64) throw new Error('Key refused')
      const key = await crypto.subtle.importKey(
        'raw',
        bytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      const supplied = Uint8Array.from(atob(signature.slice(3)), (char) => char.charCodeAt(0))
      if (
        !(await crypto.subtle.verify(
          'HMAC',
          key,
          supplied,
          new TextEncoder().encode(`${id}.${stamp}.${body}`),
        ))
      )
        return reply(401, { error: 'unauthorized' })
      await mcp.kv.purgeExpiredPrefix('narduk-runner-bridge:', 50)
      if (!(await mcp.kv.claimOnce(`narduk-runner-bridge:${id}`, 120)))
        return reply(401, { error: 'replay' })
      const parsed = JSON.parse(body) as { input: Record<string, unknown>; method: string }
      if (
        !parsed ||
        Object.keys(parsed).sort().join() !== 'input,method' ||
        !parsed.input ||
        Array.isArray(parsed.input) ||
        typeof parsed.input !== 'object'
      )
        return reply(400, { error: 'invalid_request' })
      if (
        parsed.method === 'verifyAccessToken' &&
        Object.keys(parsed.input).sort().join() === 'issuer,resource,token'
      ) {
        return reply(200, { result: await verifyAccessToken(parsed.input) })
      }
      if (
        parsed.method === 'readGrant' &&
        Object.keys(parsed.input).sort().join() === 'clientId,grantId,issuer,resource,subject'
      ) {
        return reply(200, { result: await readGrant(parsed.input) })
      }
      return reply(400, { error: 'invalid_request' })
    } catch {
      return reply(503, { error: 'provider_unavailable' })
    }
  }
}
