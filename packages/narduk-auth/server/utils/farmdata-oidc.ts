import { createError } from 'h3'
import { exportJWK, importPKCS8, SignJWT } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readWorkerRuntimeEnv } from '#layer/server/utils/worker-env'

import type { H3Event } from 'h3'

const SIGNING_ALGORITHM = 'RS256'
const DEFAULT_AUDIENCE = 'farmdata'
const DEFAULT_TOKEN_TTL_SECONDS = 900

interface FarmDataOIDCConfig {
  audience: string
  issuer: string
  keyID: string
  privateKey: string
  tokenTTLSeconds: number
}

interface FarmDataSigningMaterial {
  config: FarmDataOIDCConfig
  privateKey: CryptoKey
  publicJWK: Record<string, unknown>
}

const signingMaterialCache = new Map<string, Promise<FarmDataSigningMaterial>>()

function runtimeEnv(event: H3Event): Record<string, string | undefined> {
  const runtime = useRuntimeConfig(event) as Record<string, unknown>
  const worker = readWorkerRuntimeEnv(event) as Record<string, unknown>
  const output: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries({ ...runtime, ...worker })) {
    if (value !== undefined && value !== null) output[key] = String(value)
  }
  return output
}

function configForEvent(event: H3Event): FarmDataOIDCConfig {
  const env = runtimeEnv(event)
  const issuer = env.FARMDATA_OIDC_ISSUER?.trim() || ''
  const privateKey = env.FARMDATA_OIDC_PRIVATE_KEY?.trim() || ''
  if (!issuer || !privateKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'FarmData OIDC issuer is not configured.',
    })
  }

  const parsedTTL = Number.parseInt(env.FARMDATA_OIDC_TOKEN_TTL_SECONDS ?? '', 10)
  const tokenTTLSeconds = Number.isInteger(parsedTTL) && parsedTTL >= 60 && parsedTTL <= 3600
    ? parsedTTL
    : DEFAULT_TOKEN_TTL_SECONDS

  return {
    issuer: issuer.replace(/\/$/, ''),
    audience: env.FARMDATA_OIDC_AUDIENCE?.trim() || DEFAULT_AUDIENCE,
    privateKey,
    tokenTTLSeconds,
    keyID: env.FARMDATA_OIDC_KEY_ID?.trim() || 'farmdata-2026-01',
  }
}

async function signingMaterial(event: H3Event): Promise<FarmDataSigningMaterial> {
  const config = configForEvent(event)
  const cacheKey = `${config.issuer}:${config.keyID}:${config.privateKey}`
  const cached = signingMaterialCache.get(cacheKey)
  if (cached) return cached

  const pending = (async () => {
    const privateKey = await importPKCS8(config.privateKey, SIGNING_ALGORITHM)
    const privateJWK = await exportJWK(privateKey)
    const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJWK } = privateJWK
    return {
      config,
      privateKey,
      publicJWK: {
        ...publicJWK,
        alg: SIGNING_ALGORITHM,
        kid: config.keyID,
        use: 'sig',
      },
    }
  })()
  signingMaterialCache.set(cacheKey, pending)
  return pending
}

export async function farmDataOIDCConfiguration(event: H3Event) {
  const material = await signingMaterial(event)
  const base = material.config.issuer
  return {
    issuer: base,
    jwks_uri: `${base}/.well-known/jwks.json`,
    token_endpoint: `${base}/oauth/token`,
    token_endpoint_auth_methods_supported: ['none'],
    grant_types_supported: ['urn:narduk:params:oauth:grant-type:session'],
    response_types_supported: ['token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [SIGNING_ALGORITHM],
    claims_supported: ['sub', 'email', 'farm_id', 'farm_ids', 'aud', 'iss', 'iat', 'exp'],
  }
}

export async function farmDataOIDCJWKS(event: H3Event) {
  const material = await signingMaterial(event)
  return { keys: [material.publicJWK] }
}

export async function issueFarmDataAccessToken(
  event: H3Event,
  input: { email: string; farmIDs: string[]; subject: string },
): Promise<{ accessToken: string; audience: string; expiresIn: number; issuer: string }> {
  const material = await signingMaterial(event)
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + material.config.tokenTTLSeconds
  const farmIDs = [...new Set(input.farmIDs)].sort()
  const accessToken = await new SignJWT({
    email: input.email,
    farm_id: farmIDs[0],
    farm_ids: farmIDs,
    scope: 'farmdata:read',
  })
    .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: material.config.keyID, typ: 'JWT' })
    .setIssuer(material.config.issuer)
    .setAudience(material.config.audience)
    .setSubject(input.subject)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(crypto.randomUUID())
    .sign(material.privateKey)

  return {
    accessToken,
    audience: material.config.audience,
    expiresIn: material.config.tokenTTLSeconds,
    issuer: material.config.issuer,
  }
}
