import { describe, expect, it } from 'vitest'

import { sha256Hex, timingSafeEqualHex } from '../server/utils/devices-signing'

import { claimDevice, createTestHarness } from './support/database'

/**
 * Gap L2: the built mybo edge presents only the raw credential *secret* as its
 * bearer -- no credential id -- so 0.1.0's `verifyCredentialSecret({
 * credentialId, secret })` could not be reached at all, and `secret_hash` had no
 * index to reach it through. Resolution is by digest against a UNIQUE
 * `secret_hash` index, the mirror of `getSessionByToken`.
 */
describe('credential lookup by bare secret', () => {
  it('resolves each class of active credential from its secret alone', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)

    const ingest = await harness.devices.getCredentialBySecret(claimed.ingest.secret)
    expect(ingest).toMatchObject({
      id: claimed.ingest.credentialId,
      credentialClass: 'ingest',
      deviceId: claimed.deviceId,
      version: 1,
    })

    const command = await harness.devices.getCredentialBySecret(claimed.command.secret)
    expect(command).toMatchObject({
      id: claimed.command.credentialId,
      credentialClass: 'command',
      deviceId: claimed.deviceId,
    })
    // The row carries the digest, never the secret.
    expect(ingest?.secretHash).toBe(await sha256Hex(claimed.ingest.secret))
    expect(JSON.stringify(ingest)).not.toContain(claimed.ingest.secret)
  })

  it('returns null rather than throwing for an unknown or malformed secret', async () => {
    const harness = createTestHarness()
    await claimDevice(harness)
    const candidates = ['', 'not-a-secret', ' ', 'a'.repeat(4096)]
    const resolved = await Promise.all(
      candidates.map(async (candidate) => harness.devices.getCredentialBySecret(candidate)),
    )
    expect(resolved).toEqual([null, null, null, null])
  })

  it('stops resolving a rotated secret and resolves its replacement', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    harness.clock.advance(1000)
    const rotated = await harness.devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'ingest',
      actorUserId: 'owner-1',
    })

    await expect(harness.devices.getCredentialBySecret(claimed.ingest.secret)).resolves.toBeNull()
    await expect(harness.devices.getCredentialBySecret(rotated.secret)).resolves.toMatchObject({
      id: rotated.credentialId,
      version: 2,
    })
    // The other class is untouched.
    await expect(
      harness.devices.getCredentialBySecret(claimed.command.secret),
    ).resolves.not.toBeNull()
  })

  it('stops resolving an expired credential', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const expiresAt = harness.clock.now() + 60_000
    const issued = await harness.devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      expiresAt,
    })
    await expect(harness.devices.getCredentialBySecret(issued.secret)).resolves.not.toBeNull()
    harness.clock.set(expiresAt)
    await expect(harness.devices.getCredentialBySecret(issued.secret)).resolves.toBeNull()
  })

  it('stops resolving every credential of a revoked device', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await harness.devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    await expect(harness.devices.getCredentialBySecret(claimed.ingest.secret)).resolves.toBeNull()
    await expect(harness.devices.getCredentialBySecret(claimed.command.secret)).resolves.toBeNull()
  })

  it('refuses to store two credentials behind one digest', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const digest = await sha256Hex(claimed.ingest.secret)
    expect(() =>
      harness.sqlite
        .prepare(
          'INSERT INTO devices_credentials (id, device_id, credential_class, secret_hash, fingerprint, version, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('clone-1', claimed.deviceId, 'ingest', digest, 'sha256:clone', 9, 1),
    ).toThrow(/UNIQUE constraint failed/u)
  })

  // Named for what it proves. It takes no timing measurement, so it is an
  // equality contract for `timingSafeEqualHex`, not evidence of constant time
  // — swap the body for `===` and this still passes (narduk-libs#228 M1).
  it('equates two digests only when every byte matches, first byte to last', () => {
    const digest = 'a'.repeat(64)
    expect(timingSafeEqualHex(digest, digest)).toBe(true)
    expect(timingSafeEqualHex(digest, `b${digest.slice(1)}`)).toBe(false)
    expect(timingSafeEqualHex(digest, `${digest.slice(0, 63)}b`)).toBe(false)
    expect(timingSafeEqualHex(digest, digest.slice(0, 63))).toBe(false)
  })

  it('keeps verifyCredentialSecret working for a caller that knows the id', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await expect(
      harness.devices.verifyCredentialSecret({
        credentialId: claimed.ingest.credentialId,
        secret: claimed.ingest.secret,
      }),
    ).resolves.toMatchObject({ id: claimed.ingest.credentialId })
    await expect(
      harness.devices.verifyCredentialSecret({
        credentialId: claimed.ingest.credentialId,
        secret: claimed.command.secret,
      }),
    ).resolves.toBeNull()
  })
})
