/**
 * Password hashing and verification using Web Crypto API (PBKDF2-SHA256).
 * Safe for Cloudflare Workers — no Node.js crypto required.
 *
 * Verification also accepts an imported bcrypt hash (`$2a$`, `$2b$`, `$2y$`, as
 * Supabase `auth.users.encrypted_password` stores) through pure-JS `bcryptjs`, so an
 * app can move users over without a password reset. New hashes are always PBKDF2:
 * callers that see `isBcryptPasswordHash()` rewrite the row after a successful check.
 */
import bcrypt from 'bcryptjs'

const SALT_LENGTH = 16
const ITERATIONS = 100_000
const KEY_LENGTH = 256
/** Imported bcrypt hashes above this cost fail closed; Supabase writes cost 10. */
const MAX_BCRYPT_COST = 12
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/u

/** True when `stored` is a well-formed bcrypt hash this module will verify. */
export function isBcryptPasswordHash(stored: string): boolean {
  const match = BCRYPT_HASH_PATTERN.exec(stored)
  return match !== null && Number(match[1]) <= MAX_BCRYPT_COST
}

async function verifyBcryptPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, stored)
  } catch {
    return false
  }
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return out
}

/**
 * Hash a password with a random salt. Returns "salt:hash" in hex.
 */
export async function hashUserPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(0) as ArrayBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    KEY_LENGTH,
  )
  return `${toHex(salt)}:${toHex(bits)}`
}

/**
 * Verify a password against a stored "salt:hash" string, or an imported bcrypt hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function verifyUserPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) {
    return isBcryptPasswordHash(stored) ? verifyBcryptPassword(password, stored) : false
  }
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = fromHex(saltHex)
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(0) as ArrayBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    KEY_LENGTH,
  )
  const computed = toHex(bits)
  if (computed.length !== hashHex.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i)
  }
  return diff === 0
}
