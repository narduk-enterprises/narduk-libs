import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import { createDevices } from '../server/utils/devices'
import { DEVICES_INTERNAL_NONCE_PREFIX } from '../shared/types/devices'

import {
  ALGORITHM,
  createDeviceKey,
  FINGERPRINT,
  MIGRATION_DIR,
  ORG,
  VESSEL,
} from './support/database'

import type { D1Binding, D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

let nonceCounter = 0

describe('D1 integration', () => {
  let d1: D1QueryHarness
  let binding: D1Binding

  beforeAll(async () => {
    // Every shipped migration, discovered from the directory, not just 0001: a
    // new table or index has to survive the D1 driver, not only better-sqlite3.
    d1 = await createD1QueryHarness({ migrations: MIGRATION_DIR })
    binding = d1.raw
  })

  afterAll(async () => {
    await d1.dispose()
  })

  it('claims a device atomically and opens a signed session on the real D1 driver', async () => {
    const devices = createDevices(drizzle(binding))
    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'd1-start',
    })
    expect(started.status).toBe('pending_user_approval')
    const claimSessionId = started.claimSessionId ?? ''
    const approval = await devices.issueApprovalToken({
      claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const complete = (idempotencyKey: string) =>
      devices.completeClaim({
        claimSessionId,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: approval.token,
        approvedByUserId: 'owner-1',
        idempotencyKey,
      })
    const results = await Promise.all([complete('a'), complete('b')])
    expect(results.map((result) => result.status).sort()).toEqual([
      'already_completed',
      'completed',
    ])
    const completed = results.find((result) => result.status === 'completed')
    const command = completed?.credentials.find((c) => c.credentialClass === 'command')
    expect(command).toBeDefined()
    const deviceId = completed?.deviceId ?? ''

    const challenge = await devices.issueChallenge({ deviceId })
    const request = {
      method: 'POST',
      route: '/api/edge/v1/session/open',
      resource: VESSEL,
      installationId: 'inst-1',
      deviceId,
      credentialClass: 'command' as const,
      credentialId: command?.credentialId ?? '',
      credentialVersion: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      timestamp: Date.now(),
      requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }
    const input = {
      credentialClass: 'command' as const,
      credentialId: command?.credentialId ?? '',
      deviceId,
      signature: key.sign(request),
      canonicalRequest: request,
    }
    const opened = await devices.openSession(input)
    expect(opened.revocationGeneration).toBe(0)
    expect(opened.sessionToken).not.toBe(opened.sessionId)
    // The bearer resolves by digest on the real D1 driver too.
    expect(await devices.getSessionByToken(opened.sessionToken)).toMatchObject({
      id: opened.sessionId,
    })
    expect(await devices.getSessionByToken(opened.sessionId)).toBeNull()
    await expect(devices.openSession(input)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      devices.openSession({ ...input, credentialClass: 'ingest' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    // A signed body re-aimed at the other credential is refused by the binding.
    const ingest = completed?.credentials.find((c) => c.credentialClass === 'ingest')
    await expect(
      devices.openSession({
        ...input,
        credentialClass: 'ingest',
        credentialId: ingest?.credentialId ?? '',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })

    // 0002's own additions, exercised on the D1 driver rather than assumed:
    // the UNIQUE secret_hash index resolves a bare bearer, and the scoped
    // nonce table refuses a replay.
    expect(
      await devices.getCredentialBySecret(command?.secret ?? '', { unattributed: true }),
    ).toMatchObject({
      id: command?.credentialId,
    })
    expect(await devices.getCredentialBySecret('not-a-secret', { unattributed: true })).toBeNull()
    const nonce = {
      scope: `claim-handoff:${claimSessionId}`,
      nonce: 'n-1',
      expiresAt: Date.now() + 60_000,
    }
    expect(await devices.consumeNonce(nonce)).toBe(true)
    expect(await devices.consumeNonce(nonce)).toBe(false)
  }, 30_000)

  /**
   * narduk-libs#228 second review M2: `reissueCredentialsAtomically` is the
   * most intricate SQL this package ships — an `INSERT … SELECT` with `sql`
   * literal projections, a correlated `EXISTS` gate and, since the second
   * review's H2, a nonce burn conditional on the lock it just took — and none
   * of it ran on the D1 driver. It works there; what this pins is that a future
   * drizzle or D1 dialect change cannot take the recovery path out silently.
   */
  it('re-issues a replayed completion atomically on the real D1 driver', async () => {
    const devices = createDevices(drizzle(binding))
    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'd1-reissue-start',
    })
    const claimSessionId = started.claimSessionId ?? ''
    await devices.issueApprovalToken({
      claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const proved = () => {
      const canonicalRequest = {
        claimSessionId,
        devicePublicKey: key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        idempotencyKey: 'd1-reissue',
        installationId: 'inst-1',
        nonce: `d1-nonce-${String(nonceCounter++)}`,
        timestamp: Date.now(),
      }
      return {
        claimSessionId,
        devicePublicKey: key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey: 'd1-reissue',
        deviceProof: { canonicalRequest, signature: key.signCanonical(canonicalRequest) },
        reissueOnIdempotentReplay: true,
      }
    }

    const first = await devices.completeClaimWithRecordedApproval(proved())
    expect(first.status).toBe('completed')
    const deviceId = first.deviceId ?? ''

    const replayed = await devices.completeClaimWithRecordedApproval(proved())
    expect(replayed.status).toBe('completed')
    expect(replayed.credentials.map((c) => c.version).sort()).toEqual([2, 2])
    expect((await devices.getDevice(deviceId))?.revocationGeneration).toBe(1)
    // The superseded set is dead and the fresh one resolves — both halves of
    // the rotation landed in the same batch.
    for (const credential of first.credentials) {
      expect(
        await devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).toBeNull()
    }
    for (const credential of replayed.credentials) {
      expect(
        await devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).not.toBeNull()
    }
    // The lock row and the burned proof nonce are both in the table the batch
    // writes them to, under the package's reserved prefix.
    const scopes = await binding
      .prepare('SELECT scope, nonce FROM devices_scoped_nonces WHERE scope LIKE ?')
      .bind(`${DEVICES_INTERNAL_NONCE_PREFIX}%`)
      .all<{ nonce: string; scope: string }>()
    expect(scopes.results).toContainEqual({
      scope: `${DEVICES_INTERNAL_NONCE_PREFIX}reissue:${deviceId}`,
      nonce: '0',
    })
    expect(
      scopes.results.filter(
        (row) => row.scope === `${DEVICES_INTERNAL_NONCE_PREFIX}claim-completion:${claimSessionId}`,
      ),
    ).toHaveLength(2)
  }, 30_000)

  /**
   * narduk-libs#231: `revokeDevice` and `rotateCredential` are one D1 batch
   * each now, and on D1 it is the batch — not a transaction this package opens
   * — that makes them all-or-nothing. This pins that on the real driver: a
   * statement failing last in either batch rolls back every one before it,
   * and the `INSERT … SELECT` audit rows store `details_json` byte-for-byte as
   * `JSON.stringify` wrote it before the batch existed.
   */
  it('revokes and rotates all-or-nothing on the real D1 driver', async () => {
    let clock = Date.now()
    const devices = createDevices(drizzle(binding), { now: () => clock })
    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'd1-revoke-start',
    })
    const claimSessionId = started.claimSessionId ?? ''
    const approval = await devices.issueApprovalToken({
      claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const completed = await devices.completeClaim({
      claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-revoke',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: approval.token,
      approvedByUserId: 'owner-1',
      idempotencyKey: 'd1-revoke-complete',
    })
    const deviceId = completed.deviceId ?? ''
    const credentialOf = (credentialClass: 'command' | 'ingest') => {
      const credential = completed.credentials.find((c) => c.credentialClass === credentialClass)
      if (!credential) throw new Error(`No ${credentialClass} credential was issued.`)
      return credential
    }
    const command = credentialOf('command')
    const ingest = credentialOf('ingest')
    const open = async (credentialClass: 'command' | 'ingest', credentialId: string) => {
      const challenge = await devices.issueChallenge({ deviceId })
      const request = {
        method: 'POST',
        route: '/api/edge/v1/session/open',
        resource: VESSEL,
        installationId: 'inst-revoke',
        deviceId,
        credentialClass,
        credentialId,
        credentialVersion: 1,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        timestamp: clock,
        requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      }
      return devices.openSession({
        credentialClass,
        credentialId,
        deviceId,
        signature: key.sign(request),
        canonicalRequest: request,
      })
    }
    const commandSession = await open('command', command.credentialId)
    const ingestSession = await open('ingest', ingest.credentialId)

    const rows = async (query: string) => (await binding.prepare(query).all()).results
    const state = async () => ({
      devices: await rows(
        'SELECT id, status, revoked_at, revocation_generation FROM devices_devices ORDER BY id',
      ),
      credentials: await rows(
        'SELECT id, credential_class, version, revoked_at FROM devices_credentials ORDER BY id',
      ),
      sessions: await rows('SELECT id, revoked_at FROM devices_sessions ORDER BY id'),
      audit: await rows('SELECT id, action, details_json FROM devices_audit_events ORDER BY id'),
    })
    const auditOf = async (action: string, subjectId: string) =>
      (
        await binding
          .prepare(
            'SELECT actor_user_id, subject_kind, details_json, created_at FROM devices_audit_events WHERE action = ? AND subject_id = ?',
          )
          .bind(action, subjectId)
          .all()
      ).results

    // The generation bump is the last statement of both batches, so failing
    // it leaves every earlier statement written and waiting on the rollback.
    await binding
      .prepare(
        "CREATE TRIGGER induced_fault BEFORE UPDATE ON devices_devices BEGIN SELECT RAISE(ABORT, 'induced fault'); END",
      )
      .run()
    const before = await state()
    await expect(
      devices.rotateCredential({ deviceId, credentialClass: 'command', actorUserId: 'owner-1' }),
    ).rejects.toThrow(/induced fault/u)
    expect(await state()).toEqual(before)
    await expect(devices.revokeDevice({ deviceId, actorUserId: 'owner-1' })).rejects.toThrow(
      /induced fault/u,
    )
    expect(await state()).toEqual(before)
    // Still claimed, so still resolving is the consistent state.
    for (const credential of [command, ingest]) {
      expect(
        await devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).not.toBeNull()
    }
    expect(await devices.getSession(commandSession.sessionId)).not.toBeNull()
    await binding.prepare('DROP TRIGGER induced_fault').run()

    clock += 1000
    const rotatedAt = clock
    const reason = 'scheduled "rotation" \\ path/Ω\n\t\u0001 \uD800'
    const rotated = await devices.rotateCredential({
      deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      reason,
    })
    expect(await auditOf('credential.rotate', rotated.credentialId)).toEqual([
      {
        actor_user_id: 'owner-1',
        subject_kind: 'credential',
        details_json: JSON.stringify({
          deviceId,
          credentialClass: 'command',
          version: 2,
          revocationGeneration: 1,
          revokedSessions: 1,
          reason,
        }),
        created_at: rotatedAt,
      },
    ])
    expect(await devices.getCredentialBySecret(command.secret, { unattributed: true })).toBeNull()
    expect(
      await devices.getCredentialBySecret(rotated.secret, { unattributed: true }),
    ).toMatchObject({ id: rotated.credentialId, version: 2 })
    expect(await devices.getSession(commandSession.sessionId)).toBeNull()
    expect(await devices.getSession(ingestSession.sessionId)).not.toBeNull()

    clock += 1000
    const revokedAt = clock
    expect(await devices.revokeDevice({ deviceId })).toMatchObject({
      status: 'revoked',
      revokedAt,
      revocationGeneration: 2,
    })
    expect(await auditOf('device.revoke', deviceId)).toEqual([
      {
        actor_user_id: null,
        subject_kind: 'device',
        details_json: JSON.stringify({
          reason: null,
          revocationGeneration: 2,
          revokedSessions: 1,
        }),
        created_at: revokedAt,
      },
    ])
    for (const secret of [command.secret, ingest.secret, rotated.secret]) {
      expect(await devices.getCredentialBySecret(secret, { unattributed: true })).toBeNull()
    }
    expect(await devices.getSession(ingestSession.sessionId)).toBeNull()
  }, 30_000)
})
