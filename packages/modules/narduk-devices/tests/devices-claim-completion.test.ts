import { describe, expect, it } from 'vitest'

import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import {
  claimDevice,
  createDeviceKey,
  createTestHarness,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  type TestHarness,
  VESSEL,
} from './support/database'

/** Mint, start and approve, stopping short of completion. */
async function approvedClaim(harness: TestHarness, remote?: { ip?: string }) {
  const pending = await startPendingClaim(harness, remote ? { remote } : {})
  const approval = await harness.devices.issueApprovalToken({
    claimSessionId: pending.claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    hardwareFingerprint: FINGERPRINT,
    approvedByUserId: 'owner-1',
  })
  return { ...pending, approval }
}

/**
 * Gap L1: 0.1.0's `completeClaim` requires the *raw* approval token, so a
 * ceremony where the device collects its own credentials forces the consumer to
 * keep an approval bearer in the clear between the approve and collect legs.
 * `completeClaimWithRecordedApproval` completes on the approval columns the row
 * already carries.
 */
describe('device-side completion with no plaintext bearer', () => {
  it('completes on the recorded approval, with no approval token supplied', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)

    const completed = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    })

    expect(completed.status).toBe('completed')
    expect(completed.credentials.map((entry) => entry.credentialClass).sort()).toEqual([
      'command',
      'ingest',
    ])
    // Nothing derived from the approval bearer leaves the library.
    expect(JSON.stringify(completed)).not.toContain(claim.approval.token)

    const device = await harness.devices.getDevice(completed.deviceId ?? '')
    expect(device).toMatchObject({
      orgId: ORG,
      resourceKind: VESSEL.kind,
      resourceId: VESSEL.id,
      installationId: 'inst-1',
      publicKey: claim.key.publicKey,
      status: 'claimed',
    })
    // Both secrets are live and resolvable by the bearer the edge presents.
    for (const credential of completed.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })

  it('refuses before an approval is recorded', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: pending.claimSessionId,
        devicePublicKey: pending.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toEqual({ status: 'approval_required', credentials: [] })
  })

  it('refuses once the recorded approval has expired', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    harness.clock.advance(301_000)
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toEqual({ status: 'approval_required', credentials: [] })
  })

  it('refuses a device key or fingerprint the claim session did not record', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const attacker = createDeviceKey()

    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: attacker.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toEqual({ status: 'hardware_mismatch', credentials: [] })

    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: 'sha256:other-hardware',
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toEqual({ status: 'hardware_mismatch', credentials: [] })

    // The rightful device still completes.
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('keeps the claim lockout policy: the sixth failure inside the window is rate limited', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness, { ip: '203.0.113.9' })
    const attacker = createDeviceKey()
    const attempt = async () =>
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: attacker.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
        remote: { ip: '203.0.113.9' },
      })

    const statuses: string[] = []
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures; n += 1) {
      statuses.push((await attempt()).status)
      harness.clock.advance(1000)
    }
    expect(statuses).toEqual(Array.from({ length: 5 }, () => 'hardware_mismatch'))

    const locked = await attempt()
    expect(locked.status).toBe('rate_limited')
    expect(locked.credentials).toEqual([])
    expect(locked.retryAfterSeconds).toBeGreaterThan(
      DEVICES_LOCKOUT_POLICY.perTokenOrDevice.cooldownSeconds - 10,
    )
    expect(locked.retryAfterSeconds).toBeLessThanOrEqual(
      DEVICES_LOCKOUT_POLICY.perTokenOrDevice.cooldownSeconds,
    )

    // The rightful device is locked out too, which is the point of the counter.
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
        remote: { ip: '203.0.113.9' },
      }),
    ).resolves.toMatchObject({ status: 'rate_limited' })
  })

  it('refuses an expired or revoked claim session', async () => {
    const harness = createTestHarness()
    const expired = await approvedClaim(harness)
    harness.clock.advance(DEVICES_LOCKOUT_POLICY.claimTokenTtlSeconds * 1000 + 1)
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: expired.claimSessionId,
        devicePublicKey: expired.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).resolves.toEqual({ status: 'expired', credentials: [] })

    const revoked = await approvedClaim(harness)
    await harness.devices.revokeClaimToken({
      claimTokenId: revoked.minted.tokenId,
      actorUserId: 'owner-1',
    })
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: revoked.claimSessionId,
        devicePublicKey: revoked.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-2',
      }),
    ).resolves.toEqual({ status: 'revoked', credentials: [] })
  })

  it('throws not_found for a claim session that does not exist', async () => {
    const harness = createTestHarness()
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: 'no-such-session',
        devicePublicKey: createDeviceKey().publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

/**
 * Gap L3: `completion_idempotency_key` was written and never read, so a device
 * whose completion response was lost got `already_completed` and an empty
 * credential array -- terminal, for the built edge client. A replay carrying the
 * same key inside the claim session's lifetime is now served.
 */
describe('idempotent completion replay', () => {
  it('serves a replayed handoff with a fresh, working credential set', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const request = {
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    }
    const first = await harness.devices.completeClaimWithRecordedApproval(request)
    expect(first.status).toBe('completed')

    harness.clock.advance(2000)
    const replay = await harness.devices.completeClaimWithRecordedApproval(request)

    expect(replay.status).toBe('completed')
    expect(replay.deviceId).toBe(first.deviceId)
    expect(replay.credentials.map((entry) => entry.credentialClass)).toEqual(['ingest', 'command'])
    // A fresh set, at the next version: the first secrets were never retained.
    const firstSecrets = first.credentials.map((entry) => entry.secret)
    for (const credential of replay.credentials) {
      expect(firstSecrets).not.toContain(credential.secret)
      expect(credential.version).toBe(2)
    }
    // The superseded secrets are dead and the new ones are live.
    for (const secret of firstSecrets) {
      await expect(harness.devices.getCredentialBySecret(secret)).resolves.toBeNull()
    }
    for (const credential of replay.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })

  it('revokes sessions opened with the superseded secrets', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const opened = await harness.devices.openSession(
      (await signedOpen(harness, claimed, 'command')).input,
    )
    await expect(harness.devices.getSessionByToken(opened.sessionToken)).resolves.not.toBeNull()

    harness.clock.advance(1000)
    const replay = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claimed.claimSessionId,
      devicePublicKey: claimed.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: `complete-${claimed.claimSessionId}`,
    })
    expect(replay.status).toBe('completed')
    await expect(harness.devices.getSessionByToken(opened.sessionToken)).resolves.toBeNull()
    // The generation moved, so a stale session cannot be reused.
    const device = await harness.devices.getDevice(claimed.deviceId)
    expect(device?.revocationGeneration).toBeGreaterThan(0)
  })

  it('refuses to re-issue past the claim session lifetime', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const request = {
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    }
    const first = await harness.devices.completeClaimWithRecordedApproval(request)
    expect(first.status).toBe('completed')

    harness.clock.advance(DEVICES_LOCKOUT_POLICY.claimTokenTtlSeconds * 1000 + 1)
    const replay = await harness.devices.completeClaimWithRecordedApproval(request)
    expect(replay).toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })
    // Nothing was rotated, so the device keeps what it already has.
    await expect(
      harness.devices.getCredentialBySecret(first.credentials[0]?.secret ?? ''),
    ).resolves.not.toBeNull()
  })

  it('refuses to re-issue for a different idempotency key or a different device key', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const first = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    })
    expect(first.status).toBe('completed')

    const otherKey = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-2',
    })
    expect(otherKey).toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })

    // The binding checks gate the replay exactly as they gate the completion:
    // an attacker holding the session id and the idempotency key gets nothing.
    const attacker = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: createDeviceKey().publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    })
    expect(attacker).toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })
    // ...and the device's own credentials survive the attempt.
    for (const credential of first.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })

  it('leaves completeClaim replaying exactly as 0.1.0 did unless asked otherwise', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const request = {
      claimSessionId: claim.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: claim.approval.token,
      approvedByUserId: 'owner-1',
      idempotencyKey: 'complete-1',
    }
    const first = await harness.devices.completeClaim(request)
    expect(first.status).toBe('completed')

    // Default: unchanged from 0.1.0.
    await expect(harness.devices.completeClaim(request)).resolves.toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })

    // Opted in: served, and only for a caller still holding the approval token.
    const reissued = await harness.devices.completeClaim({
      ...request,
      reissueOnIdempotentReplay: true,
    })
    expect(reissued.status).toBe('completed')
    expect(reissued.credentials).toHaveLength(2)

    await expect(
      harness.devices.completeClaim({
        ...request,
        userApprovalToken: 'not-the-approval-token',
        reissueOnIdempotentReplay: true,
      }),
    ).resolves.toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })
  })

  it('re-issues at most one set per replay, whichever caller wins', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const request = {
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    }
    await harness.devices.completeClaimWithRecordedApproval(request)

    const [a, b] = await Promise.all([
      harness.devices.completeClaimWithRecordedApproval(request),
      harness.devices.completeClaimWithRecordedApproval(request),
    ])
    const outcomes = [a.status, b.status].sort()
    expect(outcomes).toEqual(['already_completed', 'completed'])

    const active = harness.sqlite
      .prepare(
        'SELECT credential_class, COUNT(*) AS live FROM devices_credentials WHERE revoked_at IS NULL GROUP BY credential_class',
      )
      .all() as Array<{ credential_class: string; live: number }>
    expect(active).toEqual([
      { credential_class: 'command', live: 1 },
      { credential_class: 'ingest', live: 1 },
    ])
  })

  it('never records a raw approval token or credential secret', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const completed = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    })
    harness.clock.advance(1000)
    const replay = await harness.devices.completeClaimWithRecordedApproval({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      installationId: 'inst-1',
      idempotencyKey: 'handoff-1',
    })

    const dump = harness.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'devices_%'")
      .all() as Array<{ name: string }>
    const serialised = dump
      .map((table) => JSON.stringify(harness.sqlite.prepare(`SELECT * FROM ${table.name}`).all()))
      .join('\n')

    const bearers = [
      claim.minted.token,
      claim.approval.token,
      ...completed.credentials.map((entry) => entry.secret),
      ...replay.credentials.map((entry) => entry.secret),
    ]
    for (const bearer of bearers) {
      expect(serialised, 'a bearer reached the database in the clear').not.toContain(bearer)
    }
  })
})
