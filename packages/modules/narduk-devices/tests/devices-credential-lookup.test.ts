import { describe, expect, it } from 'vitest'

import { sha256Hex, timingSafeEqualHex } from '../server/utils/devices-signing'
import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

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

  /**
   * narduk-libs#228 M2. A completion-issued secret never expires, so this
   * resolver is a permanent bearer — and it used to record nothing at all, so
   * a credential-stuffing sweep across a fleet left no trace anywhere and ran
   * unbounded. Guessing a 256-bit secret is infeasible; being unable to *see*
   * someone try is the part that had to change.
   */
  it('counts a failed bare-secret resolution against the lockout and refuses once locked', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const remote = { ip: '203.0.113.44' }
    const failures = () =>
      (
        harness.sqlite
          .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
          .get() as { n: number }
      ).n
    const before = failures()

    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      // eslint-disable-next-line no-await-in-loop -- the counter is sequential by definition
      await expect(
        harness.devices.getCredentialBySecret(`guess-${String(n)}`, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    // Every miss left a row, which is what the sweep used to avoid entirely.
    expect(failures() - before).toBe(DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures)

    // Locked: even the genuine secret is refused from this IP, so the sweep is
    // bounded rather than merely logged.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { remote }),
    ).resolves.toBeNull()
    // ...and the lockout is scoped to the subject, not to the credential: the
    // device's own secret still resolves from anywhere else.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret),
    ).resolves.not.toBeNull()
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
