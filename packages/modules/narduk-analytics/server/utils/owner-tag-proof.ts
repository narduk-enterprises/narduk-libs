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

/** Fixed HMAC payload. The cookie is the signature; the secret never leaves the server. */
export const OWNER_PROOF_PAYLOAD = 'narduk-owner-proof:v1'

export const OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

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

export async function signOwnerProof(secret: string): Promise<string> {
  if (!secret) {
    throw new Error('OWNER_TAG_SECRET is required to sign the owner proof cookie.')
  }

  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(OWNER_PROOF_PAYLOAD),
  )
  return toHex(new Uint8Array(signature))
}

export async function verifyOwnerProof(secret: string, token: string): Promise<boolean> {
  if (!secret || !token) return false

  try {
    const expected = await signOwnerProof(secret)
    return timingSafeEqual(expected, token)
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
