import { base64UrlEncode } from './apns-token.js'
import { NotifyError } from './errors.js'

/**
 * Web Push: VAPID (RFC 8292) authentication and `aes128gcm` payload
 * encryption (RFC 8291 over RFC 8188), on Web Crypto only. It runs unchanged
 * in Cloudflare Workers and Node 22+.
 */

/** A browser `PushSubscription.toJSON()`: the endpoint and its two key secrets. */
export interface WebPushSubscription {
  endpoint: string
  keys: {
    /** base64url, the 65-byte uncompressed P-256 point of the user agent. */
    p256dh: string
    /** base64url, the 16-byte authentication secret. */
    auth: string
  }
}

export interface VapidConfig {
  /** `mailto:` or `https:` contact for the push service operator. */
  subject: string
  /** base64url, the 65-byte uncompressed P-256 point. Browsers take it as `applicationServerKey`. */
  publicKey: string
  /** base64url, the 32-byte private scalar `d`. Read it from a secret binding. */
  privateKey: string
}

export type WebPushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface WebPushMessage {
  /** At most {@link WEB_PUSH_MAX_PAYLOAD_BYTES} bytes; a string is sent as UTF-8. Omit for a bare wake-up. */
  payload?: string | Uint8Array
  /** Seconds the push service may hold the message while the device is offline, 0 to 2419200. */
  ttlSeconds: number
  urgency?: WebPushUrgency
  /** Replaces a queued message with the same topic. Up to 32 base64url characters. */
  topic?: string
}

export type WebPushFailureReason =
  | 'gone'
  | 'rate_limited'
  | 'payload_too_large'
  | 'bad_request'
  | 'unauthorized'
  | 'server_error'
  | 'network_error'
  | 'endpoint_not_allowed'

export type WebPushResult =
  | { ok: true; status: number; location: string | null }
  | {
      ok: false
      status: number | null
      reason: WebPushFailureReason
      retryAfterSeconds: number | null
    }

export interface WebPushOptions {
  /** Hosts the endpoint must match: exact (`fcm.googleapis.com`) or `*.` suffix. Replaces the defaults. */
  allowedHosts?: readonly string[]
  fetch?: typeof fetch
  /** Milliseconds since the epoch, like `Date.now`. */
  now?: () => number
}

/** The push services browsers use. `*.` entries match subdomains only, never the bare domain. */
export const DEFAULT_WEB_PUSH_HOSTS: readonly string[] = Object.freeze([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '*.notify.windows.com',
  '*.push.apple.com',
])

/** Push services cap the POST body at 4096 bytes: an 86-byte header, one record, a 1-byte delimiter and a 16-byte tag. */
export const WEB_PUSH_MAX_PAYLOAD_BYTES = 3993
export const WEB_PUSH_MAX_TTL_SECONDS = 2_419_200
export const DEFAULT_VAPID_EXPIRY_SECONDS = 12 * 60 * 60
export const MAX_VAPID_EXPIRY_SECONDS = 24 * 60 * 60

const DEFAULT_RECORD_SIZE = 4096
const AES_GCM_TAG_BYTES = 16
const UNCOMPRESSED_POINT_BYTES = 65
const AUTH_SECRET_BYTES = 16
const SALT_BYTES = 16
const VAPID_REFRESH_MARGIN_SECONDS = 60 * 60
const VAPID_CACHE_LIMIT = 256

const encoder = new TextEncoder()

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function base64UrlDecode(
  value: string,
  name: string,
  expectedBytes: number,
): Uint8Array<ArrayBuffer> {
  const trimmed = value.trim()
  // Browsers emit unpadded base64url; tolerate padding and the standard alphabet.
  // Strip padding with a loop: `/=+$/` backtracks quadratically on a long run of '='.
  let end = trimmed.length
  while (end > 0 && trimmed[end - 1] === '=') {
    end -= 1
  }
  const normalized = trimmed.slice(0, end).replaceAll('+', '-').replaceAll('/', '_')
  if (!/^[\w-]+$/u.test(normalized) || normalized.length % 4 === 1) {
    throw new NotifyError('invalid_credentials', `${name} is not base64url`)
  }
  const binary = atob(normalized.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (bytes.length !== expectedBytes) {
    throw new NotifyError(
      'invalid_credentials',
      `${name} must be ${expectedBytes} bytes, got ${bytes.length}`,
    )
  }
  return bytes
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function toBytes(payload: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof payload === 'string' ? encoder.encode(payload) : new Uint8Array(payload)
}

// ---------------------------------------------------------------------------
// Encryption: RFC 8291 over RFC 8188 (aes128gcm), one record
// ---------------------------------------------------------------------------

async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits),
  )
}

/**
 * Encrypt one push message for a subscription: the RFC 8188 header (salt,
 * record size, sender key as key id) followed by a single AES-128-GCM record.
 * `salt`, `senderKeyPair` and `recordSize` exist for the RFC's test vector;
 * production callers leave them out so every message gets a fresh salt and key.
 */
export async function encryptWebPushPayload(
  plaintext: Uint8Array,
  keys: WebPushSubscription['keys'],
  options: {
    recordSize?: number
    salt?: Uint8Array
    senderKeyPair?: CryptoKeyPair
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(keys.p256dh, 'p256dh', UNCOMPRESSED_POINT_BYTES)
  const authSecret = base64UrlDecode(keys.auth, 'auth', AUTH_SECRET_BYTES)
  const recordSize = options.recordSize ?? DEFAULT_RECORD_SIZE
  if (
    !Number.isInteger(recordSize) ||
    recordSize < AES_GCM_TAG_BYTES + 2 ||
    recordSize > 2 ** 32 - 1
  ) {
    throw new RangeError('recordSize must be an integer from 18 to 2^32-1')
  }
  if (plaintext.length + 1 + AES_GCM_TAG_BYTES > recordSize) {
    throw new NotifyError(
      'payload_too_large',
      `payload of ${plaintext.length} bytes does not fit one ${recordSize}-byte record`,
    )
  }
  const salt = options.salt
    ? new Uint8Array(options.salt)
    : crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  if (salt.length !== SALT_BYTES) throw new RangeError(`salt must be ${SALT_BYTES} bytes`)

  let uaKey: CryptoKey
  try {
    uaKey = await crypto.subtle.importKey(
      'raw',
      uaPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )
  } catch {
    throw new NotifyError('invalid_credentials', 'p256dh is not a valid P-256 public key')
  }
  const sender =
    options.senderKeyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey))

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  )
  // RFC 8291 3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(
    ecdhSecret,
    authSecret,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    256,
  )
  // RFC 8188 2.2 and 2.3
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // Last (and only) record: plaintext, then the 0x02 delimiter.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: AES_GCM_TAG_BYTES * 8 },
      key,
      concat(plaintext, new Uint8Array([2])),
    ),
  )

  const header = new Uint8Array(SALT_BYTES + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(SALT_BYTES, recordSize, false)
  header[SALT_BYTES + 4] = asPublic.length
  return concat(header, asPublic, record)
}

// ---------------------------------------------------------------------------
// VAPID: RFC 8292
// ---------------------------------------------------------------------------

/** A fresh VAPID key pair: base64url public point and base64url private scalar. */
export async function generateVapidKeys(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  if (!jwk.d) throw new Error('private key export carried no scalar')
  return { publicKey: base64UrlEncode(raw), privateKey: jwk.d }
}

function validateSubject(subject: string): void {
  if (!/^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]\S*)$/u.test(subject)) {
    throw new NotifyError('invalid_credentials', 'VAPID subject must be a mailto: or https: URL')
  }
}

async function importVapidSigningKey(vapid: VapidConfig): Promise<CryptoKey> {
  const publicPoint = base64UrlDecode(vapid.publicKey, 'VAPID public key', UNCOMPRESSED_POINT_BYTES)
  if (publicPoint[0] !== 4) {
    throw new NotifyError(
      'invalid_credentials',
      'VAPID public key must be an uncompressed P-256 point',
    )
  }
  const d = base64UrlDecode(vapid.privateKey, 'VAPID private key', 32)
  try {
    return await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: base64UrlEncode(publicPoint.subarray(1, 33)),
        y: base64UrlEncode(publicPoint.subarray(33, 65)),
        d: base64UrlEncode(d),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  } catch {
    throw new NotifyError('invalid_credentials', 'VAPID key pair is not a valid P-256 key')
  }
}

function endpointOrigin(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new NotifyError('invalid_notification', 'push endpoint is not a URL')
  }
  return url.origin
}

interface SignedVapid {
  authorization: string
  expiresAtSeconds: number
}

async function signVapid(
  endpoint: string,
  vapid: VapidConfig,
  nowSeconds: number,
  expiresInSeconds: number,
): Promise<SignedVapid> {
  if (
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    expiresInSeconds > MAX_VAPID_EXPIRY_SECONDS
  ) {
    throw new RangeError(`expiresInSeconds must be above 0 and at most ${MAX_VAPID_EXPIRY_SECONDS}`)
  }
  validateSubject(vapid.subject)
  const key = await importVapidSigningKey(vapid)
  const expiresAtSeconds = nowSeconds + Math.floor(expiresInSeconds)
  const signingInput = `${base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${base64UrlEncode(
    JSON.stringify({ aud: endpointOrigin(endpoint), exp: expiresAtSeconds, sub: vapid.subject }),
  )}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )
  const publicPoint = base64UrlDecode(vapid.publicKey, 'VAPID public key', UNCOMPRESSED_POINT_BYTES)
  // A private scalar that does not belong to the public key would 403 every push; catch it at signing.
  const verifyKey = await crypto.subtle
    .importKey('raw', publicPoint, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    .catch(() => {
      throw new NotifyError('invalid_credentials', 'VAPID public key is not a valid P-256 point')
    })
  const matches = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    signature,
    encoder.encode(signingInput),
  )
  if (!matches) {
    throw new NotifyError('invalid_credentials', 'VAPID private key does not match the public key')
  }
  const publicKey = base64UrlEncode(publicPoint)
  return {
    authorization: `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${publicKey}`,
    expiresAtSeconds,
  }
}

/**
 * The `Authorization` header value for one push endpoint:
 * `vapid t=<ES256 JWT>, k=<public key>`. The JWT's `aud` is the endpoint's
 * origin, `sub` the configured contact, and `exp` defaults to 12 hours out
 * (RFC 8292 caps it at 24).
 */
export async function createVapidAuthorization(
  endpoint: string,
  vapid: VapidConfig,
  options: { expiresInSeconds?: number; now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now
  const signed = await signVapid(
    endpoint,
    vapid,
    Math.floor(now() / 1000),
    options.expiresInSeconds ?? DEFAULT_VAPID_EXPIRY_SECONDS,
  )
  return signed.authorization
}

// One signature per (audience, subject, key, lifetime) until an hour before it expires.
// The pending promise is cached, so parallel sends to one origin share a single signing.
interface CachedVapid {
  expiresAtSeconds: number
  signed: Promise<SignedVapid>
}
const vapidCache = new Map<string, CachedVapid>()

async function cachedVapidAuthorization(
  endpoint: string,
  vapid: VapidConfig,
  nowSeconds: number,
): Promise<string> {
  const cacheKey = [
    endpointOrigin(endpoint),
    vapid.subject,
    vapid.publicKey,
    vapid.privateKey,
  ].join('\n')
  const hit = vapidCache.get(cacheKey)
  if (hit && hit.expiresAtSeconds - nowSeconds > VAPID_REFRESH_MARGIN_SECONDS) {
    return (await hit.signed).authorization
  }
  const entry: CachedVapid = {
    expiresAtSeconds: nowSeconds + DEFAULT_VAPID_EXPIRY_SECONDS,
    signed: signVapid(endpoint, vapid, nowSeconds, DEFAULT_VAPID_EXPIRY_SECONDS),
  }
  if (vapidCache.size >= VAPID_CACHE_LIMIT) vapidCache.clear()
  vapidCache.set(cacheKey, entry)
  try {
    return (await entry.signed).authorization
  } catch (error) {
    if (vapidCache.get(cacheKey) === entry) vapidCache.delete(cacheKey)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Endpoint allowlist (SSRF guard)
// ---------------------------------------------------------------------------

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase()
  if (p.startsWith('*.')) {
    const suffix = p.slice(1) // ".notify.windows.com"
    return suffix.length > 1 && host.length > suffix.length && host.endsWith(suffix)
  }
  return p !== '' && !p.includes('*') && host === p
}

/**
 * True only for an `https:` URL with no port, no credentials, a DNS host (never
 * an IP literal) and a host on the allowlist. A subscription endpoint comes
 * from a client, so without this the server would POST to any URL it names.
 */
export function isAllowedPushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[] = DEFAULT_WEB_PUSH_HOSTS,
): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.port !== '' || url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || /^[\d.]+$/u.test(host) || host.endsWith('.')) return false
  return allowedHosts.some((pattern) => hostMatches(host, pattern))
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/u.test(value)) return Number(value)
  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - nowMs) / 1000))
}

function validateMessage(message: WebPushMessage): void {
  const { ttlSeconds, urgency, topic } = message
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0 || ttlSeconds > WEB_PUSH_MAX_TTL_SECONDS) {
    throw new NotifyError(
      'invalid_notification',
      `ttlSeconds must be an integer from 0 to ${WEB_PUSH_MAX_TTL_SECONDS}`,
    )
  }
  if (urgency !== undefined && !['very-low', 'low', 'normal', 'high'].includes(urgency)) {
    throw new NotifyError('invalid_notification', 'urgency must be very-low, low, normal or high')
  }
  if (topic !== undefined && !/^[\w-]{1,32}$/u.test(topic)) {
    throw new NotifyError(
      'invalid_notification',
      'topic must be 1 to 32 characters of the base64url alphabet',
    )
  }
}

function failure(
  status: number | null,
  reason: WebPushFailureReason,
  retryAfterSeconds: number | null = null,
): WebPushResult {
  return { ok: false, status, reason, retryAfterSeconds }
}

/**
 * Send one Web Push message. A delivery outcome is always a result, never a
 * throw; a `gone` result means the subscription is dead and should be deleted.
 * It throws `NotifyError` only for caller mistakes: bad keys, TTL, topic or
 * urgency.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  message: WebPushMessage,
  vapid: VapidConfig,
  options: WebPushOptions = {},
): Promise<WebPushResult> {
  validateMessage(message)
  const now = options.now ?? Date.now
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  const plaintext =
    message.payload === undefined || message.payload.length === 0
      ? undefined
      : toBytes(message.payload)
  if (plaintext && plaintext.length > WEB_PUSH_MAX_PAYLOAD_BYTES)
    return failure(null, 'payload_too_large')
  if (!isAllowedPushEndpoint(subscription.endpoint, options.allowedHosts)) {
    return failure(null, 'endpoint_not_allowed')
  }

  const body = plaintext ? await encryptWebPushPayload(plaintext, subscription.keys) : undefined
  const headers: Record<string, string> = {
    Authorization: await cachedVapidAuthorization(
      subscription.endpoint,
      vapid,
      Math.floor(now() / 1000),
    ),
    TTL: String(message.ttlSeconds),
  }
  if (body) {
    headers['Content-Encoding'] = 'aes128gcm'
    headers['Content-Type'] = 'application/octet-stream'
  } else {
    headers['Content-Length'] = '0'
  }
  if (message.urgency) headers.Urgency = message.urgency
  if (message.topic) headers.Topic = message.topic

  let response: Response
  try {
    response = await doFetch(subscription.endpoint, {
      method: 'POST',
      headers,
      body,
      // A push service has no reason to redirect; following one would bypass the allowlist.
      redirect: 'manual',
    })
  } catch {
    return failure(null, 'network_error')
  }
  try {
    await response.body?.cancel()
  } catch {
    // The status is all that matters; a body that will not cancel is not a delivery failure.
  }

  const { status } = response
  if (status >= 200 && status < 300) {
    return { ok: true, status, location: response.headers.get('Location') }
  }
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), now())
  if (status === 404 || status === 410) return failure(status, 'gone')
  if (status === 413) return failure(status, 'payload_too_large')
  if (status === 429) return failure(status, 'rate_limited', retryAfter)
  if (status === 401 || status === 403) return failure(status, 'unauthorized')
  if (status >= 500) return failure(status, 'server_error', retryAfter)
  return failure(status, 'bad_request')
}
