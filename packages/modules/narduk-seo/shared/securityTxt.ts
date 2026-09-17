const PACKAGE_NAME = '@narduk-enterprises/narduk-seo'

export const SECURITY_TXT_CONTENT_TYPE = 'text/plain; charset=utf-8'
export const SECURITY_TXT_DEFAULT_EXPIRES_DAYS = 365
export const SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS = 30
export const SECURITY_TXT_LEGACY_PATH = '/security.txt'
export const SECURITY_TXT_MAX_EXPIRES_DAYS = 365
export const SECURITY_TXT_WELL_KNOWN_PATH = '/.well-known/security.txt'

export interface NardukSecurityTxtOptions {
  acknowledgments?: string | readonly string[]
  canonical?: string
  contact: string | readonly string[]
  expiresDays?: number
  policy?: string | readonly string[]
  preferredLanguages?: string | readonly string[]
}

export type SecurityTxtHttpResult =
  | {
      body: string
      contentType: typeof SECURITY_TXT_CONTENT_TYPE
      ok: true
      statusCode: 200
    }
  | {
      ok: false
      statusCode: 404
    }

function configError(message: string): Error {
  return new Error(`[${PACKAGE_NAME}] ${message}`)
}

function enabledWithoutContact(): Error {
  return configError(
    'nardukSeo.securityTxt is enabled but contact is missing. ' +
      'Set contact to a mailto: or https: URI, or omit securityTxt to disable.',
  )
}

// RFC 9116 fields are one per line; an embedded CR or LF would let a config
// value inject an extra field into the served body. Every field funnels
// through this one guard rather than five separate checks.
function assertNoLineBreaks(value: string, field: string): void {
  if (/[\r\n]/u.test(value)) {
    throw configError(`nardukSeo.securityTxt.${field} must not contain line breaks.`)
  }
}

function asStringList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  if (items.some((item) => typeof item !== 'string')) {
    throw configError(`nardukSeo.securityTxt.${field} must be a string or an array of strings.`)
  }

  const trimmed = items.map((item) => item.trim()).filter((item) => item.length > 0)
  for (const item of trimmed) assertNoLineBreaks(item, field)

  return trimmed
}

function normalizeContact(value: unknown): string[] {
  const contacts = asStringList(value, 'contact')
  return contacts.map((contact) => {
    if (/^(?:mailto|https|tel):/iu.test(contact)) return contact
    if (contact.includes('@') && !contact.includes('://')) return `mailto:${contact}`
    throw configError(
      `nardukSeo.securityTxt.contact value "${contact}" must be a mailto:, https:, or tel: URI.`,
    )
  })
}

function normalizeExpiresDays(value: unknown): number {
  if (value === undefined) return SECURITY_TXT_DEFAULT_EXPIRES_DAYS
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > SECURITY_TXT_MAX_EXPIRES_DAYS
  ) {
    throw configError(
      `nardukSeo.securityTxt.expiresDays must be an integer from 1 to ${SECURITY_TXT_MAX_EXPIRES_DAYS}.`,
    )
  }

  return value
}

function normalizeHttpsUri(value: string, field: string): string {
  if (!/^https:\/\//iu.test(value)) {
    throw configError(`nardukSeo.securityTxt.${field} must be an https:// URI.`)
  }

  return value
}

function normalizeLanguages(value: unknown): string | null {
  const tags = asStringList(value, 'preferredLanguages')
  return tags.length > 0 ? tags.join(', ') : null
}

/**
 * RFC 9116 security.txt body from module options.
 *
 * Returns `null` when the option is omitted or `false` — this package never
 * invents a contact address. A present object (or `true`) without a usable
 * contact is a build-time error.
 */
export function resolveSecurityTxtBody(option: unknown, now: Date = new Date()): string | null {
  if (option === undefined || option === null || option === false) return null
  if (option === true) throw enabledWithoutContact()
  if (typeof option !== 'object' || Array.isArray(option)) {
    throw configError(
      'nardukSeo.securityTxt must be an object with a contact field, or omitted to disable.',
    )
  }

  const input = option as Record<string, unknown>
  const contacts = normalizeContact(input.contact)
  if (contacts.length === 0) throw enabledWithoutContact()

  const expiresDays = normalizeExpiresDays(input.expiresDays)
  const expires = new Date(now.getTime() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
  const lines = contacts.map((contact) => `Contact: ${contact}`)
  lines.push(`Expires: ${expires}`)

  const canonical = asStringList(input.canonical, 'canonical')
  if (canonical.length > 1) {
    throw configError('nardukSeo.securityTxt.canonical must be a single https:// URI.')
  }
  if (canonical[0]) lines.push(`Canonical: ${normalizeHttpsUri(canonical[0], 'canonical')}`)

  for (const policy of asStringList(input.policy, 'policy')) {
    lines.push(`Policy: ${normalizeHttpsUri(policy, 'policy')}`)
  }
  for (const acknowledgments of asStringList(input.acknowledgments, 'acknowledgments')) {
    lines.push(`Acknowledgments: ${normalizeHttpsUri(acknowledgments, 'acknowledgments')}`)
  }

  const languages = normalizeLanguages(input.preferredLanguages)
  if (languages) lines.push(`Preferred-Languages: ${languages}`)

  return `${lines.join('\n')}\n`
}

// A fixed single space after the colon matches exactly what this module
// generates above; no `\s*`/`.+` overlap, so no super-linear backtracking.
const EXPIRES_LINE = /^Expires: (.+)$/mu

/**
 * Parses the `Expires` value baked into a security.txt body by
 * {@link resolveSecurityTxtBody}. Returns `null` when the body has no
 * parseable `Expires` line (defensive — {@link resolveSecurityTxtBody}
 * always emits one).
 */
export function resolveSecurityTxtExpiresAt(body: string): Date | null {
  const match = EXPIRES_LINE.exec(body)
  if (!match) return null

  const expiresAt = new Date((match[1] ?? '').trim())
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt
}

/**
 * True once `expiresAt` is at or within
 * {@link SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS} of `now` — the served
 * route uses this to warn that the app has not rebuilt (and so not
 * refreshed `Expires`) recently enough.
 */
export function isSecurityTxtNearOrPastExpiry(expiresAt: Date, now: Date = new Date()): boolean {
  const warningWindowMs = SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return expiresAt.getTime() - now.getTime() <= warningWindowMs
}

export function resolveSecurityTxtHttpResult(body: unknown): SecurityTxtHttpResult {
  if (typeof body !== 'string' || body.length === 0) {
    return { ok: false, statusCode: 404 }
  }

  return {
    ok: true,
    statusCode: 200,
    contentType: SECURITY_TXT_CONTENT_TYPE,
    body,
  }
}
