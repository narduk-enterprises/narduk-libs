/**
 * The ISSUER half of traffic classification v1: minting the tokens that
 * `trafficClaim.ts` verifies. Kept beside the verifier so the two halves of
 * the format live in one package and cannot drift.
 *
 * Only the operator portal holds the private key (an ES256 P-256 private JWK
 * with a `kid`). No estate app imports this to sign anything; an app only
 * verifies, with the public keys in `TRAFFIC_CLAIM_PUBLIC_KEYS`.
 *
 * The wire format is frozen: header `{ alg, kid, typ: 'JWT' }`, the enroll
 * payload `{ typ, act, aud, iat, exp, jti, ret[, claim] }` and the class claim
 * `{ typ, cls: 'owner', aud, iat, exp }`, in that key order. Browsers already
 * hold class claims in this shape; changing it is a new classification version,
 * not an edit.
 *
 * WebCrypto only, no `#` aliases: safe to import from any Worker, Node or test.
 */
import { bytesToBase64Url, TRAFFIC_CLASS_TYP, TRAFFIC_ENROLL_TYP } from './trafficClaim'

/** Token life: long enough for one hop, short enough to be useless later. */
export const TRAFFIC_ENROLLMENT_TOKEN_SECONDS = 120
/** The class claim's life, and so the cookie's. */
export const TRAFFIC_CLAIM_SECONDS = 30 * 24 * 60 * 60

export type TrafficEnrollmentAct = 'clear' | 'enroll'

export interface TrafficSigner {
  key: CryptoKey
  kid: string
}

function base64Json(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/**
 * Import the private JWK. Null when the secret is unset or is not an ES256
 * P-256 private key with a `kid`: the issuer then reports itself unavailable
 * rather than sending a browser anywhere.
 */
export async function importTrafficSigner(secret: unknown): Promise<TrafficSigner | null> {
  if (typeof secret !== 'string' || !secret.trim()) return null
  let jwk: JsonWebKey & { kid?: unknown }
  try {
    jwk = JSON.parse(secret) as JsonWebKey & { kid?: unknown }
  } catch {
    return null
  }
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.d !== 'string' ||
    typeof jwk.kid !== 'string'
  ) {
    return null
  }
  const kid = jwk.kid
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    return { key, kid }
  } catch {
    return null
  }
}

/** Compact ES256 JWS. WebCrypto's ECDSA output is already the raw r||s form JWS uses. */
export async function signTrafficJws(
  payload: Record<string, unknown>,
  signer: TrafficSigner,
): Promise<string> {
  const input = `${base64Json({ alg: 'ES256', kid: signer.kid, typ: 'JWT' })}.${base64Json(payload)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signer.key,
    new TextEncoder().encode(input),
  )
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`
}

function enrollmentJti(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)))
}

export interface MintEnrollmentOptions {
  act: TrafficEnrollmentAct
  nowMs?: number
  /** `https://host`, the one origin this token is good for. */
  origin: string
  /** Where the origin sends the browser next; must be on a trusted issuer. */
  returnTo: string
}

/** One hop's token; for `enroll` it carries the class claim the origin will store. */
export async function mintEnrollmentToken(
  signer: TrafficSigner,
  options: MintEnrollmentOptions,
): Promise<string> {
  const iat = Math.floor((options.nowMs ?? Date.now()) / 1000)
  const payload: Record<string, unknown> = {
    typ: TRAFFIC_ENROLL_TYP,
    act: options.act,
    aud: options.origin,
    iat,
    exp: iat + TRAFFIC_ENROLLMENT_TOKEN_SECONDS,
    jti: enrollmentJti(),
    ret: options.returnTo,
  }
  if (options.act === 'enroll') {
    payload.claim = await signTrafficJws(
      {
        typ: TRAFFIC_CLASS_TYP,
        cls: 'owner',
        aud: options.origin,
        iat,
        exp: iat + TRAFFIC_CLAIM_SECONDS,
      },
      signer,
    )
  }
  return signTrafficJws(payload, signer)
}

const PROBE_TIMEOUT_MS = 2500
const PROBE_TTL_MS = 10 * 60 * 1000
const probeCache = new Map<string, { at: number; supported: boolean }>()

export interface ProbeEnrollmentOptions {
  fetchImpl?: typeof fetch
  nowMs?: number
  /** Should carry a `NardukAutomation/` marker so the probe is never counted as a visit. */
  userAgent?: string
}

/**
 * Does this origin serve `/api/owner/enroll` (this module's capability probe)?
 * Only `200 { "enrollment": 1 }` counts; a redirect, an HTML page, an error or
 * a timeout is "not yet". Answers are cached per isolate for ten minutes.
 */
export async function probeTrafficEnrollment(
  origin: string,
  options: ProbeEnrollmentOptions = {},
): Promise<boolean> {
  const nowMs = options.nowMs ?? Date.now()
  const cached = probeCache.get(origin)
  if (cached && nowMs - cached.at < PROBE_TTL_MS) return cached.supported
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  let supported = false
  try {
    const response = await fetchImpl(`${origin}/api/owner/enroll`, {
      headers: {
        accept: 'application/json',
        'user-agent': options.userAgent ?? 'narduk-analytics NardukAutomation/enrollment-probe',
      },
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.status === 200) {
      const body = (await response.json().catch(() => null)) as { enrollment?: unknown } | null
      supported = body?.enrollment === 1
    }
  } catch {
    supported = false
  } finally {
    clearTimeout(timer)
  }
  probeCache.set(origin, { at: nowMs, supported })
  return supported
}

export function resetTrafficEnrollmentProbeCache(): void {
  probeCache.clear()
}
