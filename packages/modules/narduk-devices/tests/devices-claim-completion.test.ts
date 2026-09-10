import { describe, expect, it } from 'vitest'

import {
  MAX_REISSUES_PER_CLAIM_SESSION,
  REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN,
} from '../server/utils/devices'
import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import {
  claimDevice,
  completionRequest,
  createDeviceKey,
  createTestHarness,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  type TestDeviceKey,
  type TestHarness,
  VESSEL,
} from './support/database'

const HANDOFF_KEY = 'handoff-1'
const ATTACKER_IP = '203.0.113.9'

/** Mint, start and approve, stopping short of completion. */
async function approvedClaim(harness: TestHarness, remote?: { ip?: string }, key?: TestDeviceKey) {
  const pending = await startPendingClaim(harness, {
    ...(remote ? { remote } : {}),
    ...(key ? { key } : {}),
  })
  const approval = await harness.devices.issueApprovalToken({
    claimSessionId: pending.claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    hardwareFingerprint: FINGERPRINT,
    approvedByUserId: 'owner-1',
  })
  return { ...pending, approval }
}

/** The claim's own proved replay request, freshly signed and nonced each call. */
function provenReplay(harness: TestHarness, claim: Awaited<ReturnType<typeof approvedClaim>>) {
  return () =>
    completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
      key: claim.key,
    }).input
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
      idempotencyKey: HANDOFF_KEY,
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
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
    // The invariant `canReissue`'s approval leg leans on: nothing reaches
    // `status = 'claimed'` without a recorded approval. It holds by inspection
    // today \u2014 `completeClaimAtomically` is the only writer of that status and
    // both `authorize` implementations demand a non-null hash \u2014 which is exactly
    // the kind of thing a refactor breaks in silence, so it is asserted rather
    // than reasoned (narduk-libs#228 second review, note 5).
    expect(
      harness.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM devices_claim_sessions WHERE status = 'claimed' AND approval_token_hash IS NULL",
        )
        .get(),
    ).toEqual({ n: 0 })
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
        idempotencyKey: HANDOFF_KEY,
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
        idempotencyKey: HANDOFF_KEY,
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
        idempotencyKey: HANDOFF_KEY,
      }),
    ).resolves.toEqual({ status: 'hardware_mismatch', credentials: [] })

    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: 'sha256:other-hardware',
        installationId: 'inst-1',
        idempotencyKey: HANDOFF_KEY,
      }),
    ).resolves.toEqual({ status: 'hardware_mismatch', credentials: [] })

    // The rightful device still completes.
    await expect(
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: claim.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: HANDOFF_KEY,
      }),
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('keeps the claim lockout policy: the sixth failure inside the window is rate limited', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness, { ip: ATTACKER_IP })
    const attacker = createDeviceKey()
    const attempt = async () =>
      harness.devices.completeClaimWithRecordedApproval({
        claimSessionId: claim.claimSessionId,
        devicePublicKey: attacker.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: HANDOFF_KEY,
        remote: { ip: ATTACKER_IP },
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
        idempotencyKey: HANDOFF_KEY,
        remote: { ip: ATTACKER_IP },
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
        idempotencyKey: HANDOFF_KEY,
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
        idempotencyKey: HANDOFF_KEY,
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
    const proven = provenReplay(harness, claim)
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
      await expect(
        harness.devices.getCredentialBySecret(secret, { unattributed: true }),
      ).resolves.toBeNull()
    }
    for (const credential of replay.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
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
    const proven = provenReplay(harness, claim)
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    harness.clock.advance(DEVICES_LOCKOUT_POLICY.claimTokenTtlSeconds * 1000 + 1)
    // Signed at the advanced clock, so the skew window is not what refuses it.
    const replay = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(replay).toEqual({ status: 'already_completed', credentials: [] })
    expect(replay).not.toHaveProperty('deviceId')
    // Nothing was rotated, so the device keeps what it already has.
    await expect(
      harness.devices.getCredentialBySecret(first.credentials[0]?.secret ?? '', {
        unattributed: true,
      }),
    ).resolves.not.toBeNull()
  })

  it('refuses to re-issue for a different idempotency key or a different device key', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const first = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: HANDOFF_KEY,
        key: claim.key,
      }).input,
    )
    expect(first.status).toBe('completed')

    // A proven device asking about a *different* completion: nothing to
    // re-issue, and the replay path answers with the status alone.
    const otherKey = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: 'handoff-2',
        key: claim.key,
      }).input,
    )
    expect(otherKey).toEqual({ status: 'already_completed', credentials: [] })
    expect(otherKey).not.toHaveProperty('deviceId')

    // An attacker holding every on-wire value — session id, device public key,
    // fingerprint, idempotency key — but not the private key. The refusal
    // carries no deviceId: a caller that proved nothing learns nothing.
    const attacker = createDeviceKey()
    const forged = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      idempotencyKey: HANDOFF_KEY,
      key: attacker,
    }).input
    expect(await harness.devices.completeClaimWithRecordedApproval(forged)).toEqual({
      status: 'already_completed',
      credentials: [],
    })

    // ...and so is a proof that is honest about a key the session never recorded.
    const wrongKey = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
      key: attacker,
    }).input
    expect(await harness.devices.completeClaimWithRecordedApproval(wrongKey)).toEqual({
      status: 'already_completed',
      credentials: [],
    })

    // ...and the device's own credentials survive both attempts.
    for (const credential of first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
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

    // Default: 0.1.0's answer, minus the `deviceId` it used to disclose to a
    // caller that had proved nothing (narduk-libs#228 second review H3).
    await expect(harness.devices.completeClaim(request)).resolves.toEqual({
      status: 'already_completed',
      credentials: [],
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
    const proven = provenReplay(harness, claim)
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
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
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
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
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
        idempotencyKey: HANDOFF_KEY,
        key: claim.key,
      }).input,
    )
    harness.clock.advance(1000)
    const replay = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: HANDOFF_KEY,
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
      idempotencyKey: HANDOFF_KEY,
    }
    const first = await harness.devices.completeClaimWithRecordedApproval(request)
    expect(first.status).toBe('completed')

    const replay = await harness.devices.completeClaimWithRecordedApproval(request)
    // Status and nothing else. `deviceId` names the scope of this package's own
    // re-issue lock rows, so the default replay branch — the one an
    // unauthenticated caller reaches — stops handing it out
    // (narduk-libs#228 second review H3).
    expect(replay).toEqual({ status: 'already_completed', credentials: [] })
    expect(replay).not.toHaveProperty('deviceId')
    // The device keeps exactly what it was issued: nothing was revoked.
    for (const credential of first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
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
        idempotencyKey: HANDOFF_KEY,
        reissueOnIdempotentReplay: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('refuses a captured proof replayed a second time', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const captured = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
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
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
  })

  it('refuses a proof re-aimed at another request, and one outside the skew window', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const first = await harness.devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: HANDOFF_KEY,
        key: claim.key,
      }).input,
    )
    expect(first.status).toBe('completed')

    // Signed for one installation, presented for another: the envelope is
    // rewritten, the signature is not, and the binding catches it.
    const reaimed = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
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
      idempotencyKey: HANDOFF_KEY,
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
    const proven = provenReplay(harness, claim)
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')

    let last = first
    for (let n = 0; n < MAX_REISSUES_PER_CLAIM_SESSION; n += 1) {
      harness.clock.advance(1000)

      last = await harness.devices.completeClaimWithRecordedApproval(proven())
      expect(last.status).toBe('completed')
    }

    harness.clock.advance(1000)
    const capped = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(capped).toEqual({ status: 'already_completed', credentials: [] })
    // The cap refuses further churn; it does not take away what the device has.
    for (const credential of last.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
  })

  it('refuses to re-issue once the claim token is revoked', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = provenReplay(harness, claim)
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
 * narduk-libs#228 second review H2 and M4.
 *
 * Everything past `canReissue` is an *authenticated* caller: it signed this
 * exact request with the key the claim session recorded. A device on a marginal
 * link resending its payload, a device that lost the single-writer race, and a
 * device that has used up its cap are all ordinary behaviour, not guesses — and
 * a claim session's lockout cooldown (900 s) is as long as the session itself,
 * so counting one of them costs the device the very recovery path the re-issue
 * exists to provide.
 */
describe('an authenticated replay never spends the device\u2019s own lockout', () => {
  const failures = (harness: TestHarness) =>
    (
      harness.sqlite
        .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
        .get() as { n: number }
    ).n

  it('admits a fresh proof after the same payload has been resent verbatim', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const payload = provenReplay(harness, claim)()
    expect((await harness.devices.completeClaimWithRecordedApproval(payload)).status).toBe(
      'completed',
    )

    const before = failures(harness)
    // What a retrying HTTP client does by default: the identical body, again.
    // More resends than `perTokenOrDevice.failures`, so a counted refusal would
    // certainly lock the claim token out.
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures + 1; n += 1) {
      harness.clock.advance(1000)

      const resend = await harness.devices.completeClaimWithRecordedApproval(payload)
      expect(resend.status).toBe('already_completed')
      // A spent proof is a wire capture as easily as a retry, so it is told the
      // outcome and nothing else.
      expect(resend).not.toHaveProperty('deviceId')
    }
    expect(failures(harness) - before).toBe(0)

    // The recovery the resends were reaching for still works.
    harness.clock.advance(1000)
    const fresh = await harness.devices.completeClaimWithRecordedApproval(
      provenReplay(harness, claim)(),
    )
    expect(fresh.status).toBe('completed')
    expect(fresh.credentials).toHaveLength(2)
  })

  it('lets the loser of a contended re-issue retry the identical payload', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = provenReplay(harness, claim)
    expect((await harness.devices.completeClaimWithRecordedApproval(proven())).status).toBe(
      'completed',
    )

    // Two re-issues of the same completion, racing: both read generation 0.
    const before = failures(harness)
    const a = proven()
    const b = proven()
    const raced = await Promise.all([
      harness.devices.completeClaimWithRecordedApproval(a),
      harness.devices.completeClaimWithRecordedApproval(b),
    ])
    expect(raced.map((result) => result.status).sort()).toEqual(['completed', 'rate_limited'])
    const loserInput = raced[0]?.status === 'rate_limited' ? a : b
    const loser = raced.find((result) => result.status === 'rate_limited')
    expect(loser?.retryAfterSeconds).toBeGreaterThanOrEqual(
      REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN,
    )

    // The loser spent nothing, so the retry the library invited is the
    // identical signed payload rather than a fresh signature the already-built
    // edge has no code to produce.
    harness.clock.advance((loser?.retryAfterSeconds ?? 1) * 1000)
    const retry = await harness.devices.completeClaimWithRecordedApproval(loserInput)
    expect(retry.status).toBe('completed')
    expect(retry.credentials).toHaveLength(2)
    expect(failures(harness) - before).toBe(0)
  })

  it('answers at the re-issue cap without counting a failure', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = provenReplay(harness, claim)
    expect((await harness.devices.completeClaimWithRecordedApproval(proven())).status).toBe(
      'completed',
    )
    for (let n = 0; n < MAX_REISSUES_PER_CLAIM_SESSION; n += 1) {
      harness.clock.advance(1000)

      expect((await harness.devices.completeClaimWithRecordedApproval(proven())).status).toBe(
        'completed',
      )
    }

    const before = failures(harness)
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures + 1; n += 1) {
      harness.clock.advance(1000)

      expect((await harness.devices.completeClaimWithRecordedApproval(proven())).status).toBe(
        'already_completed',
      )
    }
    // Capped is "no more churn", not "you are guessing": a device that keeps
    // asking past its cap must not also lose its claim token to a cooldown.
    expect(failures(harness) - before).toBe(0)
  })
})

/**
 * narduk-libs#228 second review M3: three of the seven proof-binding clauses,
 * and the `stillOurs` device-claimed leg of the re-issue batch, had no test at
 * all. `claimSessionId` is the one that is not redundant — nonce scopes are
 * per-session, so a fresh proof captured in flight for one session is *unspent*
 * in another\u2019s scope and this clause is the only thing refusing it.
 */
describe('every proof-binding clause is pinned', () => {
  it('accepts only the proof signed over this exact request', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const first = await harness.devices.completeClaimWithRecordedApproval(
      provenReplay(harness, claim)(),
    )
    expect(first.status).toBe('completed')
    const deviceId = first.deviceId ?? ''
    // One genuine re-issue first, so what follows is measured against a live
    // credential set the refusals must leave exactly where they found it.
    harness.clock.advance(1000)
    const live = await harness.devices.completeClaimWithRecordedApproval(
      provenReplay(harness, claim)(),
    )
    expect(live.status).toBe('completed')

    // A valid proof describing request A, presented with real parameters B.
    // The signed body is never touched, so the signature always verifies and
    // the binding against the *call's own* parameters is the only refusal.
    const foreign = createDeviceKey()
    const envelopeRewrites: Array<[string, Record<string, string>]> = [
      ['installationId', { installationId: 'inst-EVIL' }],
      ['idempotencyKey', { idempotencyKey: 'handoff-EVIL' }],
      ['hardwareFingerprint', { hardwareFingerprint: 'sha256:not-this-device' }],
      ['devicePublicKey', { devicePublicKey: foreign.publicKey }],
    ]
    for (const [field, envelope] of envelopeRewrites) {
      harness.clock.advance(1000)
      const signed = provenReplay(harness, claim)()

      const refused = await harness.devices.completeClaimWithRecordedApproval({
        ...signed,
        ...envelope,
      })
      expect(refused.status, field).toBe('already_completed')
      expect(refused.credentials, field).toHaveLength(0)
    }

    // The mirror of the above for `devicePublicKey`: signed as a foreign key,
    // presented as the real one, and signed by the *genuine* private key so the
    // signature still verifies. Only `request.devicePublicKey` against the
    // session's recorded key can refuse this.
    harness.clock.advance(1000)
    const signedForeignKey = completionRequest(harness, {
      claimSessionId: claim.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
      key: claim.key,
      devicePublicKey: foreign.publicKey,
    })
    const refusedKey = await harness.devices.completeClaimWithRecordedApproval({
      ...signedForeignKey.input,
      devicePublicKey: claim.key.publicKey,
    })
    expect(refusedKey.status).toBe('already_completed')
    expect(refusedKey.credentials).toHaveLength(0)

    // Nothing above rotated anything: the generation is where the one genuine
    // re-issue left it, and that set is still the device's live one.
    expect((await harness.devices.getDevice(deviceId))?.revocationGeneration).toBe(1)
    for (const credential of live.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
  })

  it('refuses a first completion whose proof was signed over other values', async () => {
    // The mirror of the envelope rewrites above, on a *first* completion. There
    // the request binding is the only check standing: nothing has been claimed
    // yet, so `reissueForReplay`'s idempotency-key check has nothing to compare
    // against, and `bindsDevice` sees the real envelope in every case.
    const signedBodyRewrites: Array<[string, Record<string, string>]> = [
      ['hardwareFingerprint', { hardwareFingerprint: 'sha256:not-this-device' }],
      ['idempotencyKey', { idempotencyKey: 'handoff-EVIL' }],
      ['installationId', { installationId: 'inst-EVIL' }],
      ['nonce', { nonce: '   ' }],
    ]
    for (const [field, signedOver] of signedBodyRewrites) {
      // A fresh harness per case: a first completion is available only once.
      const harness = createTestHarness()
      const claim = await approvedClaim(harness)
      const signed = completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: HANDOFF_KEY,
        key: claim.key,
        ...signedOver,
      })
      const refused = await harness.devices.completeClaimWithRecordedApproval({
        ...signed.input,
        // Every envelope value is the genuine one: only the signed body lies.
        hardwareFingerprint: FINGERPRINT,
        idempotencyKey: HANDOFF_KEY,
        installationId: 'inst-1',
      })
      expect(refused.status, field).toBe('unauthorized_user')
      expect(refused.credentials, field).toHaveLength(0)
      expect(refused, field).not.toHaveProperty('deviceId')
      // Nothing was claimed, so the genuine device can still complete.
      const genuine = await harness.devices.completeClaimWithRecordedApproval(
        provenReplay(harness, claim)(),
      )
      expect(genuine.status, field).toBe('completed')
    }
  })

  it('refuses a fresh, unspent proof re-aimed at another claim session', async () => {
    const harness = createTestHarness()
    // One device identity, two claim sessions: the *same* Ed25519 key, the same
    // hardware fingerprint, the same idempotency key. A device re-claimed after
    // a revocation looks exactly like this, and it is the only shape in which a
    // captured proof is re-aimable at all — with two identities the key binding
    // refuses it first, and `claimSessionId` is never the clause under test.
    const key = createDeviceKey()
    const one = await approvedClaim(harness, undefined, key)
    const two = await approvedClaim(harness, undefined, key)
    for (const claim of [one, two]) {
      expect(
        (await harness.devices.completeClaimWithRecordedApproval(provenReplay(harness, claim)()))
          .status,
      ).toBe('completed')
    }
    expect(one.key.publicKey).toBe(two.key.publicKey)

    // A proof minted for session one, never presented there, aimed at session
    // two. Every other bound field matches session two exactly and the
    // signature verifies against the key session two recorded; its nonce is
    // unspent in session two's scope, so single use cannot refuse it either.
    // `request.claimSessionId !== session.id` is the only clause left.
    const forSessionOne = completionRequest(harness, {
      claimSessionId: one.claimSessionId,
      idempotencyKey: HANDOFF_KEY,
      key,
    })
    harness.clock.advance(1000)
    const reAimed = await harness.devices.completeClaimWithRecordedApproval({
      ...forSessionOne.input,
      claimSessionId: two.claimSessionId,
    })
    expect(reAimed.status).toBe('already_completed')
    expect(reAimed.credentials).toHaveLength(0)
  })

  it('rotates nothing once the device stops being claimed', async () => {
    const harness = createTestHarness()
    const claim = await approvedClaim(harness)
    const proven = provenReplay(harness, claim)
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')
    const deviceId = first.deviceId ?? ''
    const generation = (await harness.devices.getDevice(deviceId))?.revocationGeneration

    // Revoked out of band, before the call: `reissueForReplay`'s own status
    // read refuses this one (`not_serviceable`) and the batch is never built.
    // The batch's own leg is a *different* guard; the test below drives it.
    harness.sqlite
      .prepare("UPDATE devices_devices SET status = 'revoked' WHERE id = ?")
      .run(deviceId)
    harness.clock.advance(1000)
    const refused = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(refused.credentials).toHaveLength(0)
    expect(refused).not.toHaveProperty('deviceId')
    expect((await harness.devices.getDevice(deviceId))?.revocationGeneration).toBe(generation)
    // Nothing was revoked either: the device keeps the set it was issued.
    for (const credential of first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
  })

  it('rotates nothing when the device is revoked inside the batch\u2019s own window', async () => {
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
      idempotencyKey: 'complete-toctou',
      reissueOnIdempotentReplay: true,
    }
    const first = await harness.devices.completeClaim(request)
    expect(first.status).toBe('completed')
    const deviceId = first.deviceId ?? ''
    const generation = (await harness.devices.getDevice(deviceId))?.revocationGeneration

    // The approval-token path carries no completion-proof nonce, so `stillOurs`
    // is `heldLock AND deviceClaimed` and that second leg is the only thing
    // standing between an operator's revocation and a rotation. Reaching it
    // means revoking the device *after* the service read its status and
    // *before* the batch commits, so the driver's transaction is where the
    // revocation is injected \u2014 one shot, then the wrapper stands down.
    const client = harness.sqlite as unknown as {
      transaction: (callback: () => unknown[]) => () => unknown[]
    }
    const original = client.transaction.bind(harness.sqlite)
    let armed = true
    client.transaction = (callback) => {
      const run = original(callback)
      return () => {
        if (armed) {
          armed = false
          harness.sqlite
            .prepare("UPDATE devices_devices SET status = 'revoked' WHERE id = ?")
            .run(deviceId)
        }
        return run()
      }
    }
    harness.clock.advance(1000)
    const raced = await harness.devices.completeClaim(request)
    expect(armed).toBe(false)
    expect(raced.credentials).toHaveLength(0)
    expect((await harness.devices.getDevice(deviceId))?.revocationGeneration).toBe(generation)
    // The set the device is holding is untouched: no half-applied rotation.
    for (const credential of first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
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
    const claim = await approvedClaim(harness, { ip: ATTACKER_IP })
    const first = await harness.devices.completeClaimWithRecordedApproval({
      ...completionRequest(harness, {
        claimSessionId: claim.claimSessionId,
        idempotencyKey: HANDOFF_KEY,
        key: claim.key,
      }).input,
      remote: { ip: ATTACKER_IP },
    })
    expect(first.status).toBe('completed')

    const attacker = createDeviceKey()
    const guess = async () =>
      harness.devices.completeClaimWithRecordedApproval({
        ...completionRequest(harness, {
          claimSessionId: claim.claimSessionId,
          devicePublicKey: claim.key.publicKey,
          idempotencyKey: HANDOFF_KEY,
          key: attacker,
        }).input,
        remote: { ip: ATTACKER_IP },
      })

    const statuses: string[] = []
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures; n += 1) {
      statuses.push((await guess()).status)
      harness.clock.advance(1000)
    }
    expect(statuses).toEqual(
      Array.from(
        { length: DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures },
        () => 'already_completed',
      ),
    )

    // Every refusal left an attempt row, so the counter reaches its threshold.
    const failures = harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
      .get() as { n: number }
    expect(failures.n).toBeGreaterThanOrEqual(DEVICES_LOCKOUT_POLICY.perTokenOrDevice.failures)

    const locked = await guess()
    expect(locked.status).toBe('rate_limited')
    expect(locked.credentials).toEqual([])

    // ...and the genuine device's credentials were never at risk.
    for (const credential of first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
  })
})
