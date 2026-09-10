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
/** How many failed authentication attempts the whole harness has recorded. */
function failedAttempts(harness: ReturnType<typeof createTestHarness>): number {
  return (
    harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
      .get() as { n: number }
  ).n
}

describe('credential lookup by bare secret', () => {
  it('resolves each class of active credential from its secret alone', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)

    const ingest = await harness.devices.getCredentialBySecret(claimed.ingest.secret, {
      unattributed: true,
    })
    expect(ingest).toMatchObject({
      id: claimed.ingest.credentialId,
      credentialClass: 'ingest',
      deviceId: claimed.deviceId,
      version: 1,
    })

    const command = await harness.devices.getCredentialBySecret(claimed.command.secret, {
      unattributed: true,
    })
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
      candidates.map(async (candidate) =>
        harness.devices.getCredentialBySecret(candidate, { unattributed: true }),
      ),
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

    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { unattributed: true }),
    ).resolves.toBeNull()
    await expect(
      harness.devices.getCredentialBySecret(rotated.secret, { unattributed: true }),
    ).resolves.toMatchObject({
      id: rotated.credentialId,
      version: 2,
    })
    // The other class is untouched.
    await expect(
      harness.devices.getCredentialBySecret(claimed.command.secret, { unattributed: true }),
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
    await expect(
      harness.devices.getCredentialBySecret(issued.secret, { unattributed: true }),
    ).resolves.not.toBeNull()
    harness.clock.set(expiresAt)
    await expect(
      harness.devices.getCredentialBySecret(issued.secret, { unattributed: true }),
    ).resolves.toBeNull()
  })

  it('stops resolving every credential of a revoked device', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await harness.devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { unattributed: true }),
    ).resolves.toBeNull()
    await expect(
      harness.devices.getCredentialBySecret(claimed.command.secret, { unattributed: true }),
    ).resolves.toBeNull()
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
    const failures = () => failedAttempts(harness)
    const before = failures()

    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
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
    // device's own secret still resolves from another IP, which is a counted
    // subject in its own right rather than an unattributed lookup.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, {
        remote: { ip: '198.51.100.9' },
      }),
    ).resolves.not.toBeNull()
  })

  /**
   * narduk-libs#228 second review H1. Devices aboard one vessel share a public
   * IP and the edge presents its bearer on *every* ingest request, so counting
   * a stale-but-known credential as an authentication failure lets one device
   * that has not yet adopted its replacement secret take the whole boat's
   * cameras off the air. The reviewer's six-hour simulation put the healthy
   * neighbour dark 99.7% of the time with no attacker present.
   *
   * The distinction that has to hold: credential stuffing produces *unknown*
   * digests; a revoked or expired row is a known-good credential gone stale,
   * from a caller that has already proved it held it once.
   */
  it('never counts a revoked or expired credential against the shared subject', async () => {
    const harness = createTestHarness()
    const stale = await claimDevice(harness)
    const neighbour = await claimDevice(harness)
    // Exactly what this package's own re-issue, `rotateCredential` and
    // `revokeDevice` all do to a secret the device is still presenting.
    await harness.devices.rotateCredential({
      deviceId: stale.deviceId,
      credentialClass: 'ingest',
      actorUserId: 'owner-1',
    })
    const expiring = await harness.devices.rotateCredential({
      deviceId: stale.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      expiresAt: harness.clock.now() + 60_000,
    })
    harness.clock.advance(60_001)

    const remote = { ip: '203.0.113.7' }
    const attempts = () => failedAttempts(harness)
    const before = attempts()
    // Well past `perAccountOrIp.failures`, which is the whole point: the edge
    // retries on every request, not once.
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures * 2; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(stale.ingest.secret, { remote }),
      ).resolves.toBeNull()
      await expect(
        harness.devices.getCredentialBySecret(expiring.secret, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    // Nothing counted, so nothing to escalate.
    expect(attempts() - before).toBe(0)
    // ...and the neighbour on the same IP is still served, which is the whole
    // finding.
    await expect(
      harness.devices.getCredentialBySecret(neighbour.ingest.secret, { remote }),
    ).resolves.not.toBeNull()

    // M2's value is untouched: an *unknown* digest is still a guess, still
    // counted, and still locks the shared subject.
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(`guess-${String(n)}`, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    expect(attempts() - before).toBe(DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures)
    await expect(
      harness.devices.getCredentialBySecret(neighbour.ingest.secret, { remote }),
    ).resolves.toBeNull()
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
