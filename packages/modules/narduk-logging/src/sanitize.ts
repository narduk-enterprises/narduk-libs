import type { JsonValue, LogError, LogRecord, SafeFields } from './types.js'

export const MAX_RECORD_BYTES = 16 * 1024
const MAX_STRING = 2048
const MAX_FIELDS = 50
const MAX_DEPTH = 6
const MAX_NODES = 500
const PRIVATE = Symbol('narduk.logging.private')
const encoder = new TextEncoder()
const REDACTED = '[REDACTED]'
const SENSITIVE = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'session',
  'sessionid',
  'privatekey',
  'clientsecret',
  'body',
  'requestbody',
  'responsebody',
  'payload',
  'payment',
  'cardnumber',
  'cvv',
  'email',
  'phone',
  'address',
  'latitude',
  'longitude',
  'prompt',
  'completion',
])
/** Exact segments after camelCase / snake_case / kebab-case split. */
const SENSITIVE_SEGMENTS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'session',
  'sessionid',
  'privatekey',
  'clientsecret',
  'jwt',
  'bearer',
  'credential',
  'credentials',
  // Plurals name the same secrets, often a whole list of them (narduk-libs#872).
  'tokens',
  'passwords',
  'passwds',
  'secrets',
  'apikeys',
  'jwts',
  'privatekeys',
  'clientsecrets',
])
/** Adjacent segments that together name a secret (`x-api-key` → api+key). */
const COMPOUND_SEGMENTS = new Set([
  'apikey',
  'accesskey',
  'privatekey',
  'clientsecret',
  'setcookie',
])
/** Keep infix on the punctuation-stripped key only for these compounds. */
const SENSITIVE_INFIX = ['apikey', 'accesskey', 'privatekey', 'authorization'] as const
/**
 * Suffix match on the punctuation-stripped key. Segment splitting cannot see a
 * boundary in an all-lowercase concatenation such as `refreshtoken` or
 * `dbpassword`, so without this the narrowing would stop redacting names the
 * suffix matcher already covered. `tokenizer` / `secretary` / `jwtid` do not
 * end in these words, and `tokencount` / `passwordless` are carved out below.
 * The plural forms catch `refreshtokens` / `dbpasswords` (narduk-libs#872).
 */
const SENSITIVE_SUFFIXES = [
  'token',
  'password',
  'secret',
  'tokens',
  'passwords',
  'secrets',
] as const
/**
 * Metric / method flags that contain `token`, `password`, or `auth` but are not secrets.
 * The `*tokens` entries are the LLM usage counts providers report; they are numbers,
 * and redacting them would blind AI cost and latency logs once plurals redact (#872).
 */
const SAFE_NORMALIZED_KEYS = new Set([
  'tokencount',
  'passwordless',
  'authmethod',
  'authbackend',
  'authprovider',
  'inputtokens',
  'outputtokens',
  'prompttokens',
  'completiontokens',
  'totaltokens',
  'maxtokens',
  'reasoningtokens',
  'cachereadinputtokens',
  'cachecreationinputtokens',
])

/** Mark a value as private. It is redacted before any sink sees the record. */
export function privateValue(value: unknown): object {
  return Object.freeze({ [PRIVATE]: true, value })
}

export function cleanText(value: string, length = MAX_STRING): string {
  // eslint-disable-next-line no-control-regex -- Strip terminal and line controls before every sink.
  return value.slice(0, length).replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

/** Split `authToken`, `access_token`, and `x-api-key` on the original key. */
function keySegments(key: string): string[] {
  const pieces = key.split(/[^A-Za-z0-9]+/u).filter(Boolean)
  const segments: string[] = []
  for (const piece of pieces) {
    const parts = piece.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/u)
    for (const part of parts) {
      if (part) segments.push(part.toLowerCase())
    }
  }
  return segments
}

export function isSensitiveKey(key: string, extra: readonly string[] = []): boolean {
  const normalized = normalizeKey(key)
  if (SENSITIVE.has(normalized) || extra.some((item) => normalizeKey(item) === normalized)) {
    return true
  }
  if (!normalized || SAFE_NORMALIZED_KEYS.has(normalized)) return false
  const segments = keySegments(key)
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) return true
  for (let index = 0; index < segments.length - 1; index++) {
    if (COMPOUND_SEGMENTS.has(`${segments[index]}${segments[index + 1]}`)) return true
  }
  if (segments.includes('auth')) return true
  if (SENSITIVE_SUFFIXES.some((part) => normalized.endsWith(part))) return true
  return SENSITIVE_INFIX.some((part) => normalized.includes(part))
}

/** Malformed URLs never fall back to the original query/credential-bearing string. */
export function sanitizeUrlForLog(value: string): string {
  if (!value) return '[empty]'
  try {
    const url =
      value.startsWith('/') && !value.startsWith('//')
        ? new URL(value, 'https://relative.invalid')
        : new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return '[unsupported URL]'
    const path = cleanText(url.pathname, 512)
    return value.startsWith('/') ? path : `${url.protocol}//${url.host}${path}`.slice(0, 512)
  } catch {
    return '[invalid URL]'
  }
}

export interface SanitizerOptions {
  redact?: readonly string[]
  includeStack?: boolean
}

/** Reading data descriptors avoids executing application getters and toJSON hooks. */
function ownValues(value: object): Record<string, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value)
  } catch {
    return {}
  }
}

function errorField(value: object, key: string): unknown {
  // Error.name is usually inherited. Walk only data descriptors, never accessors.
  let current: object | null = value
  for (let i = 0; current && i < 4; i++) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (descriptor) {
        if ('value' in descriptor) return descriptor.value
        // V8 exposes lazily formatted native Error stacks as accessors. Do not invoke user getters.
        if (
          key === 'stack' &&
          descriptor.get &&
          Function.prototype.toString.call(descriptor.get).includes('[native code]')
        ) {
          return descriptor.get.call(value)
        }
        return undefined
      }
      current = Object.getPrototypeOf(current) as object | null
    } catch {
      return undefined
    }
  }
  return undefined
}

function describeError(
  value: unknown,
  options: SanitizerOptions,
  seen: WeakSet<object>,
  depth: number,
): LogError {
  if (typeof value !== 'object' || value === null) {
    return {
      name: 'Error',
      message: typeof value === 'string' ? cleanText(value) : 'Non-error thrown',
    }
  }
  if (seen.has(value) || depth >= MAX_DEPTH)
    return { name: 'Error', message: '[Circular or truncated cause]' }
  seen.add(value)
  const name = errorField(value, 'name')
  const message = errorField(value, 'message')
  const code = errorField(value, 'code')
  const stack = errorField(value, 'stack')
  const cause = errorField(value, 'cause')
  const result: LogError = {
    name: typeof name === 'string' ? cleanText(name, 128) : 'Error',
    message: typeof message === 'string' ? cleanText(message) : 'Non-error thrown',
  }
  if (typeof code === 'string' || typeof code === 'number')
    result.code = cleanText(String(code), 128)
  if (options.includeStack && typeof stack === 'string') result.stack = cleanText(stack, 4096)
  if (cause !== undefined) result.cause = describeError(cause, options, seen, depth + 1)
  return result
}

export function sanitizeErrorForLog(value: unknown, options: SanitizerOptions = {}): LogError {
  try {
    return describeError(value, options, new WeakSet(), 0)
  } catch {
    return { name: 'Error', message: '[Unserializable error]' }
  }
}

interface WalkState {
  seen: WeakSet<object>
  nodes: number
  options: SanitizerOptions
}

function walk(value: unknown, state: WalkState, depth: number, key = ''): JsonValue {
  if (isSensitiveKey(key, state.options.redact)) return REDACTED
  if (++state.nodes > MAX_NODES || depth > MAX_DEPTH) return '[Truncated]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'string') {
    return /(?:url|uri)$/i.test(key) ? sanitizeUrlForLog(value) : cleanText(value)
  }
  if (typeof value !== 'object') return `[${typeof value}]`
  if (state.seen.has(value)) return '[Circular]'
  const descriptors = ownValues(value)
  if (Object.getOwnPropertyDescriptor(value, PRIVATE)?.value === true) return REDACTED
  if (value instanceof Error) return sanitizeErrorForLog(value, state.options)
  if (value instanceof Date) {
    try {
      return Date.prototype.toISOString.call(value)
    } catch {
      return '[Invalid Date]'
    }
  }
  state.seen.add(value)
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    const length = Math.min(value.length, MAX_FIELDS)
    for (let i = 0; i < length; i++) {
      const descriptor = descriptors[String(i)]
      result.push(
        descriptor && 'value' in descriptor
          ? walk(descriptor.value, state, depth + 1, key)
          : '[Accessor]',
      )
    }
    if (value.length > MAX_FIELDS) result.push('[Truncated]')
    return result
  }
  const result: SafeFields = {}
  for (const [field, descriptor] of Object.entries(descriptors).slice(0, MAX_FIELDS)) {
    if (!descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(field))
      continue
    const safeKey = cleanText(field, 128)
    result[safeKey] =
      'value' in descriptor ? walk(descriptor.value, state, depth + 1, field) : '[Accessor]'
  }
  return result
}

export function sanitizeFields(value: unknown, options: SanitizerOptions = {}): SafeFields {
  try {
    const result = walk(value, { seen: new WeakSet(), nodes: 0, options }, 0)
    return result && typeof result === 'object' && !Array.isArray(result)
      ? result
      : { value: result }
  } catch {
    return { serializationError: '[Unserializable data]' }
  }
}

export function recordBytes(record: Readonly<LogRecord>): number {
  return encoder.encode(JSON.stringify(record)).byteLength
}

export function boundRecord(record: LogRecord): LogRecord {
  if (recordBytes(record) <= MAX_RECORD_BYTES) return record
  const bounded: LogRecord = { ...record, data: { truncated: true } }
  if (record.error) bounded.error = { name: record.error.name, message: record.error.message }
  return bounded
}

export function freezeRecord(record: LogRecord): Readonly<LogRecord> {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  freeze(record)
  return record
}
