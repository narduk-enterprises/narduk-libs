import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildLocalEmailActionUrl,
  buildLocalEmailMessage,
  escapeEmailHtml,
  generateLocalEmailToken,
  hashLocalEmailValue,
  isEmailPreauthorized,
  localEmailLockSeconds,
  normalizeEmailAddress,
  sanitizeLocalEmailRedirect,
  selectLocalEmailLinkPurpose,
} from '../server/lib/app-auth/local-email-core'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('local email authentication primitives', () => {
  it('creates unique 256-bit base64url tokens and stores deterministic SHA-256 digests', async () => {
    const tokens = Array.from({ length: 64 }, () => generateLocalEmailToken())

    expect(new Set(tokens)).toHaveLength(tokens.length)
    for (const token of tokens) {
      expect(token).toMatch(/^[\w-]{43}$/u)
    }
    await expect(hashLocalEmailValue('hello')).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('normalizes and exact-matches preauthorized email addresses', () => {
    expect(normalizeEmailAddress('  Parent@Example.COM ')).toBe('parent@example.com')
    expect(isEmailPreauthorized('parent@example.com', [' Parent@Example.com '])).toBe(true)
    expect(isEmailPreauthorized('other@example.com', ['parent@example.com'])).toBe(false)
  })

  it('selects reset for existing users and setup only for exact preauthorization', () => {
    expect(
      selectLocalEmailLinkPurpose({
        allowlist: [],
        email: 'known@example.com',
        userExists: true,
      }),
    ).toBe('reset')
    expect(
      selectLocalEmailLinkPurpose({
        allowlist: ['new@example.com'],
        email: 'new@example.com',
        userExists: false,
      }),
    ).toBe('setup')
    expect(
      selectLocalEmailLinkPurpose({
        allowlist: ['new@example.com'],
        email: 'unknown@example.com',
        userExists: false,
      }),
    ).toBeNull()
  })

  it('preserves local redirects while rejecting external and backslash paths', () => {
    const fallback = '/dashboard/'
    expect(sanitizeLocalEmailRedirect('/invite?token=opaque#accept', fallback)).toBe(
      '/invite?token=opaque#accept',
    )
    expect(sanitizeLocalEmailRedirect('https://example.com', fallback)).toBe(fallback)
    expect(sanitizeLocalEmailRedirect('//example.com/path', fallback)).toBe(fallback)
    expect(sanitizeLocalEmailRedirect('/%5cexample.com', fallback)).toBe(fallback)
  })

  it('builds a same-app action URL without consuming the token on page load', () => {
    const actionUrl = new URL(
      buildLocalEmailActionUrl({
        appUrl: 'https://kids.nard.uk',
        next: '/invite?farm=one',
        resetPath: '/reset-password',
        token: 'opaque-token',
      }),
    )

    expect(actionUrl.origin).toBe('https://kids.nard.uk')
    expect(actionUrl.pathname).toBe('/reset-password')
    expect(actionUrl.searchParams.get('recovery')).toBe('1')
    expect(actionUrl.searchParams.get('token')).toBe('opaque-token')
    expect(actionUrl.searchParams.get('next')).toBe('/invite?farm=one')
  })

  it('escapes app and link content in email HTML', () => {
    expect(escapeEmailHtml(`<Kids & "Family">`)).toBe('&lt;Kids &amp; &quot;Family&quot;&gt;')
    const message = buildLocalEmailMessage({
      actionUrl: 'https://app.example/reset?token=a&next=<bad>',
      appName: '<Kids & Family>',
      purpose: 'setup',
      ttlMinutes: 15,
    })
    expect(message.html).toContain('&lt;Kids &amp; Family&gt;')
    expect(message.html).toContain('token=a&amp;next=&lt;bad&gt;')
    expect(message.text).toContain('single-use link expires in 15 minutes')
  })

  it('applies bounded exponential lockout after five failures', () => {
    expect(localEmailLockSeconds(4)).toBe(0)
    expect(localEmailLockSeconds(5)).toBe(30)
    expect(localEmailLockSeconds(6)).toBe(60)
    expect(localEmailLockSeconds(20)).toBe(15 * 60)
  })

  it('ships digest-only persistence and explicit additive provenance', () => {
    const migration = readFileSync(join(packageRoot, 'drizzle/0002_local_email_auth.sql'), 'utf8')
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')

    expect(migration).toContain('token_hash TEXT NOT NULL UNIQUE')
    expect(migration).not.toMatch(/\braw_token\b/u)
    expect(readme).toContain('PACC TRAC informed')
    expect(readme).toContain('Harvest Tracker informed')
    expect(readme).toContain('does not create, remove, weaken, bypass, or reconfigure')
    expect(readme).toContain('Cloudflare Access')
  })
})
