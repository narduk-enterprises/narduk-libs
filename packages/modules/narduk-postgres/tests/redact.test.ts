import { describe, expect, it } from 'vitest'

import { REDACTED, redactConnectionString, redactSecrets } from '../src/redact.js'

describe('redactConnectionString', () => {
  it('removes the password from a DSN and keeps the rest readable', () => {
    expect(redactConnectionString('postgres://ingest:hunter2@10.70.0.4:5432/mybo_history')).toBe(
      'postgres://ingest:***@10.70.0.4:5432/mybo_history',
    )
  })

  it('removes credential-bearing query parameters', () => {
    const redacted = redactConnectionString(
      'postgres://ingest@db.internal:5432/mybo_history?sslmode=require&password=hunter2',
    )
    expect(redacted).toContain('sslmode=require')
    expect(redacted).not.toContain('hunter2')
  })

  it('returns the constant rather than the input when it cannot parse', () => {
    for (const value of ['not a url', '', undefined, null, 42]) {
      expect(redactConnectionString(value)).toBe(REDACTED)
    }
  })
})

describe('redactSecrets', () => {
  // The failure this exists for: a driver error message CONTAINS a DSN, so
  // parsing the whole string as a URL finds nothing and prints the password.
  it('redacts a DSN embedded in free text', () => {
    const message =
      'connection to postgres://ingest:hunter2@10.70.0.4:5432/mybo_history failed: timeout'
    const redacted = redactSecrets(message)
    expect(redacted).not.toContain('hunter2')
    expect(redacted).toContain('postgres://ingest:***@10.70.0.4:5432/mybo_history')
    expect(redacted).toContain('timeout')
  })

  it('redacts keyword password pairs in any case', () => {
    expect(redactSecrets('host=db user=ops PASSWORD=hunter2 sslmode=require')).not.toContain(
      'hunter2',
    )
    expect(redactSecrets('token: "abc123"')).not.toContain('abc123')
  })

  it('returns the constant for a non-string', () => {
    expect(redactSecrets({ password: 'hunter2' })).toBe(REDACTED)
  })
})
