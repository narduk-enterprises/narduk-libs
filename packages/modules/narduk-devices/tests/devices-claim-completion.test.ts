import { describe, expect, it } from 'vitest'

import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import { MAX_REISSUES_PER_CLAIM_SESSION } from '../server/utils/devices'
import { DEVICES_LOCKOUT_POLICY as POLICY } from '../shared/utils/lockout-policy'

import {
  claimDevice,
  completionRequest,
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
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    harness.clock.advance(2000)
    // A fresh proof: the first one's nonce is spent.
    const replay = await harness.devices.completeClaimWithRecordedApproval(proven())

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
    const replay = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claimed.claimSessionId,
        idempotencyKey: `complete-${claimed.claimSessionId}`,
        key: claimed.key,
      }).input,
    )
    expect(replay.status).toBe('completed')
    await expect(harness.devices.getSessionByToken(opened.sessionToken)).resolves.toBeNull()
    // The generation moved, so a stale session cannot be reused.
    const device = await harness.devices.getDevice(claimed.deviceId)
    expect(device?.revocationGeneration).toBeGreaterThan(0)
  })

  it('refuses to re-issue past the claim session lifetime', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    harness.clock.advance(DEVICES_LOCKOUT_POLICY.claimTokenTtlSeconds * 1000 + 1)
    // Signed at the advanced clock, so the skew window is not what refuses it.
    const replay = await harness.devices.completeClaimWithRecordedApproval(proven())
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
    const first = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input,
    )
    expect(first.status).toBe('completed')

    // A proven device asking about a *different* completion: nothing to
    // re-issue, and it is told what it already knows.
    const otherKey = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-2',
        key: claim.key,
      }).input,
    )
    expect(otherKey).toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })

    // An attacker holding every on-wire value — session id, device public key,
    // fingerprint, idempotency key — but not the private key. The refusal
    // carries no deviceId: a caller that proved nothing learns nothing.
    const attacker = createDeviceKey()
    const forged = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      idempotencyKey: 'handoff-1',
      key: attacker,
    }).input
    expect(await harness.devices.completeClaimWithRecordedApproval(forged)).toEqual({
      status: 'already_completed',
      credentials: [],
    })

    // ...and so is a proof that is honest about a key the session never recorded.
    const wrongKey = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: 'handoff-1',
      key: attacker,
    }).input
    expect(await harness.devices.completeClaimWithRecordedApproval(wrongKey)).toEqual({
      status: 'already_completed',
      credentials: [],
    })

    // ...and the device's own credentials survive both attempts.
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

    // Refused, and counted: a caller without the approval token learns
    // nothing, not even the device id (narduk-libs#228 review H2).
    await expect(
      harness.devices.completeClaim({
        ...request,
        userApprovalToken: 'not-the-approval-token',
        reissueOnIdempotentReplay: true,
      }),
    ).resolves.toEqual({ status: 'already_completed', credentials: [] })
    const failures = harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
      .get() as { n: number }
    // One attempt row per lockout subject: the claim token and the approving
    // account. Before the fix this path wrote none at all.
    expect(failures.n).toBe(2)
  })

  it('re-issues at most one set per race, and the loser is told to retry, not that it is done', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    const [a, b] = await Promise.all([
      harness.devices.completeClaimWithRecordedApproval(proven()),
      harness.devices.completeClaimWithRecordedApproval(proven()),
    ])
    // The loser lost a race with a replay of its *own* request, and the winner
    // rotated the credentials it was holding. `already_completed` here is the
    // bricking outcome the whole replay path exists to remove: it must be
    // retryable (narduk-libs#228 review H3).
    expect([a.status, b.status].sort()).toEqual(['completed', 'rate_limited'])
    const loser = a.status === 'rate_limited' ? a : b
    expect(loser.credentials).toEqual([])
    expect(loser.retryAfterSeconds).toBeGreaterThan(0)
    expect(loser.deviceId).toBe(first.deviceId)

    // The loser mutated *nothing*, which live counts alone cannot see: a loser
    // that revoked the winner's fresh set and inserted its own would leave one
    // live credential per class too, while the caller told `completed` walks
    // away holding dead secrets. Only resolving the winner's own returned
    // secrets distinguishes the two, so this is what pins the compare-and-set
    // being inside the batch rather than beside it (narduk-libs#228 H3).
    const winner = a.status === 'completed' ? a : b
    expect(winner.credentials).toHaveLength(2)
    for (const credential of winner.credentials) {
      // eslint-disable-next-line no-await-in-loop -- two credentials, asserted in order
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
    // ...and the generation moved exactly once, not once per caller.
    expect((await harness.devices.getDevice(first.deviceId ?? ''))?.revocationGeneration).toBe(1)

    const liveCounts = () =>
      harness.sqlite
        .prepare(
          'SELECT credential_class, COUNT(*) AS live FROM devices_credentials WHERE revoked_at IS NULL GROUP BY credential_class',
        )
        .all() as Array<{ credential_class: string; live: number }>
    expect(liveCounts()).toEqual([
      { credential_class: 'command', live: 1 },
      { credential_class: 'ingest', live: 1 },
    ])

    // The loser retries and recovers, which is the whole point of a retryable
    // status: it ends the exchange holding credentials that work.
    const retry = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(retry.status).toBe('completed')
    expect(retry.credentials).toHaveLength(2)
    for (const credential of retry.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
    expect(liveCounts()).toEqual([
      { credential_class: 'command', live: 1 },
      { credential_class: 'ingest', live: 1 },
    ])
  })

  it('never records a raw approval token or credential secret', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const completed = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input,
    )
    harness.clock.advance(1000)
    const replay = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input,
    )
    expect(replay.status).toBe('completed')

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

/**
 * narduk-libs#228 review H1: every value `completeClaimWithRecordedApproval`
 * compares travels on the wire, and a served re-issue hands the caller live
 * secrets while revoking the genuine device's. So the destructive half is off
 * by default and cannot be turned on without a device signature the library
 * itself verifies.
 */
describe('re-issue is off by default and gated on a device proof', () => {
  it('does not re-issue unless asked, so a replayed handoff rotates nothing', async () => {
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

    const replay = await harness.devices.completeClaimWithRecordedApproval(request)
    expect(replay).toEqual({
      status: 'already_completed',
      credentials: [],
      deviceId: first.deviceId,
    })
    // The device keeps exactly what it was issued: nothing was revoked.
    for (const credential of first.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
    expect((await harness.devices.getDevice(first.deviceId ?? ''))?.revocationGeneration).toBe(0)
  })

  it('refuses to enable re-issue without a device proof', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'handoff-1',
        reissueOnIdempotentReplay: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('refuses a captured proof replayed a second time', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const captured = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: 'handoff-1',
      key: claim.key,
    }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(captured)
    expect(first.status).toBe('completed')

    // The wire capture, resubmitted verbatim: the signature still verifies,
    // the nonce does not. Without this a proxy or a log line is a credential.
    expect(await harness.devices.completeClaimWithRecordedApproval(captured)).toEqual({
      status: 'already_completed',
      credentials: [],
    })
    for (const credential of first.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })

  it('refuses a proof re-aimed at another request, and one outside the skew window', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const first = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input,
    )
    expect(first.status).toBe('completed')

    // Signed for one installation, presented for another: the envelope is
    // rewritten, the signature is not, and the binding catches it.
    const reaimed = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: 'handoff-1',
      installationId: 'inst-1',
      key: claim.key,
    }).input
    expect(
      await harness.devices.completeClaimWithRecordedApproval({
        ...reaimed,
        installationId: 'inst-2',
      }),
    ).toEqual({ status: 'already_completed', credentials: [] })

    const stale = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: 'handoff-1',
      key: claim.key,
      timestamp: harness.clock.now() - 301_000,
    }).input
    expect(await harness.devices.completeClaimWithRecordedApproval(stale)).toEqual({
      status: 'already_completed',
      credentials: [],
    })
  })

  it('caps re-issues per claim session', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    let last = first
    for (let n = 0; n < MAX_REISSUES_PER_CLAIM_SESSION; n += 1) {
      harness.clock.advance(1000)
      // eslint-disable-next-line no-await-in-loop -- the cap is sequential by definition
      last = await harness.devices.completeClaimWithRecordedApproval(proven())
      expect(last.status).toBe('completed')
    }

    harness.clock.advance(1000)
    const capped = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(capped).toEqual({ status: 'already_completed', credentials: [] })
    // The cap refuses further churn; it does not take away what the device has.
    for (const credential of last.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })

  it('refuses to re-issue once the claim token is revoked', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input
    expect((await harness.devices.completeClaimWithRecordedApproval(proven())).status).toBe(
      'completed',
    )

    await harness.devices.revokeClaimToken({
      claimTokenId: claim.minted.tokenId,
      actorUserId: 'owner-1',
    })
    harness.clock.advance(1000)
    expect(await harness.devices.completeClaimWithRecordedApproval(proven())).toEqual({
      status: 'revoked',
      credentials: [],
    })
  })
})

/**
 * narduk-libs#228 review H2: a refused replay used to fall through to
 * `already_completed` without calling the failure path, so guessing against a
 * claimed session was unlimited and left no trace at all — surface 0.1.0 did
 * not have.
 */
describe('a refused replay is counted like every other refusal', () => {
  it('locks out a caller guessing against a completed claim session', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness, { ip: '203.0.113.9' })
    const first = await harness.devices.completeClaimWithRecordedApproval({
      ...completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-1',
        key: claim.key,
      }).input,
      remote: { ip: '203.0.113.9' },
    })
    expect(first.status).toBe('completed')

    const attacker = createDeviceKey()
    const guess = async () =>
      harness.devices.completeClaimWithRecordedApproval({
        ...completionRequest(harness, {
          claimSessionId: claim.claimSessionId,
          devicePublicKey: claim.key.publicKey,
          idempotencyKey: 'handoff-1',
          key: attacker,
        }).input,
        remote: { ip: '203.0.113.9' },
      })

    const statuses: string[] = []
    for (let n = 0; n < POLICY.perTokenOrDevice.failures; n += 1) {
      // eslint-disable-next-line no-await-in-loop -- the counter is sequential by definition
      statuses.push((await guess()).status)
      harness.clock.advance(1000)
    }
    expect(statuses).toEqual(Array.from({ length: POLICY.perTokenOrDevice.failures }, () => 'already_completed'))

    // Every refusal left an attempt row, so the counter reaches its threshold.
    const failures = harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
      .get() as { n: number }
    expect(failures.n).toBeGreaterThanOrEqual(POLICY.perTokenOrDevice.failures)

    const locked = await guess()
    expect(locked.status).toBe('rate_limited')
    expect(locked.credentials).toEqual([])

    // ...and the genuine device's credentials were never at risk.
    for (const credential of first.credentials) {
      await expect(harness.devices.getCredentialBySecret(credential.secret)).resolves.not.toBeNull()
    }
  })
})
