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
