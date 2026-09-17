import { createError, deleteCookie, getCookie, setCookie } from 'h3'

import type { H3Event } from 'h3'

/**
 * Client-readable owner flag. `posthog.client` looks for `narduk_owner=true`
 * on `document.cookie` to set the `is_owner` super-property. It must stay
 * unsigned and `httpOnly: false`.
 */
export const OWNER_FLAG_COOKIE = 'narduk_owner'

/**
 * HttpOnly HMAC proof that `/api/owner/posthog-bootstrap` accepts. Named
 * `__Host-` only when `Secure` is on (`path: '/'`, no `Domain`); plain HTTP
 * dev cannot use the prefix.
 */
export const OWNER_PROOF_COOKIE = 'narduk_owner_proof'
export const OWNER_PROOF_HOST_COOKIE = '__Host-narduk_owner_proof'

/** v2 payload prefix. The cookie is `iat.hex(HMAC-SHA256(secret, prefix:iat))`. */
export const OWNER_PROOF_PAYLOAD_PREFIX = 'narduk-owner-proof:v2'

export const OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** Server-side max age. Cookie Max-Age is not a security boundary. */
export const OWNER_PROOF_MAX_AGE_SECONDS = OWNER_COOKIE_MAX_AGE_SECONDS

/** Allow a short future iat so a host clock a few seconds ahead still verifies. */
const OWNER_PROOF_CLOCK_SKEW_SECONDS = 60

export interface OwnerBootstrapConfig {
  ownerTagSecret: string
  posthogOwnerDistinctId: string
}

export interface ApplyOwnerTagCookiesOptions {
  enabled: boolean
  secret: string
  secure: boolean
}

export function ownerProofCookieName(secure: boolean): string {
  return secure ? OWNER_PROOF_HOST_COOKIE : OWNER_PROOF_COOKIE
}

export function ownerFlagCookieOptions(secure: boolean) {
  return {
    httpOnly: false,
    maxAge: OWNER_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax' as const,
    secure,
  }
}

export function ownerProofCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: OWNER_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax' as const,
    secure,
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(new Uint8Array(signature))
}

function proofPayload(iat: number): string {
  return `${OWNER_PROOF_PAYLOAD_PREFIX}:${iat}`
}

export async function signOwnerProof(secret: string, nowMs: number = Date.now()): Promise<string> {
  if (!secret) {
    throw new Error('OWNER_TAG_SECRET is required to sign the owner proof cookie.')
  }

  const iat = Math.floor(nowMs / 1000)
  const signature = await hmacHex(secret, proofPayload(iat))
  return `${iat}.${signature}`
}

export async function verifyOwnerProof(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret || !token) return false

  const separator = token.indexOf('.')
  if (separator <= 0) return false

  const iatRaw = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!/^\d+$/u.test(iatRaw) || !/^[0-9a-f]+$/u.test(signature)) return false

  const iat = Number(iatRaw)
  if (!Number.isSafeInteger(iat)) return false

  const nowSec = Math.floor(nowMs / 1000)
  if (iat > nowSec + OWNER_PROOF_CLOCK_SKEW_SECONDS) return false
  if (nowSec - iat > OWNER_PROOF_MAX_AGE_SECONDS) return false

  try {
    const expected = await hmacHex(secret, proofPayload(iat))
    return timingSafeEqual(expected, signature)
  } catch {
    return false
  }
}

function deleteOwnerProofCookie(event: H3Event, name: string): void {
  deleteCookie(event, name, {
    path: '/',
    ...(name.startsWith('__Host-') ? { secure: true } : {}),
  })
}

export function readOwnerProofCookie(event: H3Event): string | undefined {
  const hostProof = getCookie(event, OWNER_PROOF_HOST_COOKIE)
  if (hostProof) return hostProof
  return getCookie(event, OWNER_PROOF_COOKIE)
}

export function clearOwnerTagCookies(event: H3Event): void {
  deleteCookie(event, OWNER_FLAG_COOKIE, { path: '/' })
  deleteOwnerProofCookie(event, OWNER_PROOF_COOKIE)
  deleteOwnerProofCookie(event, OWNER_PROOF_HOST_COOKIE)
}

export async function applyOwnerTagCookies(
  event: H3Event,
  options: ApplyOwnerTagCookiesOptions,
): Promise<void> {
  if (!options.enabled) {
    clearOwnerTagCookies(event)
    return
  }

  const proofName = ownerProofCookieName(options.secure)
  const otherProofName = ownerProofCookieName(!options.secure)
  const proof = await signOwnerProof(options.secret)

  setCookie(event, OWNER_FLAG_COOKIE, 'true', ownerFlagCookieOptions(options.secure))
  setCookie(event, proofName, proof, ownerProofCookieOptions(options.secure))
  deleteOwnerProofCookie(event, otherProofName)
}

function rejectOwnerBootstrap(): never {
  throw createError({
    statusCode: 403,
    message: 'Owner cookie required. POST /api/owner-tag with OWNER_TAG_SECRET first.',
  })
}

/**
 * Release `POSTHOG_OWNER_DISTINCT_ID` only when this browser was tagged with
 * `OWNER_TAG_SECRET`. The unsigned `narduk_owner` flag is not sufficient.
 */
export async function loadOwnerPosthogBootstrap(
  event: H3Event,
  config: OwnerBootstrapConfig,
): Promise<{ distinctId: string }> {
  if (getCookie(event, OWNER_FLAG_COOKIE) !== 'true') {
    rejectOwnerBootstrap()
  }

  const proof = readOwnerProofCookie(event)
  const valid = await verifyOwnerProof(config.ownerTagSecret, proof ?? '')
  if (!valid) {
    rejectOwnerBootstrap()
  }

  const distinctId = String(config.posthogOwnerDistinctId ?? '').trim()
  if (!distinctId) {
    throw createError({
      statusCode: 501,
      message:
        'POSTHOG_OWNER_DISTINCT_ID is not set. Add it to server runtime config (Vault) to enable cross-browser owner identity.',
    })
  }

  return { distinctId }
}
