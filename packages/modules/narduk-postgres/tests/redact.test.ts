import { inspect } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  REDACTED,
  getUnredactedCause,
  redactConnectionString,
  redactErrorCause,
  redactSecrets,
} from '../src/redact.js'

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

describe('redactErrorCause', () => {
  it('copies name and code and redacts nested cause messages', () => {
    const nested = new Error('inner postgres://ops:hunter2@db/history')
    const original = new Error('connect postgres://ops:hunter2@db/history') as Error & {
      code: string
    }
    original.name = 'PostgresError'
    original.code = 'ECONNREFUSED'
    original.cause = nested

    const redacted = redactErrorCause(original) as Error & { code: string }
    expect(redacted).not.toBe(original)
    expect(redacted.name).toBe('PostgresError')
    expect(redacted.code).toBe('ECONNREFUSED')
    expect(redacted.message).not.toContain('hunter2')
    expect((redacted.cause as Error).message).not.toContain('hunter2')
    expect(inspect(redacted, { depth: 8 })).not.toContain('hunter2')
    expect(nested.message).toContain('hunter2')
  })

  it('redacts enumerable extras and AggregateError.errors instead of dropping them', () => {
    const original = new Error('connect failed') as Error & {
      address: string
      hostname: string
      parameters: { connectionString: string }
    }
    original.address = '10.70.0.4'
    original.hostname = 'db.internal'
    original.parameters = { connectionString: 'postgres://ops:hunter2@db/history' }
    const inner = new Error('inner postgres://ops:hunter2@db/history')
    const aggregate = new AggregateError(
      [inner, original],
      'connect postgres://ops:hunter2@db/history',
    )

    const redacted = redactErrorCause(aggregate) as AggregateError
    expect(redacted).toBeInstanceOf(AggregateError)
    expect(redacted).not.toBe(aggregate)
    expect(redacted.errors).toHaveLength(2)
    expect(redacted.message).not.toContain('hunter2')
    expect((redacted.errors[0] as Error).message).not.toContain('hunter2')

    const copy = redacted.errors[1] as typeof original
    expect(copy.parameters.connectionString).toBeTruthy()
    expect(copy.parameters.connectionString).not.toContain('hunter2')
    expect(copy.hostname).toBe('db.internal')
    expect(JSON.stringify(copy)).toContain('parameters')
    expect(JSON.stringify(copy)).not.toContain('hunter2')
    expect(JSON.stringify(redacted.errors)).not.toContain('hunter2')
    expect(inspect(redacted, { depth: 8, showHidden: true })).not.toContain('hunter2')
    expect(original.parameters.connectionString).toContain('hunter2')
    expect(inner.message).toContain('hunter2')
    expect(getUnredactedCause(redacted)).toBe(aggregate)
    expect(getUnredactedCause(copy)).toBe(original)
  })
})

describe('redactErrorCause enumerable extras', () => {
  it('redacts a bare secret value held under a secret-named key', () => {
    // `pg` attaches the resolved connection parameters to a connect error.
    // The password is a bare value there, so `redactSecrets` (which matches a
    // DSN or a `password=` pair) never sees a shape it can redact.
    const driverError = Object.assign(new Error('connect ECONNREFUSED 10.70.0.4:5432'), {
      code: 'ECONNREFUSED',
      parameters: {
        database: 'mybo_history',
        host: '10.70.0.4',
        password: 'hunter2',
        user: 'ingest',
      },
    })

    const redacted = redactErrorCause(driverError) as Error & {
      parameters: Record<string, unknown>
    }

    expect(redacted.parameters.password).toBe(REDACTED)
    expect(redacted.parameters.user).toBe('ingest')
    expect(redacted.parameters.host).toBe('10.70.0.4')
    expect(JSON.stringify(redacted)).not.toContain('hunter2')
    expect(inspect(redacted, { depth: null, showHidden: true })).not.toContain('hunter2')
    // The original is untouched and still recoverable for server-side logging.
    expect(driverError.parameters.password).toBe('hunter2')
    expect(getUnredactedCause(redacted)).toBe(driverError)
  })

  it('redacts secret-named keys on a nested plain object extra', () => {
    const driverError = Object.assign(new Error('SASL authentication failed'), {
      connection: { accessToken: 'abc123', sslPassword: 'hunter2' },
    })

    const redacted = redactErrorCause(driverError) as Error & {
      connection: Record<string, unknown>
    }

    expect(redacted.connection.sslPassword).toBe(REDACTED)
    expect(redacted.connection.accessToken).toBe(REDACTED)
    expect(JSON.stringify(redacted)).not.toContain('hunter2')
    expect(JSON.stringify(redacted)).not.toContain('abc123')
  })
})
