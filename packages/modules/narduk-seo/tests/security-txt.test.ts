import { describe, expect, it } from 'vitest'

import {
  isSecurityTxtNearOrPastExpiry,
  resolveSecurityTxtBody,
  resolveSecurityTxtExpiresAt,
  resolveSecurityTxtHttpResult,
  SECURITY_TXT_CONTENT_TYPE,
  SECURITY_TXT_DEFAULT_EXPIRES_DAYS,
  SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS,
  SECURITY_TXT_MAX_EXPIRES_DAYS,
} from '../shared/securityTxt'

const NOW = new Date('2026-09-17T12:00:00.000Z')
const CONTACT = 'mailto:security@example.com'

describe('resolveSecurityTxtBody', () => {
  it('stays disabled when the app sets no contact', () => {
    expect(resolveSecurityTxtBody(undefined, NOW)).toBeNull()
    expect(resolveSecurityTxtBody(false, NOW)).toBeNull()
    expect(resolveSecurityTxtBody(null, NOW)).toBeNull()
  })

  it('errors when security.txt is enabled without a contact', () => {
    const message =
      /nardukSeo\.securityTxt is enabled but contact is missing[\s\S]*omit securityTxt to disable/u

    expect(() => resolveSecurityTxtBody(true, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({}, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ contact: '' }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ contact: [] }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ contact: '   ' }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ policy: 'https://example.com/security' }, NOW)).toThrow(
      message,
    )
  })

  it('builds an RFC 9116 body with required Contact and Expires fields', () => {
    const body = resolveSecurityTxtBody({ contact: CONTACT }, NOW)

    expect(body).toBe([`Contact: ${CONTACT}`, 'Expires: 2027-09-17T12:00:00.000Z', ''].join('\n'))
  })

  it('accepts a bare email by prefixing mailto: and supports multiple contacts', () => {
    const body = resolveSecurityTxtBody(
      {
        contact: ['security@example.com', 'https://example.com/security'],
        expiresDays: 30,
      },
      NOW,
    )

    expect(body).toContain(`Contact: ${CONTACT}`)
    expect(body).toContain('Contact: https://example.com/security')
    expect(body).toContain('Expires: 2026-10-17T12:00:00.000Z')
  })

  it('emits optional policy, acknowledgments, preferredLanguages, and canonical', () => {
    const body = resolveSecurityTxtBody(
      {
        contact: CONTACT,
        expiresDays: 1,
        canonical: 'https://example.com/.well-known/security.txt',
        policy: 'https://example.com/security-policy',
        acknowledgments: 'https://example.com/hall-of-fame',
        preferredLanguages: ['en', 'es'],
      },
      NOW,
    )

    expect(body).toBe(
      [
        `Contact: ${CONTACT}`,
        'Expires: 2026-09-18T12:00:00.000Z',
        'Canonical: https://example.com/.well-known/security.txt',
        'Policy: https://example.com/security-policy',
        'Acknowledgments: https://example.com/hall-of-fame',
        'Preferred-Languages: en, es',
        '',
      ].join('\n'),
    )
  })

  it('rejects expiresDays outside 1..365', () => {
    const contact = { contact: CONTACT }
    const message = new RegExp(
      `expiresDays must be an integer from 1 to ${SECURITY_TXT_MAX_EXPIRES_DAYS}`,
      'u',
    )

    expect(SECURITY_TXT_DEFAULT_EXPIRES_DAYS).toBe(365)
    expect(SECURITY_TXT_MAX_EXPIRES_DAYS).toBe(365)
    expect(() => resolveSecurityTxtBody({ ...contact, expiresDays: 0 }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ ...contact, expiresDays: 366 }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ ...contact, expiresDays: -1 }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ ...contact, expiresDays: 1.5 }, NOW)).toThrow(message)
    expect(() => resolveSecurityTxtBody({ ...contact, expiresDays: '30' }, NOW)).toThrow(message)
  })

  it('rejects a non-object securityTxt value', () => {
    expect(() => resolveSecurityTxtBody(CONTACT, NOW)).toThrow(
      /must be an object with a contact field/u,
    )
    expect(() => resolveSecurityTxtBody([CONTACT], NOW)).toThrow(
      /must be an object with a contact field/u,
    )
  })

  it('rejects non-string field values', () => {
    expect(() => resolveSecurityTxtBody({ contact: 1 }, NOW)).toThrow(
      /securityTxt\.contact must be a string or an array of strings/u,
    )
  })

  it('accepts tel: contacts and a preferredLanguages string', () => {
    const body = resolveSecurityTxtBody(
      {
        contact: 'tel:+1-201-555-0123',
        preferredLanguages: 'en',
        acknowledgments: ['https://example.com/thanks'],
      },
      NOW,
    )

    expect(body).toContain('Contact: tel:+1-201-555-0123')
    expect(body).toContain('Preferred-Languages: en')
    expect(body).toContain('Acknowledgments: https://example.com/thanks')
  })

  it('rejects non-URI contacts and non-https optional URIs', () => {
    expect(() => resolveSecurityTxtBody({ contact: 'not-a-uri' }, NOW)).toThrow(
      /must be a mailto:, https:, or tel: URI/u,
    )
    expect(() =>
      resolveSecurityTxtBody({ contact: CONTACT, policy: 'http://example.com/policy' }, NOW),
    ).toThrow(/securityTxt\.policy must be an https:\/\/ URI/u)
    expect(() =>
      resolveSecurityTxtBody(
        {
          contact: CONTACT,
          canonical: [
            'https://a.example/.well-known/security.txt',
            'https://b.example/.well-known/security.txt',
          ],
        },
        NOW,
      ),
    ).toThrow(/canonical must be a single https:\/\/ URI/u)
  })

  it('rejects a line break embedded in any field value', () => {
    const lineBreakMessage = (field: string) =>
      new RegExp(`securityTxt\\.${field} must not contain line breaks`, 'u')

    expect(() =>
      resolveSecurityTxtBody({ contact: `${CONTACT}\nExpires: 2000-01-01T00:00:00.000Z` }, NOW),
    ).toThrow(lineBreakMessage('contact'))
    expect(() =>
      resolveSecurityTxtBody({ contact: `mailto:a@b.com\rExtra: injected` }, NOW),
    ).toThrow(lineBreakMessage('contact'))
    expect(() =>
      resolveSecurityTxtBody(
        { contact: CONTACT, canonical: 'https://example.com/security.txt\nX: 1' },
        NOW,
      ),
    ).toThrow(lineBreakMessage('canonical'))
    expect(() =>
      resolveSecurityTxtBody({ contact: CONTACT, policy: 'https://example.com/policy\nX: 1' }, NOW),
    ).toThrow(lineBreakMessage('policy'))
    expect(() =>
      resolveSecurityTxtBody(
        { contact: CONTACT, acknowledgments: 'https://example.com/thanks\nX: 1' },
        NOW,
      ),
    ).toThrow(lineBreakMessage('acknowledgments'))
    expect(() =>
      resolveSecurityTxtBody({ contact: CONTACT, preferredLanguages: 'en\nX: 1' }, NOW),
    ).toThrow(lineBreakMessage('preferredLanguages'))
  })
})

describe('resolveSecurityTxtExpiresAt', () => {
  it('parses the Expires value baked into a resolved body', () => {
    const body = resolveSecurityTxtBody({ contact: CONTACT }, NOW)

    expect(resolveSecurityTxtExpiresAt(body!)).toEqual(new Date('2027-09-17T12:00:00.000Z'))
  })

  it('returns null when the body has no parseable Expires line', () => {
    expect(resolveSecurityTxtExpiresAt('Contact: mailto:a@b.com\n')).toBeNull()
    expect(resolveSecurityTxtExpiresAt('Expires: not-a-date\n')).toBeNull()
  })
})

describe('isSecurityTxtNearOrPastExpiry', () => {
  it('is false while comfortably before the warning window', () => {
    const expiresAt = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000)

    expect(isSecurityTxtNearOrPastExpiry(expiresAt, NOW)).toBe(false)
  })

  it('is true at exactly the warning window and once expiry has passed', () => {
    const atWindowEdge = new Date(
      NOW.getTime() + SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
    const pastExpiry = new Date(NOW.getTime() - 1)

    expect(isSecurityTxtNearOrPastExpiry(atWindowEdge, NOW)).toBe(true)
    expect(isSecurityTxtNearOrPastExpiry(pastExpiry, NOW)).toBe(true)
  })
})

describe('resolveSecurityTxtHttpResult', () => {
  it('serves the body as text/plain; charset=utf-8', () => {
    const body = resolveSecurityTxtBody({ contact: CONTACT }, NOW)

    expect(resolveSecurityTxtHttpResult(body)).toEqual({
      ok: true,
      statusCode: 200,
      contentType: 'text/plain; charset=utf-8',
      body,
    })
    expect(SECURITY_TXT_CONTENT_TYPE).toBe('text/plain; charset=utf-8')
  })

  it('returns 404 when security.txt is disabled', () => {
    expect(resolveSecurityTxtHttpResult(null)).toEqual({ ok: false, statusCode: 404 })
    expect(resolveSecurityTxtHttpResult('')).toEqual({ ok: false, statusCode: 404 })
    expect(resolveSecurityTxtHttpResult(undefined)).toEqual({ ok: false, statusCode: 404 })
  })
})
