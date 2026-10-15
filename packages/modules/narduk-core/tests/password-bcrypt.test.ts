import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import {
  hashUserPassword,
  isBcryptPasswordHash,
  verifyUserPassword,
} from '../runtime/server/utils/password'

// Fixtures are generated here; no real user's hash appears in this repo.
describe('verifyUserPassword with an imported bcrypt hash', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await bcrypt.hash('hunter2-but-longer', 10)
    expect(isBcryptPasswordHash(hash)).toBe(true)
    await expect(verifyUserPassword('hunter2-but-longer', hash)).resolves.toBe(true)
    await expect(verifyUserPassword('hunter3-but-longer', hash)).resolves.toBe(false)
  })

  it('never reports a PBKDF2 hash as bcrypt, and still verifies it', async () => {
    const hash = await hashUserPassword('pbkdf2-password')
    expect(isBcryptPasswordHash(hash)).toBe(false)
    await expect(verifyUserPassword('pbkdf2-password', hash)).resolves.toBe(true)
    await expect(verifyUserPassword('other', hash)).resolves.toBe(false)
  })

  it.each(['', '$2', '$2b$10$short', `$2b$10$${'!'.repeat(53)}`, `$2b$30$${'a'.repeat(53)}`])(
    'fails closed on malformed or over-cost hash %j',
    async (stored) => {
      expect(isBcryptPasswordHash(stored)).toBe(false)
      await expect(verifyUserPassword('anything', stored)).resolves.toBe(false)
    },
  )
})
