import { describe, expect, it } from 'vitest'

import { type IssuedCredential, toWireCredential } from '../shared/types/devices'

function issued(overrides: Partial<IssuedCredential> = {}): IssuedCredential {
  return {
    credentialClass: 'ingest',
    credentialId: 'cred-1',
    fingerprint: 'fp-1',
    secret: 'secret-1',
    version: 3,
    ...overrides,
  }
}

describe('toWireCredential', () => {
  it('keeps version on the library type and omits it from the wire object', () => {
    const credential = issued({ version: 4 })
    expect(credential.version).toBe(4)

    const wire = toWireCredential(credential)
    expect(wire).not.toHaveProperty('version')
    expect(Object.keys(wire).sort()).toEqual(
      ['credentialClass', 'credentialId', 'fingerprint', 'secret'].sort(),
    )
    expect(wire).toEqual({
      credentialClass: 'ingest',
      credentialId: 'cred-1',
      fingerprint: 'fp-1',
      secret: 'secret-1',
    })
  })

  it('preserves the contract fields, including optional expiresAt when set', () => {
    const credential = issued({
      credentialClass: 'command',
      credentialId: 'cred-2',
      expiresAt: 1_700_000_000_000,
      fingerprint: 'fp-2',
      secret: 'secret-2',
      version: 1,
    })

    expect(toWireCredential(credential)).toEqual({
      credentialClass: 'command',
      credentialId: 'cred-2',
      expiresAt: 1_700_000_000_000,
      fingerprint: 'fp-2',
      secret: 'secret-2',
    })
  })
})
