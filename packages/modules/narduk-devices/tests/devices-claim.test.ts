import { describe, expect, it } from 'vitest'

import { CLAIM_TOKEN_DEFAULT_TTL_SECONDS } from '../server/utils/devices'

import {
  ALGORITHM,
  claimDevice,
  createDeviceKey,
  createTestHarness,
  FINGERPRINT,
  ORG,
  startPendingClaim,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'

describe('claim ceremony', () => {
  it('claims a device end to end and returns each secret exactly once', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const start = clock.now()
    const claimed = await claimDevice(harness)

    expect(claimed.minted.expiresAt).toBe(start + CLAIM_TOKEN_DEFAULT_TTL_SECONDS * 1000)
    expect(claimed.started.status).toBe('pending_user_approval')
    expect(claimed.completed.status).toBe('completed')
    expect(claimed.completed.credentials.map((c) => c.credentialClass)).toEqual([
      'ingest',
      'command',
    ])
    for (const credential of claimed.completed.credentials) {
      expect(credential.secret).toMatch(/^secret-\d+$/u)
      expect(credential.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(credential.version).toBe(1)
    }

    const device = await devices.getDevice(claimed.deviceId)
    expect(device).toMatchObject({
      orgId: ORG,
      resourceKind: VESSEL.kind,
      resourceId: VESSEL.id,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      fingerprintAlgorithm: ALGORITHM,
      publicKey: claimed.key.publicKey,
      status: 'claimed',
      revocationGeneration: 0,
    })
    expect(await devices.listDevices({ orgId: ORG, resource: VESSEL })).toHaveLength(1)

    // Nothing secret is stored in the clear.
    const stored = harness.sqlite
      .prepare('SELECT token_hash FROM devices_claim_tokens')
      .all() as Array<{ token_hash: string }>
    expect(stored[0]?.token_hash).not.toBe(claimed.minted.token)
    const hashes = harness.sqlite
      .prepare('SELECT secret_hash FROM devices_credentials')
      .all() as Array<{ secret_hash: string }>
    for (const credential of claimed.completed.credentials) {
      expect(hashes.map((row) => row.secret_hash)).not.toContain(credential.secret)
      expect(
        await devices.verifyCredentialSecret({
          credentialId: credential.credentialId,
          secret: 'wrong',
        }),
      ).toBeNull()
      expect(
        await devices.verifyCredentialSecret({
          credentialId: credential.credentialId,
          secret: credential.secret,
        }),
      ).toMatchObject({ id: credential.credentialId })
    }

    // The token is consumed and the session claimed.
    const session = await devices.getClaimSession(claimed.claimSessionId)
    expect(session).toMatchObject({ status: 'claimed', deviceId: claimed.deviceId })
  })

  it('replays a start idempotently and rejects the key with different material', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness, { idempotencyKey: 'idem-1' })
    const again = await devices.startClaim({
      claimToken: pending.minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: pending.key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'idem-1',
    })
    expect(again).toEqual(pending.started)

    expect(
      await codeOf(
        devices.startClaim({
          claimToken: pending.minted.token,
          hardwareFingerprint: 'sha256:other',
          hardwareFingerprintAlgorithm: ALGORITHM,
          devicePublicKey: pending.key.publicKey,
          softwareVersion: '1.0.0',
          idempotencyKey: 'idem-1',
        }),
      ),
    ).toBe('conflict')

    // The same device with a fresh key reports the session it already has.
    const fresh = await devices.startClaim({
      claimToken: pending.minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: pending.key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'idem-2',
    })
    expect(fresh.claimSessionId).toBe(pending.claimSessionId)
    expect(fresh.status).toBe('pending_user_approval')
  })

  it('returns invalid_token for unknown or too-short tokens', async () => {
    const { devices } = createTestHarness()
    const key = createDeviceKey()
    const base = {
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
    }
    expect(
      await devices.startClaim({ ...base, claimToken: 'nope-'.repeat(8), idempotencyKey: 'a' }),
    ).toMatchObject({ claimSessionId: null, status: 'invalid_token' })
    expect(await devices.startClaim({ ...base, claimToken: 'short', idempotencyKey: 'b' })).toMatchObject(
      { status: 'invalid_token' },
    )
    expect(
      await codeOf(
        devices.startClaim({
          ...base,
          devicePublicKey: 'not-32-bytes',
          claimToken: 'x'.repeat(43),
          idempotencyKey: 'c',
        }),
      ),
    ).toBe('invalid')
  })

  it('returns expired, revoked and hardware_mismatch from start', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const key = createDeviceKey()
    const base = {
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
    }

    const expiring = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
      ttlSeconds: 60,
    })
    clock.advance(60_000)
    expect(
      await devices.startClaim({ ...base, claimToken: expiring.token, idempotencyKey: 'e' }),
    ).toMatchObject({ status: 'expired', expiresAt: expiring.expiresAt })

    const revoked = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    await devices.revokeClaimToken({ claimTokenId: revoked.tokenId, actorUserId: 'owner-1' })
    expect(
      await devices.startClaim({ ...base, claimToken: revoked.token, idempotencyKey: 'r' }),
    ).toMatchObject({ status: 'revoked' })

    // A token binds to the first fingerprint that presents it.
    const pending = await startPendingClaim(harness)
    expect(
      await devices.startClaim({
        ...base,
        hardwareFingerprint: 'sha256:another-box',
        claimToken: pending.minted.token,
        idempotencyKey: 'h',
      }),
    ).toMatchObject({ status: 'hardware_mismatch' })

    // Device key reuse: a live device's key on different hardware is refused.
    const claimed = await claimDevice(harness)
    const reuse = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    expect(
      await devices.startClaim({
        ...base,
        devicePublicKey: claimed.key.publicKey,
        hardwareFingerprint: 'sha256:cloned-box',
        claimToken: reuse.token,
        idempotencyKey: 'k',
      }),
    ).toMatchObject({ status: 'hardware_mismatch' })

    // A consumed token presented by a fresh device is spent.
    await devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    expect(
      await devices.startClaim({
        ...base,
        hardwareFingerprint: 'sha256:third-box',
        claimToken: claimed.minted.token,
        idempotencyKey: 'c',
      }),
    ).toMatchObject({ status: 'hardware_mismatch' })
  })

  it('revoking a token revokes its pending session and start reports revoked', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    await devices.revokeClaimToken({ claimTokenId: pending.minted.tokenId })
    expect(await devices.getClaimSession(pending.claimSessionId)).toMatchObject({
      status: 'revoked',
    })
    expect(
      await devices.startClaim({
        claimToken: pending.minted.token,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: pending.key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: 'after-revoke',
      }),
    ).toMatchObject({ claimSessionId: pending.claimSessionId, status: 'revoked' })
    expect(await codeOf(devices.revokeClaimToken({ claimTokenId: 'missing' }))).toBe('not_found')
  })

  it('bounds the claim token TTL and requires non-empty inputs', async () => {
    const { devices } = createTestHarness()
    const base = { orgId: ORG, resource: VESSEL, createdByUserId: 'owner-1' }
    expect(await codeOf(devices.createClaimToken({ ...base, ttlSeconds: 0 }))).toBe('invalid')
    expect(await codeOf(devices.createClaimToken({ ...base, ttlSeconds: 901 }))).toBe('invalid')
    expect(await codeOf(devices.createClaimToken({ ...base, ttlSeconds: 1.5 }))).toBe('invalid')
    expect(await codeOf(devices.createClaimToken({ ...base, orgId: ' ' }))).toBe('invalid')
    const short = createTestHarness({ tokens: ['too-short'] })
    expect(await codeOf(short.devices.createClaimToken(base))).toBe('invalid')
  })
})

describe('claim completion', () => {
  async function approved(harness: ReturnType<typeof createTestHarness>) {
    const pending = await startPendingClaim(harness)
    const approval = await harness.devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const complete = {
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: approval.token,
      approvedByUserId: 'owner-1',
      idempotencyKey: 'complete-1',
    }
    return { pending, approval, complete }
  }

  it('returns already_completed without secrets on a replay', async () => {
    const harness = createTestHarness()
    const { complete } = await approved(harness)
    const first = await harness.devices.completeClaim(complete)
    expect(first.status).toBe('completed')
    const replay = await harness.devices.completeClaim(complete)
    expect(replay).toEqual({
      status: 'already_completed',
      deviceId: first.deviceId,
      credentials: [],
    })
    const other = await harness.devices.completeClaim({ ...complete, idempotencyKey: 'complete-2' })
    expect(other.status).toBe('already_completed')
    // A completed session may not be re-approved.
    expect(
      await codeOf(
        harness.devices.issueApprovalToken({
          claimSessionId: complete.claimSessionId,
          orgId: ORG,
          resource: VESSEL,
          hardwareFingerprint: FINGERPRINT,
          approvedByUserId: 'owner-1',
        }),
      ),
    ).toBe('conflict')
  })

  it('requires an approval token bound to this session', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    const base = {
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
      idempotencyKey: 'complete-1',
    }
    expect(
      await harness.devices.completeClaim({ ...base, userApprovalToken: 'made-up' }),
    ).toMatchObject({ status: 'approval_required' })

    // Another session's approval token does not transfer.
    const other = await startPendingClaim(harness)
    const foreign = await harness.devices.issueApprovalToken({
      claimSessionId: other.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    expect(
      await harness.devices.completeClaim({ ...base, userApprovalToken: foreign.token }),
    ).toMatchObject({ status: 'approval_required' })

    // An expired approval is no approval.
    const approval = await harness.devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
      ttlSeconds: 30,
    })
    harness.clock.advance(30_000)
    expect(
      await harness.devices.completeClaim({ ...base, userApprovalToken: approval.token }),
    ).toMatchObject({ status: 'approval_required' })
    expect(await harness.devices.getClaimSession(pending.claimSessionId)).toMatchObject({
      status: 'pending_user_approval',
    })
  })

  it('binds the approval to actor, org and resource', async () => {
    const harness = createTestHarness()
    const { complete } = await approved(harness)
    expect(
      await harness.devices.completeClaim({ ...complete, approvedByUserId: 'admin-2' }),
    ).toMatchObject({ status: 'unauthorized_user' })
    expect(
      await harness.devices.completeClaim({ ...complete, orgId: 'org-2' }),
    ).toMatchObject({ status: 'unauthorized_user' })
    expect(
      await harness.devices.completeClaim({
        ...complete,
        resource: { kind: 'vessel', id: 'vessel-2' },
      }),
    ).toMatchObject({ status: 'unauthorized_user' })
    // The correct actor still completes after the failed attempts.
    expect(await harness.devices.completeClaim(complete)).toMatchObject({ status: 'completed' })
  })

  it('refuses to approve for a different org, resource, or fingerprint', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    const base = {
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    }
    expect(await codeOf(harness.devices.issueApprovalToken({ ...base, orgId: 'org-2' }))).toBe(
      'forbidden',
    )
    expect(
      await codeOf(
        harness.devices.issueApprovalToken({ ...base, resource: { kind: 'vessel', id: 'v2' } }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        harness.devices.issueApprovalToken({ ...base, hardwareFingerprint: 'sha256:other' }),
      ),
    ).toBe('invalid')
    expect(
      await codeOf(harness.devices.issueApprovalToken({ ...base, claimSessionId: 'missing' })),
    ).toBe('not_found')
    expect(
      await codeOf(harness.devices.completeClaim({
        claimSessionId: 'missing',
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: 'x',
        approvedByUserId: 'owner-1',
        idempotencyKey: 'complete-x',
      })),
    ).toBe('not_found')
  })

  it('returns hardware_mismatch, expired and revoked from complete', async () => {
    const harness = createTestHarness()
    const { complete } = await approved(harness)
    expect(
      await harness.devices.completeClaim({ ...complete, hardwareFingerprint: 'sha256:other' }),
    ).toMatchObject({ status: 'hardware_mismatch' })

    const expiring = await approved(harness)
    harness.clock.advance(CLAIM_TOKEN_DEFAULT_TTL_SECONDS * 1000)
    expect(await harness.devices.completeClaim(expiring.complete)).toMatchObject({
      status: 'expired',
    })
    expect(await harness.devices.getClaimSession(expiring.complete.claimSessionId)).toMatchObject({
      status: 'expired',
    })
    expect(
      await codeOf(
        harness.devices.issueApprovalToken({
          claimSessionId: expiring.complete.claimSessionId,
          orgId: ORG,
          resource: VESSEL,
          hardwareFingerprint: FINGERPRINT,
          approvedByUserId: 'owner-1',
        }),
      ),
    ).toBe('expired')

    const revoked = await approved(harness)
    await harness.devices.revokeClaimToken({ claimTokenId: revoked.pending.minted.tokenId })
    expect(await harness.devices.completeClaim(revoked.complete)).toMatchObject({
      status: 'revoked',
    })
    expect(
      await codeOf(
        harness.devices.issueApprovalToken({
          claimSessionId: revoked.complete.claimSessionId,
          orgId: ORG,
          resource: VESSEL,
          hardwareFingerprint: FINGERPRINT,
          approvedByUserId: 'owner-1',
        }),
      ),
    ).toBe('revoked')
  })
})
