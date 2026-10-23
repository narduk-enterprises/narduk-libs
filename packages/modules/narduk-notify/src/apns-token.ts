import { NotifyError } from './errors.js'

/**
 * The APNs token-auth key: team, key id and the `.p8` contents.
 *
 * `privateKey` is the key material itself, read at runtime from a secret
 * binding that nvault fills (a Worker secret, or `nvault run -- <cmd>` in
 * Node). There is deliberately no file-path option: a string that looks like
 * a path is refused, so a `.p8` on disk can never become the source of truth.
 */
export interface ApnsCredentials {
  keyId: string
  privateKey: CryptoKey | string
  teamId: string
}

export interface ApnsTokenProvider {
  /**
   * Drop the cached token, e.g. after APNs answers `ExpiredProviderToken`.
   * Given the token that failed, it drops only that one, so parallel sends
   * that all saw the old token re-sign once, not once each.
   */
  invalidate: (stale?: string) => void
  token: () => Promise<string>
}

export interface ApnsTokenProviderOptions {
  now?: () => number
  /**
   * Apple refuses a provider token older than an hour and throttles one
   * refreshed more often than every 20 minutes. 40 minutes sits inside both.
   */
  refreshAfterSeconds?: number
}

export const DEFAULT_APNS_TOKEN_REFRESH_SECONDS = 40 * 60

const PEM_HEADER = '-----BEGIN PRIVATE KEY-----'
const PEM_FOOTER = '-----END PRIVATE KEY-----'

function requireTrimmed(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new NotifyError('invalid_credentials', `${name} is required`)
  return trimmed
}

function looksLikePath(value: string): boolean {
  return /\.p8$/iu.test(value) || /^(?:\/|\.{1,2}\/|~\/|[A-Za-z]:\\)/u.test(value)
}

/**
 * Import a `.p8` (PKCS#8 PEM, or its bare base64 body) for ES256 signing.
 * Escaped `\n` sequences, as some secret stores keep them, are accepted.
 */
export async function importApnsPrivateKey(p8: string): Promise<CryptoKey> {
  const value = p8.includes('\\n') ? p8.replaceAll('\\n', '\n') : p8
  const trimmed = value.trim()
  if (!trimmed) throw new NotifyError('invalid_credentials', 'APNs private key is empty')
  if (trimmed.includes('BEGIN EC PRIVATE KEY')) {
    throw new NotifyError(
      'invalid_credentials',
      'APNs private key must be PKCS#8 (BEGIN PRIVATE KEY), as Apple issues the .p8; SEC1 EC keys are not supported',
    )
  }
  if (!trimmed.includes(PEM_HEADER) && looksLikePath(trimmed)) {
    throw new NotifyError(
      'invalid_credentials',
      'APNs private key must be the key contents from a secret binding, never a file path',
    )
  }
  const body = trimmed.replaceAll(PEM_HEADER, '').replaceAll(PEM_FOOTER, '').replaceAll(/\s/gu, '')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const binary = atob(body)
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    throw new NotifyError('invalid_credentials', 'APNs private key is not valid base64 PEM')
  }
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      bytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  } catch {
    throw new NotifyError('invalid_credentials', 'APNs private key is not a P-256 PKCS#8 key')
  }
}

export function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Sign one APNs provider token: ES256, `kid` header, `iss` team and `iat`.
 * Web Crypto returns the raw r||s signature JWS wants in Node and workerd alike.
 */
export async function createApnsProviderToken(
  credentials: ApnsCredentials,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const keyId = requireTrimmed(credentials.keyId, 'keyId')
  const teamId = requireTrimmed(credentials.teamId, 'teamId')
  const key =
    typeof credentials.privateKey === 'string'
      ? await importApnsPrivateKey(credentials.privateKey)
      : credentials.privateKey
  const signingInput = `${base64UrlEncode(JSON.stringify({ alg: 'ES256', kid: keyId }))}.${base64UrlEncode(
    JSON.stringify({ iss: teamId, iat: issuedAtSeconds }),
  )}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/**
 * A cached provider token: one signature per refresh window, shared by
 * concurrent callers, and the key imported once.
 */
export function createApnsTokenProvider(
  credentials: ApnsCredentials,
  options: ApnsTokenProviderOptions = {},
): ApnsTokenProvider {
  const now = options.now ?? Date.now
  const refreshAfterSeconds = options.refreshAfterSeconds ?? DEFAULT_APNS_TOKEN_REFRESH_SECONDS
  if (!Number.isFinite(refreshAfterSeconds) || refreshAfterSeconds <= 0) {
    throw new RangeError('refreshAfterSeconds must be a finite positive number')
  }
  let keyPromise: Promise<CryptoKey> | undefined
  let cached: { issuedAtSeconds: number; token: Promise<string>; value?: string } | undefined

  const key = (): Promise<CryptoKey> => {
    if (typeof credentials.privateKey !== 'string') return Promise.resolve(credentials.privateKey)
    keyPromise ??= importApnsPrivateKey(credentials.privateKey)
    return keyPromise
  }

  return {
    invalidate: (stale) => {
      if (stale === undefined || cached?.value === stale) cached = undefined
    },
    token: () => {
      const nowSeconds = Math.floor(now() / 1000)
      if (!cached || nowSeconds - cached.issuedAtSeconds >= refreshAfterSeconds) {
        const pending = key().then((privateKey) =>
          createApnsProviderToken({ ...credentials, privateKey }, nowSeconds),
        )
        const entry: NonNullable<typeof cached> = { issuedAtSeconds: nowSeconds, token: pending }
        cached = entry
        const settle = async (): Promise<void> => {
          try {
            entry.value = await pending
          } catch {
            if (cached === entry) cached = undefined
          }
        }
        void settle()
      }
      return cached.token
    },
  }
}
