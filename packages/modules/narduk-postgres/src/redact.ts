/**
 * A PostgreSQL DSN carries its password in the URL. Hyperdrive hands the Worker
 * one, `pg_dump` scripts hand Node another, and either one lands in an error
 * message the moment a connection fails -- which is how a secret reaches a log
 * line, a Sentry event or an agent transcript without anyone deciding to put it
 * there. Nothing in this package puts a raw DSN into a message: it goes through
 * here first.
 *
 * The function is deliberately total. An unparseable value returns the constant
 * `REDACTED`, never the original, because "I could not parse it" is not a reason
 * to print it.
 */

export const REDACTED = '***'

const SENSITIVE_QUERY_KEYS = new Set(['password', 'passfile', 'sslpassword', 'token'])

export function redactConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return REDACTED

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return REDACTED
  }

  if (url.password) url.password = REDACTED
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, REDACTED)
  }
  return url.toString()
}

/**
 * Redact every credential-shaped substring in free text.
 *
 * A driver's error message is not a DSN, it *contains* one -- "connection to
 * postgres://ingest:hunter2@10.70.0.4:5432/mybo_history failed" -- so parsing
 * the whole string as a URL finds nothing and passes the password straight
 * through. This works on the substring instead, and covers the two other shapes
 * that carry one: a `password=` keyword pair and a PGPASSWORD-style assignment.
 */
export function redactSecrets(text: unknown): string {
  if (typeof text !== 'string') return REDACTED
  return text
    .replaceAll(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@]*)@/giu, `$1$2:${REDACTED}@`)
    .replaceAll(
      /\b(password|pgpassword|sslpassword|token)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/giu,
      `$1=${REDACTED}`,
    )
}

const MAX_CAUSE_DEPTH = 8

const unredactedCauses = new WeakMap<object, unknown>()

const SKIP_ERROR_KEYS = new Set(['cause', 'code', 'errors', 'message', 'name', 'stack'])

/**
 * Key names whose value is replaced wholesale rather than passed through
 * `redactSecrets`. A driver holds the password as a bare value (`pg` attaches
 * `parameters.password`), and a bare value carries none of the `scheme://u:p@`
 * or `password=` shape `redactSecrets` matches. Biased to over-redact: an
 * unnecessarily masked error extra costs a debugging hint, an unmasked one
 * costs the credential.
 */
const SECRET_KEY_PATTERN = /pass|pwd|secret|token|credential|auth|key/iu

/**
 * The driver object `redactErrorCause` copied. Not attached to the redacted
 * error (JSON.stringify / inspect would leak it). Server-side logging may
 * read it here; do not serialize the result.
 */
export function getUnredactedCause(error: object): unknown {
  return unredactedCauses.get(error)
}

export function rememberUnredactedCause(copy: object, original: unknown): void {
  unredactedCauses.set(copy, original)
}

/**
 * Replace a driver `cause` with a copy whose messages, nested `cause` /
 * `AggregateError.errors`, and enumerable own properties have been through
 * `redactSecrets`. The original object is left untouched and is recoverable
 * via `getUnredactedCause` for server-side logging: mutating a postgres.js /
 * `pg` error in place would still leave the password in any other holder of
 * the same reference, and attaching the original as `.cause` would put the
 * DSN back on the serialized surface.
 *
 * `name` and a primitive `code` are preserved so callers can still branch
 * the way they do on the raw driver error. Enumerable extras (`address`,
 * `hostname`, `parameters.connectionString`) are copied after redaction, and a
 * secret-named key (`SECRET_KEY_PATTERN`) is replaced outright, so
 * `JSON.stringify` of the attached copy cannot carry a DSN or a bare password.
 */
export function redactErrorCause(
  cause: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (cause == null) return cause
  if (typeof cause === 'string') return redactSecrets(cause)
  if (typeof cause !== 'object') return cause
  if (depth >= MAX_CAUSE_DEPTH || seen.has(cause)) return undefined
  seen.add(cause)

  if (Array.isArray(cause)) {
    return cause.map((item) => redactErrorCause(item, depth + 1, seen))
  }

  if (cause instanceof Error) {
    const redacted = cloneRedactedError(cause, depth, seen)
    rememberUnredactedCause(redacted, cause)
    return redacted
  }

  return cloneRedactedObject(cause, depth, seen)
}

function cloneRedactedError(cause: Error, depth: number, seen: WeakSet<object>): Error {
  const nested =
    cause.cause === undefined ? undefined : redactErrorCause(cause.cause, depth + 1, seen)
  const message = redactSecrets(cause.message)
  const options = nested === undefined ? undefined : { cause: nested }

  const redacted =
    cause instanceof AggregateError
      ? new AggregateError(
          cause.errors.map((item) => redactErrorCause(item, depth + 1, seen)),
          message,
          options,
        )
      : options === undefined
        ? new Error(message)
        : new Error(message, options)

  redacted.name = cause.name
  if ('code' in cause) {
    const code = (cause as { code: unknown }).code
    if (typeof code === 'string' || typeof code === 'number') {
      Object.defineProperty(redacted, 'code', {
        configurable: true,
        enumerable: true,
        value: code,
        writable: true,
      })
    }
  }
  copyEnumerableOwn(cause, redacted, depth, seen, SKIP_ERROR_KEYS)
  return redacted
}

function cloneRedactedObject(
  cause: object,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  copyEnumerableOwn(cause, copy, depth, seen, new Set())
  return copy
}

function copyEnumerableOwn(
  source: object,
  target: object,
  depth: number,
  seen: WeakSet<object>,
  skip: ReadonlySet<string>,
): void {
  for (const key of Object.keys(source)) {
    if (skip.has(key)) continue
    const value = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactErrorCause((source as Record<string, unknown>)[key], depth + 1, seen)
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
}
