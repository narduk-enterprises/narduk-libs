export type LocalEmailLinkPurpose = 'reset' | 'setup'

const EMAIL_TOKEN_BYTES = 32
const LOCKOUT_THRESHOLD = 5
const MAX_LOCK_SECONDS = 15 * 60

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase()
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let encoded = ''

  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    encoded += alphabet[(block >>> 18) & 63]
    encoded += alphabet[(block >>> 12) & 63]
    if (second !== undefined) encoded += alphabet[(block >>> 6) & 63]
    if (third !== undefined) encoded += alphabet[block & 63]
  }

  return encoded
}

export function generateLocalEmailToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(EMAIL_TOKEN_BYTES)))
}

export async function hashLocalEmailValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isEmailPreauthorized(email: string, allowlist: readonly string[]): boolean {
  const normalizedEmail = normalizeEmailAddress(email)
  return allowlist.some((entry) => normalizeEmailAddress(entry) === normalizedEmail)
}

export function selectLocalEmailLinkPurpose(params: {
  allowlist: readonly string[]
  email: string
  userExists: boolean
}): LocalEmailLinkPurpose | null {
  if (params.userExists) return 'reset'
  return isEmailPreauthorized(params.email, params.allowlist) ? 'setup' : null
}

export function sanitizeLocalEmailRedirect(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (decoded.includes('\\')) return fallback
    const url = new URL(value, 'https://app.local')
    if (url.origin !== 'https://app.local' || !url.pathname.startsWith('/')) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function buildLocalEmailActionUrl(params: {
  appUrl: string
  next: string
  resetPath: string
  token: string
}): string {
  const url = new URL(params.resetPath, params.appUrl)
  url.searchParams.set('recovery', '1')
  url.searchParams.set('token', params.token)
  url.searchParams.set('next', params.next)
  return url.toString()
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildLocalEmailMessage(params: {
  actionUrl: string
  appName: string
  purpose: LocalEmailLinkPurpose
  ttlMinutes: number
}) {
  const appName = params.appName.trim() || 'Narduk app'
  const action = params.purpose === 'setup' ? 'set up your password' : 'reset your password'
  const escapedAppName = escapeEmailHtml(appName)
  const escapedActionUrl = escapeEmailHtml(params.actionUrl)

  return {
    subject: `${appName}: ${params.purpose === 'setup' ? 'set up' : 'reset'} your password`,
    text: `Use this link to ${action} for ${appName}:\n\n${params.actionUrl}\n\nThis single-use link expires in ${params.ttlMinutes} minutes. If you did not request it, you can ignore this email.`,
    html: `<p>Use the button below to ${escapeEmailHtml(action)} for ${escapedAppName}.</p><p><a href="${escapedActionUrl}">${params.purpose === 'setup' ? 'Set up password' : 'Reset password'}</a></p><p>This single-use link expires in ${params.ttlMinutes} minutes. If you did not request it, you can ignore this email.</p>`,
  }
}

export function localEmailLockSeconds(failures: number): number {
  if (failures < LOCKOUT_THRESHOLD) return 0
  return Math.min(30 * 2 ** (failures - LOCKOUT_THRESHOLD), MAX_LOCK_SECONDS)
}
