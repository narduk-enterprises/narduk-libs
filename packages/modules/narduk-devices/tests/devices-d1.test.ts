import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDevices } from '../server/utils/devices'
import { DEVICES_INTERNAL_NONCE_PREFIX } from '../shared/types/devices'

import {
  ALGORITHM,
  createDeviceKey,
  FINGERPRINT,
  MIGRATION_STATEMENTS,
  ORG,
  VESSEL,
} from './support/database'

let nonceCounter = 0

describe('D1 integration', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("devices test"); } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let binding: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    // Every shipped migration, not just 0001: a new table or index has to
    // survive the D1 driver, not only better-sqlite3.
    await binding.batch(MIGRATION_STATEMENTS.map((statement) => binding.prepare(statement)))
  })

  afterAll(async () => {
    await runtime.dispose()
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
})
